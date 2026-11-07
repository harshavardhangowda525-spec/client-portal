import { withDb, SYSTEM } from "./core";
import { getReferralSettings, requestFeedback, makeEligible, assignAndTask, retryFailedEvents, retryReferralEmails } from "./referrals";
import { runCallAutomation } from "./booking";
import "./referral-public"; // registers the enquiry event handler for retries

/** Daily referral automation: delayed feedback requests, reminders, delayed invitations, follow-ups and retries. Idempotent. */
export async function runReferralJob(now = new Date()) {
  const s = await getReferralSettings();
  const out: Record<string, unknown> = { paused: !s.enabled || s.paused };
  if (s.enabled && !s.paused) {
    const due = await withDb(SYSTEM, (tx) => tx<{ id: string; feedback_requested_at: Date | null; reminders_sent: number }[]>`
      select id, feedback_requested_at, reminders_sent from referral_workflows where status = 'awaiting_feedback' and next_reminder_at is not null and next_reminder_at <= ${now}`);
    let requests = 0, reminders = 0;
    for (const w of due) {
      if (!w.feedback_requested_at) { if (await requestFeedback(w.id, 0)) requests++; }
      else if (w.reminders_sent < s.reminder_days.length) { if (await requestFeedback(w.id, w.reminders_sent + 1)) reminders++; }
      else await withDb(SYSTEM, (tx) => tx`update referral_workflows set next_reminder_at = null where id = ${w.id}`);
    }
    out.feedbackRequests = requests; out.reminders = reminders;
    const delayed = await withDb(SYSTEM, (tx) => tx<{ id: string }[]>`
      select w.id from referral_workflows w join project_feedback f on f.workflow_id = w.id
      where w.status = 'feedback_received' and f.sentiment = 'high' and w.invitation_available_at is not null and w.invitation_available_at <= ${now}`);
    for (const w of delayed) await makeEligible(w.id);
    out.invitations = delayed.length;
    const noCall = await withDb(SYSTEM, (tx) => tx<{ id: string }[]>`
      select id from leads where stage = 'qualified' and qualified_at < ${new Date(now.getTime() - s.follow_up_days * 86400_000)}
        and not exists (select 1 from discovery_calls c where c.lead_id = leads.id and c.status in ('scheduled', 'completed'))`);
    for (const l of noCall) await assignAndTask(l.id, "Follow up: this qualified lead hasn't booked a discovery call yet", "followup-call");
    const noProposal = await withDb(SYSTEM, (tx) => tx<{ id: string }[]>`
      select id from leads where stage = 'call_completed' and proposal_sent_at is null and call_completed_at < ${new Date(now.getTime() - s.proposal_follow_up_days * 86400_000)}`);
    for (const l of noProposal) await assignAndTask(l.id, "The discovery call is done but no proposal has been sent yet", "proposal-reminder");
    out.followUps = noCall.length + noProposal.length;
    out.calls = await runCallAutomation(now);
  }
  out.eventsRetried = await retryFailedEvents();
  out.emails = await retryReferralEmails();
  await withDb(SYSTEM, (tx) => tx`insert into app_settings (key, value) values ('referral_job', ${tx.json({ last_run_at: now.toISOString(), ...out } as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`);
  return out;
}

export async function lastReferralJob() {
  const [r] = await withDb(SYSTEM, (tx) => tx<{ value: Record<string, unknown> }[]>`select value from app_settings where key = 'referral_job'`);
  return r?.value ?? null;
}
