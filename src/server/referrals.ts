import { z } from "zod";
import { randomBytes } from "node:crypto";
import { withDb, SYSTEM, assertAdmin, audit, asSystem, nextNumber, getProjectFor, type Actor, type Tx } from "./core";
import { parse, text, optText, email as emailSchema, uuid } from "./validate";
import { notifyAdmins, notifyProjectClients, notifyClientUsers } from "./notify";
import { deliverEmail } from "./delivery";
import { AppError, notFound } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { appUrl, company } from "@/lib/config";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export type ReferralSettings = {
  enabled: boolean; paused: boolean; email_enabled: boolean; feedback_delay_hours: number; reminder_days: number[]; high_threshold: number;
  low_threshold: number; invitation_delay_days: number; require_no_open_complaints: boolean; link_expiry_days: number; follow_up_days: number;
  proposal_follow_up_days: number; default_owner_id: string; max_enquiries_per_hour: number; conversion_rule: "first_payment" | "proposal_accepted";
  share_template: string; landing_headline: string; landing_intro: string; landing_services: string[]; landing_problems: string[];
};
const DEFAULTS: ReferralSettings = {
  enabled: true, paused: false, email_enabled: true, feedback_delay_hours: 0, reminder_days: [3, 7], high_threshold: 4, low_threshold: 2,
  invitation_delay_days: 0, require_no_open_complaints: true, link_expiry_days: 365, follow_up_days: 2, proposal_follow_up_days: 3,
  default_owner_id: "", max_enquiries_per_hour: 5, conversion_rule: "first_payment",
  share_template: "Hi! I recently worked with Infinity Web & Apps for my business project. If you are looking for a website, app or business automation solution, you can explore their services here: {{link}}",
  landing_headline: "Better technology for your business", landing_intro: "Infinity Web & Apps builds websites, mobile apps and AI automation that help growing businesses.",
  landing_services: [], landing_problems: [],
};

export async function getReferralSettings(tx?: Tx): Promise<ReferralSettings> {
  const run = async (t: Tx) => {
    const [r] = await t<{ value: Partial<ReferralSettings> }[]>`select value from app_settings where key = 'referrals'`;
    return { ...DEFAULTS, ...(r?.value ?? {}) };
  };
  return tx ? run(tx) : withDb(SYSTEM, run);
}

const lines = z.union([z.array(z.string()), z.string()]).transform((v) => (Array.isArray(v) ? v : v.split("\n")).map((x) => x.trim()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 200)));
const int = (a: number, b: number) => z.coerce.number().int().min(a).max(b);
const settingsSchema = z.object({
  enabled: z.coerce.boolean(), paused: z.coerce.boolean(), email_enabled: z.coerce.boolean(),
  feedback_delay_hours: int(0, 720),
  reminder_days: z.union([z.array(z.coerce.number()), z.string()]).transform((v) => (Array.isArray(v) ? v : v.split(/[,\s]+/)).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 90))
    .transform((a) => [...new Set(a)].sort((x, y) => x - y).slice(0, 5)),
  high_threshold: int(2, 5), low_threshold: int(1, 4), invitation_delay_days: int(0, 90), require_no_open_complaints: z.coerce.boolean(),
  link_expiry_days: int(0, 3650), follow_up_days: int(1, 60), proposal_follow_up_days: int(1, 60),
  default_owner_id: z.string().optional().default("").refine((v) => !v || /^[0-9a-f-]{36}$/i.test(v), "is invalid"),
  max_enquiries_per_hour: int(1, 100), conversion_rule: z.enum(["first_payment", "proposal_accepted"]),
  share_template: text(1000, 10).refine((v) => v.includes("{{link}}"), "must contain {{link}}"),
  landing_headline: text(150, 3), landing_intro: text(600, 3), landing_services: lines, landing_problems: lines,
}).refine((d) => d.low_threshold < d.high_threshold, { message: "Low threshold must be below the high threshold", path: ["low_threshold"] });

export async function saveReferralSettings(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const d = parse(settingsSchema, input);
  await withDb(actor, async (tx) => {
    if (d.default_owner_id) {
      const [u] = await tx`select 1 from users where id = ${d.default_owner_id} and role = 'admin' and disabled_at is null`;
      if (!u) throw new AppError("Choose an active team member as the default owner.");
    }
    await tx`insert into app_settings (key, value) values ('referrals', ${tx.json(d as never)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await audit(tx, actor, "referrals.settings_updated", "settings", "referrals", null, { enabled: d.enabled, paused: d.paused, conversion_rule: d.conversion_rule });
  });
}

const active = (s: ReferralSettings) => s.enabled && !s.paused;

// ---------------------------------------------------------------------------
// Email (logged in message_deliveries with an idempotency key; failures retried by the daily job)
// ---------------------------------------------------------------------------
export async function referralEmail(o: { key: string; to: string | null | undefined; subject: string; body: string; projectId?: string | null }) {
  if (!o.to) return "skipped";
  const [row] = await withDb(SYSTEM, (tx) => tx<{ id: string }[]>`
    insert into message_deliveries (channel, recipient, subject, purpose, status, idempotency_key, kind, audience, body, project_id)
    values ('email', ${o.to!}, ${o.subject.slice(0, 300)}, 'referral', 'pending', ${`ref:${o.key}`}, 'referral', 'client', ${o.body}, ${o.projectId ?? null})
    on conflict (idempotency_key) do nothing returning id`);
  if (!row) return "duplicate";
  return sendDelivery(row.id, o.to, o.subject, o.body, 1);
}

async function sendDelivery(id: string, to: string, subject: string, body: string, attempt: number) {
  const r = await deliverEmail({ to, subject, text: body, html: `<div style="font-family:system-ui,sans-serif;line-height:1.55;white-space:pre-wrap">${body.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div>` });
  await withDb(SYSTEM, (tx) => tx`update message_deliveries set status = ${r.status}, error = ${r.error ?? null}, attempts = ${attempt}, updated_at = now(),
    next_retry_at = ${r.status === "failed" && attempt < 3 ? tx`now() + interval '1 hour'` : null} where id = ${id}`);
  return r.status;
}

export async function retryReferralEmails(force = false) {
  const rows = await withDb(SYSTEM, (tx) => tx<{ id: string; recipient: string; subject: string | null; body: string; attempts: number }[]>`
    select id, recipient, subject, body, attempts from message_deliveries
    where purpose = 'referral' and status = 'failed' and attempts < 3 ${force ? tx`` : tx`and (next_retry_at is null or next_retry_at <= now())`} limit 50`);
  let sent = 0;
  for (const r of rows) if ((await sendDelivery(r.id, r.recipient, r.subject ?? "", r.body, r.attempts + 1)) === "sent") sent++;
  return { retried: rows.length, sent };
}

async function clientContact(tx: Tx, clientId: string) {
  const [c] = await tx<{ business_name: string; owner_name: string; email: string; referral_emails_opt_out: boolean }[]>`
    select business_name, owner_name, email, referral_emails_opt_out from client_profiles where id = ${clientId}`;
  return c;
}

// ---------------------------------------------------------------------------
// Automation events (unique id, payload, status, retries, audit history)
// ---------------------------------------------------------------------------
export type EventType = "project.completed" | "project.reopened" | "project.cancelled" | "feedback.submitted" | "referral.invitation.created"
  | "referral.link.visited" | "referral.enquiry.submitted" | "referral.introduction.submitted" | "referral.lead.qualified" | "referral.call.booked"
  | "referral.call.cancelled" | "referral.call.completed" | "referral.proposal.sent" | "referral.proposal.accepted" | "referral.converted"
  | "referral.conversion.reversed" | "referral.issue.reported";
type Ids = { project_id?: string | null; client_id?: string | null; lead_id?: string | null; workflow_id?: string | null };
type Handler = (payload: Record<string, unknown> & Ids) => Promise<void>;
const HANDLERS: Partial<Record<EventType, Handler>> = {};

/** Record an event once (by key) and run its handler. Returns false if the event was already recorded. */
export async function emit(type: EventType, key: string, ids: Ids, payload: Record<string, unknown> = {}) {
  const [row] = await withDb(SYSTEM, (tx) => tx<{ id: string }[]>`
    insert into referral_events (type, dedupe_key, project_id, client_id, lead_id, workflow_id, payload)
    values (${type}, ${key}, ${ids.project_id ?? null}, ${ids.client_id ?? null}, ${ids.lead_id ?? null}, ${ids.workflow_id ?? null}, ${tx.json(payload as never)})
    on conflict (dedupe_key) do nothing returning id`);
  if (!row) return false;
  await runEvent(row.id, type, { ...payload, ...ids });
  return true;
}

async function runEvent(id: string, type: EventType, payload: Record<string, unknown>) {
  const handler = HANDLERS[type];
  try {
    if (handler) await handler(payload);
    await withDb(SYSTEM, (tx) => tx`update referral_events set status = ${handler ? "processed" : "skipped"}, attempts = attempts + 1, error = null, processed_at = now() where id = ${id}`);
  } catch (e) {
    console.error(`[referral event ${type}]`, e);
    await withDb(SYSTEM, (tx) => tx`update referral_events set status = 'failed', attempts = attempts + 1, error = ${(e as Error).message.slice(0, 1000)} where id = ${id}`);
  }
}

/** Retry failed events (handlers are idempotent). */
export async function retryFailedEvents(onlyId?: string) {
  const rows = await withDb(SYSTEM, (tx) => tx<{ id: string; type: EventType; payload: Record<string, unknown>; project_id: string | null; client_id: string | null; lead_id: string | null; workflow_id: string | null }[]>`
    select id, type, payload, project_id, client_id, lead_id, workflow_id from referral_events
    where status = 'failed' and attempts < 5 ${onlyId ? tx`and id = ${onlyId}` : tx``} order by created_at limit 50`);
  for (const r of rows) await runEvent(r.id, r.type, { ...r.payload, project_id: r.project_id, client_id: r.client_id, lead_id: r.lead_id, workflow_id: r.workflow_id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// 2. Project completion → workflow → feedback request
// ---------------------------------------------------------------------------
type Workflow = { id: string; project_id: string; client_id: string; status: string; status_reason: string | null; completed_at: Date; feedback_requested_at: Date | null;
  reminders_sent: number; next_reminder_at: Date | null; invitation_available_at: Date | null; created_at: Date };

/** Called after an admin changes a project's status. Safe to call repeatedly. */
export async function onProjectStatusChanged(projectId: string, from: string, to: string) {
  const [p] = await withDb(SYSTEM, (tx) => tx<{ client_id: string; completed_at: Date | null }[]>`select client_id, completed_at from projects where id = ${projectId}`);
  if (!p) return;
  if (to === "completed" && p.completed_at) {
    await emit("project.completed", `project.completed:${projectId}:${new Date(p.completed_at).toISOString()}`, { project_id: projectId, client_id: p.client_id });
  } else if (from === "completed") {
    await emit("project.reopened", `project.reopened:${projectId}:${Date.now()}`, { project_id: projectId, client_id: p.client_id }, { to });
  } else if (to === "cancelled") {
    await emit("project.cancelled", `project.cancelled:${projectId}:${Date.now()}`, { project_id: projectId, client_id: p.client_id });
  }
}

async function openComplaints(tx: Tx, projectId: string) {
  const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from resolve_tickets where project_id = ${projectId} and category = 'complaint'
    and status not in ('resolved', 'closed') and confirmed_at is not null`;
  return n;
}

HANDLERS["project.completed"] = async ({ project_id }) => {
  const s = await getReferralSettings();
  const res = await withDb(SYSTEM, async (tx) => {
    const [p] = await tx<{ id: string; client_id: string; status: string; completed_at: Date | null; is_sample: boolean }[]>`select id, client_id, status, completed_at, is_sample from projects where id = ${project_id!}`;
    if (!p || p.status !== "completed" || !p.completed_at) return null;  // completion was reverted before we ran
    const [c] = await tx`select 1 from client_profiles where id = ${p.client_id}`;
    if (!c) return null;
    const complaints = await openComplaints(tx, p.id);
    const eligible = active(s) && !(s.require_no_open_complaints && complaints > 0);
    const reason = !s.enabled ? "Referral program is off" : s.paused ? "Referral workflows are paused" : complaints ? "Open complaint on this project" : null;
    const [existing] = await tx<Workflow[]>`select * from referral_workflows where project_id = ${p.id}`;
    if (existing) {
      if (["paused", "cancelled", "not_eligible"].includes(existing.status)) {
        const [fb] = await tx<{ sentiment: string }[]>`select sentiment from project_feedback where workflow_id = ${existing.id}`;
        const status = !eligible ? "not_eligible" : fb ? (fb.sentiment === "high" ? "referral_eligible" : fb.sentiment === "low" ? "suppressed" : "on_hold") : "awaiting_feedback";
        await tx`update referral_workflows set status = ${status}, status_reason = ${reason}, completed_at = ${p.completed_at} where id = ${existing.id}`;
        return { workflowId: existing.id, clientId: p.client_id, request: status === "awaiting_feedback" && !existing.feedback_requested_at };
      }
      return null; // already active: idempotent
    }
    const due = new Date(Date.now() + s.feedback_delay_hours * 3600_000);
    const [w] = await tx<{ id: string }[]>`
      insert into referral_workflows (project_id, client_id, status, status_reason, completed_at, next_reminder_at)
      values (${p.id}, ${p.client_id}, ${eligible ? "awaiting_feedback" : "not_eligible"}, ${reason}, ${p.completed_at}, ${eligible && s.feedback_delay_hours ? due : null})
      on conflict (project_id) do nothing returning id`;
    if (!w) return null;
    await tx`insert into audit_logs (actor_role, action, entity_type, entity_id, project_id, data) values ('system', 'referral.workflow_created', 'referral_workflow', ${w.id}, ${p.id}, ${tx.json({ eligible, reason } as never)})`;
    return { workflowId: w.id, clientId: p.client_id, request: eligible && s.feedback_delay_hours === 0 };
  });
  if (res?.request) await requestFeedback(res.workflowId);
};

HANDLERS["project.reopened"] = async ({ project_id }) => {
  await withDb(SYSTEM, (tx) => tx`update referral_workflows set status = 'paused', status_reason = 'Project reopened', next_reminder_at = null
    where project_id = ${project_id!} and status not in ('cancelled')`);
};
HANDLERS["project.cancelled"] = async ({ project_id }) => {
  await withDb(SYSTEM, (tx) => tx`update referral_workflows set status = 'cancelled', status_reason = 'Project cancelled', next_reminder_at = null where project_id = ${project_id!}`);
};

/** Send (or re-send as a reminder) the feedback request: always in the portal, by email only if allowed. */
export async function requestFeedback(workflowId: string, reminder = 0) {
  const s = await getReferralSettings();
  const info = await withDb(SYSTEM, async (tx) => {
    const [w] = await tx<(Workflow & { project_name: string })[]>`select w.*, p.name as project_name from referral_workflows w join projects p on p.id = w.project_id where w.id = ${workflowId}`;
    if (!w || w.status !== "awaiting_feedback") return null;
    const [fb] = await tx`select 1 from project_feedback where workflow_id = ${workflowId}`;
    if (fb) return null;
    const c = await clientContact(tx, w.client_id);
    const nextDays = s.reminder_days[reminder] ?? null;
    await tx`update referral_workflows set feedback_requested_at = coalesce(feedback_requested_at, now()), reminders_sent = ${reminder},
               next_reminder_at = ${nextDays != null ? tx`now() + make_interval(days => ${nextDays})` : null} where id = ${workflowId}`;
    await notifyProjectClients(tx, null, w.project_id, { type: "feedback_request", link: `/portal/${w.project_id}/feedback`,
      title: reminder ? `Reminder: how was your experience with ${company().name}?` : "Your project is complete! We'd love to hear about your experience." });
    return { w, c };
  });
  if (!info) return false;
  if (s.email_enabled && !info.c.referral_emails_opt_out) {
    await referralEmail({ key: `feedback:${workflowId}:${reminder}`, to: info.c.email, projectId: info.w.project_id,
      subject: reminder ? `Quick reminder: your feedback on ${info.w.project_name}` : `Your project is complete — how did we do?`,
      body: `Hi ${info.c.owner_name},\n\nYour project "${info.w.project_name}" is complete! We'd love to hear about your experience with ${company().name}. It takes about a minute:\n\n${appUrl()}/portal/${info.w.project_id}/feedback\n\nThank you,\n${company().name}\n\nYou can turn off these emails in the portal under My Referrals.` });
  }
  return true;
}

// ---------------------------------------------------------------------------
// 3. Feedback
// ---------------------------------------------------------------------------
const star = z.coerce.number().int().min(1, "Please choose a rating").max(5);
const feedbackSchema = z.object({ satisfaction: star, quality: star, communication: star, delivery: star, overall: star,
  comments: optText(5000), suggestions: optText(5000), testimonial_consent: z.coerce.boolean().optional().default(false) });

/** Classify by configurable thresholds; any very poor score or open complaint stops it being "high". */
export function classify(r: { satisfaction: number; quality: number; communication: number; delivery: number; overall: number }, s: Pick<ReferralSettings, "high_threshold" | "low_threshold">, openComplaints = 0) {
  const headline = Math.min(r.overall, r.satisfaction);
  const lowest = Math.min(r.satisfaction, r.quality, r.communication, r.delivery, r.overall);
  if (headline <= s.low_threshold) return "low" as const;
  if (headline >= s.high_threshold && lowest >= 3 && !openComplaints) return "high" as const;
  return "moderate" as const;
}

export async function getFeedbackRequest(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const [w] = await tx<Workflow[]>`select * from referral_workflows where project_id = ${projectId}`;
    const [fb] = w ? await tx<{ id: string; sentiment: string; overall: number; created_at: Date }[]>`select id, sentiment, overall, created_at from project_feedback where workflow_id = ${w.id}` : [];
    return { workflow: w ?? null, feedback: fb ?? null };
  });
}

export async function submitFeedback(actor: Actor, projectId: string, input: unknown) {
  if (actor.role !== "client") throw new AppError("Only the client can give feedback.");
  const d = parse(feedbackSchema, input);
  const s = await getReferralSettings();
  const r = await withDb(actor, async (tx) => {
    const project = await getProjectFor(tx, actor, projectId);
    const [w] = await tx<Workflow[]>`select * from referral_workflows where project_id = ${projectId}`;
    if (!w || ["paused", "cancelled"].includes(w.status)) throw new AppError("Feedback isn't open for this project.");
    const complaints = await openComplaints(tx, projectId);
    const sentiment = classify(d, s, complaints);
    const row = await asSystem(tx, actor, async () => {
      const [f] = await tx<{ id: string }[]>`
        insert into project_feedback (workflow_id, project_id, client_id, user_id, satisfaction, quality, communication, delivery, overall, comments, suggestions, testimonial_consent, sentiment, issue_status)
        values (${w.id}, ${projectId}, ${project.client_id}, ${actor.userId}, ${d.satisfaction}, ${d.quality}, ${d.communication}, ${d.delivery}, ${d.overall},
                ${d.comments}, ${d.suggestions}, ${d.testimonial_consent}, ${sentiment}, ${sentiment === "high" ? "none" : "open"})
        on conflict (workflow_id) do nothing returning id`;
      if (!f) return null;
      await tx`update referral_workflows set status = 'feedback_received', next_reminder_at = null where id = ${w.id}`;
      return f;
    });
    if (!row) throw new AppError("Thanks — you've already shared feedback for this project.");
    await audit(tx, actor, "referral.feedback_submitted", "project_feedback", row.id, projectId, { sentiment, overall: d.overall });
    return { feedbackId: row.id, workflowId: w.id, sentiment, clientId: project.client_id, complaints };
  });
  await emit("feedback.submitted", `feedback.submitted:${r.feedbackId}`, { project_id: projectId, client_id: r.clientId, workflow_id: r.workflowId },
    { feedback_id: r.feedbackId, sentiment: r.sentiment });
  return { sentiment: r.sentiment };
}

HANDLERS["feedback.submitted"] = async ({ feedback_id, workflow_id, project_id, client_id }) => {
  const s = await getReferralSettings();
  const fb = await withDb(SYSTEM, async (tx) => (await tx<{ id: string; sentiment: string; overall: number; comments: string | null; suggestions: string | null; resolve_ticket_id: string | null }[]>`
    select id, sentiment, overall, comments, suggestions, resolve_ticket_id from project_feedback where id = ${String(feedback_id)}`)[0]);
  if (!fb) return;
  if (fb.sentiment === "high") {
    if (!active(s)) {
      await withDb(SYSTEM, (tx) => tx`update referral_workflows set status = 'not_eligible', status_reason = 'Referral program paused or off' where id = ${workflow_id!}`);
    } else if (s.invitation_delay_days > 0) {
      await withDb(SYSTEM, (tx) => tx`update referral_workflows set status = 'feedback_received', invitation_available_at = now() + make_interval(days => ${s.invitation_delay_days}) where id = ${workflow_id!}`);
    } else {
      await makeEligible(workflow_id!);
    }
  } else if (fb.sentiment === "moderate") {
    await withDb(SYSTEM, async (tx) => {
      await tx`update referral_workflows set status = 'on_hold', status_reason = 'Feedback of 3 stars — review before inviting referrals' where id = ${workflow_id!}`;
      const [pm] = await tx<{ project_manager_id: string | null; name: string }[]>`select project_manager_id, name from projects where id = ${project_id!}`;
      const note = { type: "feedback_moderate", projectId: project_id, link: `/admin/referrals/feedback`, title: `Mixed feedback (${fb.overall}★) on ${pm?.name ?? "a project"} — please follow up` };
      if (pm?.project_manager_id) await tx`insert into notifications (user_id, project_id, type, title, link) values (${pm.project_manager_id}, ${project_id!}, ${note.type}, ${note.title}, ${note.link})`;
      else await notifyAdmins(tx, null, note);
    });
  } else {
    // Low satisfaction: service recovery first, no referral ask.
    await withDb(SYSTEM, async (tx) => {
      await tx`update referral_workflows set status = 'suppressed', status_reason = 'Low satisfaction — service recovery in progress' where id = ${workflow_id!}`;
      if (!fb.resolve_ticket_id) {
        const number = await nextNumber(tx, "IR");
        const message = `Low feedback (${fb.overall}★) after project completion.${fb.comments ? `\n\nClient comments: ${fb.comments}` : ""}${fb.suggestions ? `\n\nSuggestions: ${fb.suggestions}` : ""}`;
        const [t] = await tx<{ id: string }[]>`
          insert into resolve_tickets (number, project_id, client_id, source, category, title, original_message, requirement, priority, priority_reason, status, confirmed_at)
          values (${number}, ${project_id!}, ${client_id!}, 'admin', 'complaint', ${"Service recovery: low project feedback"}, ${message.slice(0, 10000)}, ${message.slice(0, 4000)},
                  'high', 'Client rated the completed project poorly', 'awaiting_admin_review', now()) returning id`;
        await tx`insert into resolve_messages (ticket_id, project_id, author_type, visibility, kind, body) values (${t.id}, ${project_id!}, 'system', 'internal', 'note', ${message.slice(0, 10000)})`;
        await tx`update project_feedback set resolve_ticket_id = ${t.id} where id = ${fb.id}`;
      }
    });
    await emit("referral.issue.reported", `referral.issue.reported:${fb.id}`, { project_id, client_id, workflow_id }, { feedback_id: fb.id });
  }
  const { summarizeFeedback } = await import("./referral-ai");
  await summarizeFeedback(fb.id).catch(() => undefined);
};

HANDLERS["referral.issue.reported"] = async ({ project_id, feedback_id }) => {
  await withDb(SYSTEM, (tx) => notifyAdmins(tx, null, { type: "feedback_low", projectId: project_id ?? null, link: `/admin/referrals/feedback`,
    title: "Low client feedback — a service recovery ticket was opened", body: String(feedback_id) }));
  const { adminRecipient } = await import("./resolve-email");
  const to = await adminRecipient().catch(() => "");
  await referralEmail({ key: `issue:${feedback_id}`, to, projectId: project_id ?? null, subject: `[Referrals] Low client feedback needs attention`,
    body: `A client rated a completed project poorly. A service recovery ticket was opened in Infinity Resolve and no referral invitation will be sent.\n\n${appUrl()}/admin/referrals/feedback` });
};

/** Feedback was positive (or an admin released it): open the referral invitation. Idempotent. */
export async function makeEligible(workflowId: string) {
  const created = await withDb(SYSTEM, async (tx) => {
    await tx`update referral_workflows set status = 'referral_eligible', status_reason = null, invitation_available_at = coalesce(invitation_available_at, now()) where id = ${workflowId}`;
    const [w] = await tx<{ client_id: string; project_id: string }[]>`select client_id, project_id from referral_workflows where id = ${workflowId}`;
    const [inv] = await tx<{ id: string }[]>`insert into referral_invitations (workflow_id, client_id) values (${workflowId}, ${w.client_id}) on conflict (workflow_id) do nothing returning id`;
    return inv ? { ...w, invitationId: inv.id } : null;
  });
  if (created) await emit("referral.invitation.created", `referral.invitation.created:${created.invitationId}`, { client_id: created.client_id, project_id: created.project_id, workflow_id: workflowId });
}

HANDLERS["referral.invitation.created"] = async ({ client_id }) => {
  const s = await getReferralSettings();
  const c = await withDb(SYSTEM, async (tx) => {
    await notifyClientUsers(tx, null, client_id!, { type: "referral_invitation", link: "/portal/referrals",
      title: "Enjoyed working with us? Know another business that could benefit from better technology?" });
    return clientContact(tx, client_id!);
  });
  if (s.email_enabled && c && !c.referral_emails_opt_out) {
    await referralEmail({ key: `invitation:${client_id}`, to: c.email, subject: `Thank you from ${company().name}`,
      body: `Hi ${c.owner_name},\n\nThank you for your kind feedback! If you know another business that could use a better website, an app or some automation, we'd really appreciate an introduction. You can share your personal link from the portal:\n\n${appUrl()}/portal/referrals\n\nNo pressure at all — and thank you again.\n${company().name}\n\nYou can turn off these emails in the portal under My Referrals.` });
  }
};

// ---------------------------------------------------------------------------
// Admin: feedback review
// ---------------------------------------------------------------------------
export async function listFeedback(actor: Actor, f: { sentiment?: string; issue?: string } = {}) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ id: string; project_id: string; client_id: string; project_name: string; business_name: string; owner_name: string; satisfaction: number; quality: number;
    communication: number; delivery: number; overall: number; comments: string | null; suggestions: string | null; testimonial_consent: boolean; testimonial_approved: boolean;
    sentiment: string; issue_status: string; issue_assigned_to: string | null; issue_note: string | null; resolve_ticket_id: string | null; ai_summary: string | null; created_at: Date;
    workflow_id: string; workflow_status: string; assignee_name: string | null }[]>`
    select f.*, p.name as project_name, c.business_name, c.owner_name, w.status as workflow_status, u.name as assignee_name
    from project_feedback f join projects p on p.id = f.project_id join client_profiles c on c.id = f.client_id join referral_workflows w on w.id = f.workflow_id
    left join users u on u.id = f.issue_assigned_to
    where true ${f.sentiment ? tx`and f.sentiment = ${f.sentiment}` : tx``} ${f.issue ? tx`and f.issue_status = ${f.issue}` : tx``}
    order by f.created_at desc limit 300`);
}

export async function feedbackTrend(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ month: string; n: number; avg: number; high: number; low: number }[]>`
    select to_char(date_trunc('month', created_at at time zone 'Asia/Kolkata'), 'YYYY-MM') as month, count(*)::int as n, round(avg(overall)::numeric, 2)::float as avg,
      count(*) filter (where sentiment = 'high')::int as high, count(*) filter (where sentiment = 'low')::int as low
    from project_feedback where created_at > now() - interval '12 months' group by 1 order by 1`);
}

const feedbackAdminSchema = z.object({
  issue_status: z.enum(["none", "open", "resolved"]),
  issue_assigned_to: z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable()),
  issue_note: optText(2000),
  testimonial_approved: z.coerce.boolean(),
});

export async function updateFeedback(actor: Actor, feedbackId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(feedbackAdminSchema, input);
  await withDb(actor, async (tx) => {
    const [f] = await tx<{ project_id: string; testimonial_consent: boolean }[]>`select project_id, testimonial_consent from project_feedback where id = ${feedbackId}`;
    if (!f) throw notFound();
    if (d.testimonial_approved && !f.testimonial_consent) throw new AppError("The client didn't consent to using this feedback publicly.");
    await tx`update project_feedback set issue_status = ${d.issue_status}, issue_assigned_to = ${d.issue_assigned_to}, issue_note = ${d.issue_note}, testimonial_approved = ${d.testimonial_approved} where id = ${feedbackId}`;
    await audit(tx, actor, "referral.feedback_updated", "project_feedback", feedbackId, f.project_id, d);
    if (d.issue_assigned_to && d.issue_assigned_to !== actor.userId) {
      await tx`insert into notifications (user_id, project_id, type, title, link) values (${d.issue_assigned_to}, ${f.project_id}, 'feedback_assigned', 'A client feedback issue was assigned to you', '/admin/referrals/feedback')`;
    }
  });
}

/** After concerns are addressed, an admin may open the referral invitation for moderate/low feedback. */
export async function releaseInvitation(actor: Actor, workflowId: string) {
  assertAdmin(actor);
  const s = await getReferralSettings();
  if (!active(s)) throw new AppError("The referral program is off or paused.");
  await withDb(actor, async (tx) => {
    const [w] = await tx<{ status: string; project_id: string }[]>`select status, project_id from referral_workflows where id = ${workflowId}`;
    if (!w) throw notFound();
    if (!["on_hold", "suppressed", "feedback_received", "not_eligible"].includes(w.status)) throw new AppError("This workflow can't be released.");
    if (s.require_no_open_complaints && (await openComplaints(tx, w.project_id))) throw new AppError("Resolve the open complaint on this project first.");
    await audit(tx, actor, "referral.invitation_released", "referral_workflow", workflowId, w.project_id, {});
  });
  await makeEligible(workflowId);
}

// ---------------------------------------------------------------------------
// 4. Client: eligibility, link, introductions, history
// ---------------------------------------------------------------------------
export async function clientEligibility(tx: Tx, clientId: string) {
  const s = await getReferralSettings(tx);
  const [w] = await tx<{ id: string; project_id: string }[]>`select id, project_id from referral_workflows where client_id = ${clientId} and status = 'referral_eligible' order by updated_at desc limit 1`;
  return { eligible: active(s) && !!w, workflowId: w?.id ?? null, projectId: w?.project_id ?? null, settings: s };
}

export const linkUrl = (token: string) => `${appUrl()}/r/${token}`;
const newToken = () => randomBytes(24).toString("base64url");

/** The client's link, created on first use (only once they're eligible). */
export async function getOrCreateLink(actor: Actor) {
  if (actor.role !== "client" || !actor.clientId) throw new AppError("Only clients have referral links.");
  return withDb(actor, async (tx) => {
    const el = await clientEligibility(tx, actor.clientId!);
    const [existing] = await tx<{ id: string; token: string; status: string; expires_at: Date | null }[]>`select id, token, status, expires_at from referral_links where client_id = ${actor.clientId}`;
    if (existing) return existing;
    if (!el.eligible) throw new AppError("Referral links become available after a completed project with positive feedback.");
    return asSystem(tx, actor, async () => {
      const expires = el.settings.link_expiry_days ? new Date(Date.now() + el.settings.link_expiry_days * 86400_000) : null;
      const [l] = await tx<{ id: string; token: string; status: string; expires_at: Date | null }[]>`
        insert into referral_links (client_id, created_by, token, expires_at) values (${actor.clientId}, ${actor.userId}, ${newToken()}, ${expires})
        on conflict (client_id) do update set updated_at = now() returning id, token, status, expires_at`;
      await tx`update referral_invitations set status = 'accepted', responded_at = coalesce(responded_at, now()) where client_id = ${actor.clientId} and status = 'available'`;
      await tx`insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, data) values (${actor.userId}, 'client', 'referral.link_created', 'referral_link', ${l.id}, '{}'::jsonb)`;
      return l;
    });
  });
}

/** Regenerate (new token, old one stops working), disable or re-enable. Clients for their own link; admins for any. */
export async function manageLink(actor: Actor, action: "regenerate" | "disable" | "enable", clientId?: string) {
  const cid = actor.role === "client" ? actor.clientId : clientId;
  if (!cid) throw new AppError("Missing client.");
  if (actor.role !== "client") assertAdmin(actor);
  await withDb(actor, async (tx) => {
    const [l] = await tx<{ id: string }[]>`select id from referral_links where client_id = ${cid}`;
    if (!l) throw notFound("No referral link yet.");
    const s = await getReferralSettings(tx);
    const run = async () => {
      if (action === "regenerate") await tx`update referral_links set token = ${newToken()}, status = 'active', expires_at = ${s.link_expiry_days ? new Date(Date.now() + s.link_expiry_days * 86400_000) : null} where id = ${l.id}`;
      else await tx`update referral_links set status = ${action === "disable" ? "disabled" : "active"} where id = ${l.id}`;
    };
    if (actor.role === "client") await asSystem(tx, actor, run); else await run();
    await audit(tx, actor, `referral.link_${action}d`, "referral_link", l.id, null, {});
  });
}

export async function dismissInvitation(actor: Actor) {
  if (actor.role !== "client" || !actor.clientId) throw new AppError("Only clients can do that.");
  await withDb(actor, (tx) => asSystem(tx, actor, () => tx`update referral_invitations set status = 'dismissed', responded_at = now() where client_id = ${actor.clientId!} and status = 'available'`));
}

export async function setEmailPreference(actor: Actor, optOut: boolean) {
  if (actor.role !== "client" || !actor.clientId) throw new AppError("Only clients can do that.");
  await withDb(actor, async (tx) => {
    await asSystem(tx, actor, () => tx`update client_profiles set referral_emails_opt_out = ${optOut} where id = ${actor.clientId!}`);
    await audit(tx, actor, "referral.email_preference", "client", actor.clientId!, null, { opt_out: optOut });
  });
}

const introSchema = z.object({
  business_name: text(200, 2), business_category: optText(100), contact_name: optText(200), challenge: text(2000, 5), note: optText(2000),
  contact_permission: z.coerce.boolean().optional().default(false),
  contact_email: z.string().trim().optional().transform((v) => v || null).pipe(emailSchema.nullable()), contact_phone: optText(40),
});

/** Method B: a business introduction. Contact details are kept only if the referrer confirms permission; nothing is sent to the prospect. */
export async function submitIntroduction(actor: Actor, input: unknown) {
  if (actor.role !== "client" || !actor.clientId) throw new AppError("Only clients can introduce businesses.");
  const d = parse(introSchema, input);
  const leadId = await withDb(actor, async (tx) => {
    const el = await clientEligibility(tx, actor.clientId!);
    if (!el.eligible) throw new AppError("Introductions open after a completed project with positive feedback.");
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from referral_attributions where referrer_user_id = ${actor.userId} and created_at > now() - interval '1 day'`;
    if (n >= 10) throw new AppError("You've made a lot of introductions today — thank you! Please try again tomorrow.");
    const email = d.contact_permission ? d.contact_email : null;
    const phone = d.contact_permission ? d.contact_phone : null;
    return asSystem(tx, actor, async () => {
      const referrer = await clientContact(tx, actor.clientId!);
      const flags: string[] = [];
      if (email && (email === referrer.email.toLowerCase())) flags.push("self_referral");
      const [l] = await tx<{ id: string }[]>`
        insert into leads (source, stage, business_name, contact_name, email, phone, business_category, problem, intro_note, contact_permission, flags, owner_id)
        values ('client_referral', 'verification_pending', ${d.business_name}, ${d.contact_name}, ${email}, ${phone}, ${d.business_category}, ${d.challenge}, ${d.note},
                ${d.contact_permission && !!(email || phone)}, ${flags}, ${el.settings.default_owner_id || null}) returning id`;
      if (!flags.includes("self_referral")) {
        await tx`insert into referral_attributions (lead_id, referrer_client_id, referrer_user_id, project_id, method)
                 values (${l.id}, ${actor.clientId!}, ${actor.userId}, ${el.projectId}, 'introduction')`;
      }
      await tx`insert into lead_activities (lead_id, kind, body) values (${l.id}, 'created', ${`Introduction from ${referrer.business_name}${d.contact_permission ? " (permission to share contact details confirmed)" : " (no contact details shared)"}`})`;
      await tx`update referral_invitations set status = 'accepted', responded_at = coalesce(responded_at, now()) where client_id = ${actor.clientId!} and status = 'available'`;
      return l.id;
    });
  });
  await emit("referral.introduction.submitted", `referral.introduction.submitted:${leadId}`, { lead_id: leadId, client_id: actor.clientId });
  return leadId;
}

HANDLERS["referral.introduction.submitted"] = async ({ lead_id }) => {
  await assignAndTask(lead_id!, "Verify the introduction and decide how to reach out (the referrer may need to connect you)", "intro");
};

/** Privacy-preserving view for the referring client. */
const CLIENT_LABEL: Record<string, string> = {
  enquiry_submitted: "Enquiry submitted", verification_pending: "Under review", qualified: "Under review", call_scheduled: "Under review", call_completed: "Under review",
  proposal_sent: "Under review", negotiation: "Under review", won: "Successful referral", lost: "Closed", disqualified: "Closed",
};

export async function myReferrals(actor: Actor) {
  if (actor.role !== "client" || !actor.clientId) throw new AppError("Only clients have referrals.");
  return withDb(actor, async (tx) => {
    const el = await clientEligibility(tx, actor.clientId!);
    const [link] = await tx<{ id: string; token: string; status: string; expires_at: Date | null }[]>`select id, token, status, expires_at from referral_links where client_id = ${actor.clientId!}`;
    const [inv] = await tx<{ status: string }[]>`select status from referral_invitations where client_id = ${actor.clientId!} order by created_at desc limit 1`;
    const [pref] = await tx<{ referral_emails_opt_out: boolean }[]>`select referral_emails_opt_out from client_profiles where id = ${actor.clientId!}`;
    // Leads are staff-only; read the referrer's own history through the system role and expose only safe fields.
    const history = await asSystem(tx, actor, () => tx<{ id: string; method: string; stage: string; business_name: string; created_at: Date; verified_at: Date | null; converted_at: Date | null }[]>`
      select l.id, a.method, l.stage, l.business_name, l.created_at, l.verified_at, l.converted_at from referral_attributions a join leads l on l.id = a.lead_id
      where a.referrer_client_id = ${actor.clientId!} order by l.created_at desc limit 100`);
    const visits = link ? await asSystem(tx, actor, async () => (await tx<{ n: number }[]>`select count(*)::int as n from referral_visits where link_id = ${link.id}`)[0].n) : 0;
    const expired = !!link?.expires_at && new Date(link.expires_at) < new Date();
    return {
      eligible: el.eligible, invitation: inv?.status ?? null, optOut: pref?.referral_emails_opt_out ?? false, shareTemplate: el.settings.share_template,
      link: link ? { url: linkUrl(link.token), status: expired ? "expired" : link.status, expires_at: link.expires_at } : null,
      stats: { visits, verified: history.filter((h) => h.verified_at).length, successful: history.filter((h) => h.converted_at).length, total: history.length },
      history: history.map((h) => ({ id: h.id, label: CLIENT_LABEL[h.stage] ?? "Under review", date: h.created_at,
        name: h.method === "introduction" ? h.business_name : "Enquiry via your link" })),
    };
  });
}

// ---------------------------------------------------------------------------
// 6. Leads (CRM pipeline)
// ---------------------------------------------------------------------------
export const STAGES = {
  enquiry_submitted: "Enquiry submitted", verification_pending: "Lead verification pending", qualified: "Qualified", call_scheduled: "Discovery call scheduled",
  call_completed: "Discovery call completed", proposal_sent: "Proposal sent", negotiation: "Negotiation", won: "Won", lost: "Lost", disqualified: "Disqualified",
} as const;
export type Stage = keyof typeof STAGES;

export type Lead = {
  id: string; source: string; stage: Stage; business_name: string; contact_name: string | null; email: string | null; phone: string | null; business_category: string | null;
  service: string | null; problem: string | null; budget_range: string | null; preferred_contact: string | null; intro_note: string | null; contact_consent_at: Date | null;
  contact_permission: boolean; owner_id: string | null; client_id: string | null; flags: string[]; lost_reason: string | null; ai_assessment: Record<string, unknown> | null;
  verified_at: Date | null; qualified_at: Date | null; call_booked_at: Date | null; call_completed_at: Date | null; proposal_sent_at: Date | null; proposal_accepted_at: Date | null;
  converted_at: Date | null; closed_at: Date | null; created_at: Date; updated_at: Date;
};

async function defaultOwner(tx: Tx) {
  const s = await getReferralSettings(tx);
  if (s.default_owner_id) return s.default_owner_id;
  const [u] = await tx<{ id: string }[]>`select id from users where role = 'admin' and disabled_at is null order by created_at limit 1`;
  return u?.id ?? null;
}

/** Ensure an owner, a follow-up task and a notification for a new lead. Idempotent. */
export async function assignAndTask(leadId: string, task: string, key: string) {
  await withDb(SYSTEM, async (tx) => {
    const [l] = await tx<{ owner_id: string | null; business_name: string }[]>`select owner_id, business_name from leads where id = ${leadId}`;
    if (!l) return;
    const owner = l.owner_id ?? (await defaultOwner(tx));
    if (!l.owner_id && owner) await tx`update leads set owner_id = ${owner} where id = ${leadId}`;
    const [t] = await tx<{ id: string }[]>`insert into lead_tasks (lead_id, description, due_at, assigned_to, dedupe_key)
      values (${leadId}, ${task}, now() + interval '1 day', ${owner}, ${`${key}:${leadId}`}) on conflict (dedupe_key) do nothing returning id`;
    if (t && owner) await tx`insert into notifications (user_id, type, title, link) values (${owner}, 'referral_lead', ${`New referral lead: ${l.business_name}`}, ${`/admin/referrals/leads/${leadId}`})`;
  });
}

export async function listLeads(actor: Actor, f: { stage?: string; q?: string; owner?: string; source?: string; referrer?: string } = {}) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const q = f.q?.trim() ? `%${f.q.trim().replace(/[%_]/g, "")}%` : null;
    return tx<(Lead & { owner_name: string | null; referrer_name: string | null; open_tasks: number; next_call: Date | null })[]>`
      select l.*, u.name as owner_name, rc.business_name as referrer_name,
        (select count(*)::int from lead_tasks t where t.lead_id = l.id and t.status = 'open') as open_tasks,
        (select min(c.starts_at) from discovery_calls c where c.lead_id = l.id and c.status = 'scheduled') as next_call
      from leads l left join users u on u.id = l.owner_id left join referral_attributions a on a.lead_id = l.id left join client_profiles rc on rc.id = a.referrer_client_id
      where true ${f.stage ? tx`and l.stage = ${f.stage}` : tx``} ${f.owner ? tx`and l.owner_id = ${f.owner}` : tx``} ${f.source ? tx`and l.source = ${f.source}` : tx``}
        ${f.referrer ? tx`and a.referrer_client_id = ${f.referrer}` : tx``}
        ${q ? tx`and (l.business_name ilike ${q} or coalesce(l.contact_name, '') ilike ${q} or coalesce(l.email, '') ilike ${q} or coalesce(l.service, '') ilike ${q})` : tx``}
      order by l.updated_at desc limit 300`;
  });
}

export async function getLead(actor: Actor, leadId: string) {
  assertAdmin(actor);
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw notFound();
  return withDb(actor, async (tx) => {
    const [lead] = await tx<Lead[]>`select * from leads where id = ${leadId}`;
    if (!lead) throw notFound("Lead not found.");
    const [attribution] = await tx<{ method: string; referrer_client_id: string; referrer_name: string; project_id: string | null; project_name: string | null; created_at: Date }[]>`
      select a.method, a.referrer_client_id, c.business_name as referrer_name, a.project_id, p.name as project_name, a.created_at
      from referral_attributions a join client_profiles c on c.id = a.referrer_client_id left join projects p on p.id = a.project_id where a.lead_id = ${leadId}`;
    const activities = await tx<{ id: string; kind: string; body: string; data: Record<string, unknown>; created_at: Date; actor_name: string | null }[]>`
      select a.*, u.name as actor_name from lead_activities a left join users u on u.id = a.actor_id where a.lead_id = ${leadId} order by a.created_at desc limit 200`;
    const tasks = await tx<{ id: string; description: string; due_at: Date | null; status: string; assignee_name: string | null }[]>`
      select t.*, u.name as assignee_name from lead_tasks t left join users u on u.id = t.assigned_to where t.lead_id = ${leadId} order by t.status, t.due_at nulls last`;
    const calls = await tx<{ id: string; starts_at: Date; ends_at: Date; meeting_type: string; meeting_link: string | null; status: string; outcome: string | null; notes: string | null; booked_by: string }[]>`
      select * from discovery_calls where lead_id = ${leadId} order by starts_at desc`;
    const proposals = lead.client_id ? await tx<{ id: string; number: string; title: string; status: string; total: number }[]>`
      select p.id, p.number, p.title, l.status, l.total from proposals p
      join (select distinct on (proposal_id) * from proposal_versions order by proposal_id, version_no desc) l on l.proposal_id = p.id
      where p.client_id = ${lead.client_id} order by p.created_at desc` : [];
    const [rev] = lead.client_id ? await tx<{ revenue: number }[]>`select ${revenueSql(tx, lead.client_id)} as revenue` : [{ revenue: 0 }];
    return { lead, attribution: attribution ?? null, activities, tasks, calls, proposals, revenue: Number(rev.revenue) };
  });
}

const revenueSql = (tx: Tx, clientId: string) => tx`(
  coalesce((select sum(x.amount) from payments x join projects p on p.id = x.project_id where p.client_id = ${clientId} and x.status = 'confirmed'), 0)
  - coalesce((select sum(x.amount) from payments x join projects p on p.id = x.project_id where p.client_id = ${clientId} and x.status = 'refunded'), 0))`;

const leadFields = z.object({
  business_name: text(200, 2), contact_name: optText(200), email: z.string().trim().optional().transform((v) => v || null).pipe(emailSchema.nullable()),
  phone: optText(40), business_category: optText(100), service: optText(100), problem: optText(5000), budget_range: optText(60),
  preferred_contact: z.enum(["phone", "whatsapp", "email", "video_call", "in_person"]).optional().nullable().or(z.literal("").transform(() => null)),
  owner_id: z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable()),
});

export async function createLead(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const d = parse(leadFields.extend({ source: z.enum(["direct", "manual", "other"]).default("manual") }), input);
  return withDb(actor, async (tx) => {
    const [l] = await tx<{ id: string }[]>`insert into leads ${tx({ ...d, stage: "enquiry_submitted", verified_at: d.email || d.phone ? new Date() : null, owner_id: d.owner_id ?? actor.userId } as never)} returning id`;
    await tx`insert into lead_activities (lead_id, actor_id, kind, body) values (${l.id}, ${actor.userId}, 'created', 'Lead added manually')`;
    await audit(tx, actor, "lead.created", "lead", l.id, null, { source: d.source });
    return l.id;
  });
}

export async function updateLead(actor: Actor, leadId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(leadFields, input);
  await withDb(actor, async (tx) => {
    const [l] = await tx`select 1 from leads where id = ${leadId}`;
    if (!l) throw notFound();
    if (d.owner_id) {
      const [u] = await tx`select 1 from users where id = ${d.owner_id} and role = 'admin' and disabled_at is null`;
      if (!u) throw new AppError("Choose an active team member.");
    }
    await tx`update leads set ${tx(d as never)} where id = ${leadId}`;
    await tx`insert into lead_activities (lead_id, actor_id, kind, body) values (${leadId}, ${actor.userId}, 'note', 'Lead details updated')`;
    await audit(tx, actor, "lead.updated", "lead", leadId, null, {});
  });
}

const RANK: Record<Stage, number> = { enquiry_submitted: 0, verification_pending: 0, qualified: 1, call_scheduled: 2, call_completed: 3, proposal_sent: 4, negotiation: 5, won: 6, lost: 9, disqualified: 9 };

/** Manual stage change with the validation each stage needs. "Won" is never manual: it follows a verified conversion. */
export async function changeStage(actor: Actor, leadId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(z.object({ stage: z.enum(Object.keys(STAGES) as [Stage, ...Stage[]]), reason: optText(1000) }), input);
  let event: EventType | null = null;
  await withDb(actor, async (tx) => {
    const [l] = await tx<Lead[]>`select * from leads where id = ${leadId}`;
    if (!l) throw notFound();
    if (l.stage === d.stage) return;
    const calls = await tx<{ status: string }[]>`select status from discovery_calls where lead_id = ${leadId}`;
    const need = (ok: boolean, msg: string) => { if (!ok) throw new AppError(msg); };
    switch (d.stage) {
      case "won": throw new AppError(`“Won” is set automatically when the referred client's ${(await getReferralSettings(tx)).conversion_rule === "first_payment" ? "first payment is confirmed" : "proposal is accepted"}.`);
      case "qualified": need(!!(l.email || l.phone), "Add an email or phone number before qualifying this lead."); break;
      case "call_scheduled": need(calls.some((c) => c.status === "scheduled"), "Book a discovery call first (Calls section)."); break;
      case "call_completed": need(calls.some((c) => c.status === "completed"), "Record the call outcome first."); break;
      case "proposal_sent": need(!!l.proposal_sent_at, "Send a proposal from the proposal builder first — this stage updates automatically."); break;
      case "negotiation": need(!!l.proposal_sent_at, "Send a proposal before moving to negotiation."); break;
      case "lost": case "disqualified": need(!!d.reason, "Please give a reason."); break;
    }
    if (l.converted_at && RANK[d.stage] < RANK.won) throw new AppError("This lead has a verified conversion; its stage follows the payment status.");
    await tx`update leads set stage = ${d.stage},
               verified_at = case when ${d.stage} not in ('enquiry_submitted', 'verification_pending', 'disqualified') then coalesce(verified_at, now()) else verified_at end,
               qualified_at = case when ${RANK[d.stage]} between 1 and 6 then coalesce(qualified_at, now()) else qualified_at end,
               lost_reason = case when ${d.stage} in ('lost', 'disqualified') then ${d.reason} else lost_reason end,
               closed_at = case when ${d.stage} in ('lost', 'disqualified') then now() else null end
             where id = ${leadId}`;
    await tx`insert into lead_activities (lead_id, actor_id, kind, body, data) values (${leadId}, ${actor.userId}, 'stage', ${`Stage: ${STAGES[l.stage]} → ${STAGES[d.stage]}${d.reason ? ` (${d.reason})` : ""}`}, ${tx.json({ from: l.stage, to: d.stage } as never)})`;
    if (["lost", "disqualified"].includes(d.stage)) await tx`update lead_tasks set status = 'cancelled' where lead_id = ${leadId} and status = 'open'`;
    await audit(tx, actor, "lead.stage_changed", "lead", leadId, null, { from: l.stage, to: d.stage });
    if (d.stage === "qualified") event = "referral.lead.qualified";
  });
  if (event) await emit(event, `${event}:${leadId}`, { lead_id: leadId });
}

HANDLERS["referral.lead.qualified"] = async ({ lead_id }) => {
  const [c] = await withDb(SYSTEM, (tx) => tx`select 1 from discovery_calls where lead_id = ${lead_id!} and status in ('scheduled', 'completed')`);
  if (!c) await assignAndTask(lead_id!, "Book a discovery call with this qualified lead", "book-call");
};

export async function addLeadNote(actor: Actor, leadId: string, body: unknown) {
  assertAdmin(actor);
  const b = parse(text(5000), body);
  await withDb(actor, (tx) => tx`insert into lead_activities (lead_id, actor_id, kind, body) select id, ${actor.userId}, 'note', ${b} from leads where id = ${leadId}`);
}

export async function addLeadTask(actor: Actor, leadId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(z.object({ description: text(1000), due_date: z.string().optional().nullable().transform((v) => v || null) }), input);
  await withDb(actor, (tx) => tx`insert into lead_tasks (lead_id, description, due_at, assigned_to)
    select id, ${d.description}, ${d.due_date ? `${d.due_date}T10:00:00+05:30` : null}, coalesce(owner_id, ${actor.userId}) from leads where id = ${leadId}`);
}

export async function setTaskStatus(actor: Actor, taskId: string, status: "done" | "cancelled" | "open") {
  assertAdmin(actor);
  await withDb(actor, (tx) => tx`update lead_tasks set status = ${status}, completed_at = case when ${status} = 'done' then now() else null end where id = ${taskId}`);
}

export async function listOpenTasks(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ id: string; lead_id: string; description: string; due_at: Date | null; business_name: string; assignee_name: string | null }[]>`
    select t.id, t.lead_id, t.description, t.due_at, l.business_name, u.name as assignee_name from lead_tasks t join leads l on l.id = t.lead_id
    left join users u on u.id = t.assigned_to where t.status = 'open' order by t.due_at nulls last limit 100`);
}

/** Turn a lead into a client (or link the existing client with the same email) so the proposal builder can be used. */
export async function convertLeadToClient(actor: Actor, leadId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [l] = await tx<Lead[]>`select * from leads where id = ${leadId}`;
    if (!l) throw notFound();
    if (l.client_id) return l.client_id;
    if (!l.email) throw new AppError("Add the prospect's email before creating a client record.");
    const [existing] = await tx<{ id: string }[]>`select id from client_profiles where lower(email) = lower(${l.email}) limit 1`;
    const clientId = existing?.id ?? (await tx<{ id: string }[]>`
      insert into client_profiles (business_name, owner_name, email, phone, business_category)
      values (${l.business_name}, ${l.contact_name ?? l.business_name}, ${l.email.toLowerCase()}, ${l.phone}, ${l.business_category}) returning id`)[0].id;
    await tx`update leads set client_id = ${clientId} where id = ${leadId}`;
    await tx`insert into lead_activities (lead_id, actor_id, kind, body) values (${leadId}, ${actor.userId}, 'system', ${existing ? "Linked to the existing client record" : "Client record created for proposals"})`;
    await audit(tx, actor, "lead.converted_to_client", "lead", leadId, null, { client_id: clientId, existing: !!existing });
    return clientId;
  });
}

// ---------------------------------------------------------------------------
// 7. Proposal and payment hooks → conversion and attribution
// ---------------------------------------------------------------------------
/** Called by the proposal module when a proposal for a client is sent or accepted. */
export async function onProposalEvent(clientId: string, kind: "sent" | "accepted", proposalId: string) {
  const s = await getReferralSettings();
  const leads = await withDb(SYSTEM, (tx) => tx<{ id: string; stage: Stage }[]>`select id, stage from leads where client_id = ${clientId} and stage not in ('won', 'lost', 'disqualified')`);
  for (const l of leads) {
    await withDb(SYSTEM, async (tx) => {
      if (kind === "sent") {
        await tx`update leads set proposal_sent_at = coalesce(proposal_sent_at, now()), verified_at = coalesce(verified_at, now()), qualified_at = coalesce(qualified_at, now()),
                   stage = case when stage in ('enquiry_submitted', 'verification_pending', 'qualified', 'call_scheduled', 'call_completed') then 'proposal_sent' else stage end where id = ${l.id}`;
      } else {
        await tx`update leads set proposal_accepted_at = coalesce(proposal_accepted_at, now()), proposal_sent_at = coalesce(proposal_sent_at, now()),
                   stage = case when stage <> 'negotiation' then 'negotiation' else stage end where id = ${l.id}`;
      }
      await tx`insert into lead_activities (lead_id, kind, body, data) values (${l.id}, 'proposal', ${kind === "sent" ? "Proposal sent" : "Proposal accepted by the client"}, ${tx.json({ proposal_id: proposalId } as never)})`;
    });
    await emit(kind === "sent" ? "referral.proposal.sent" : "referral.proposal.accepted", `referral.proposal.${kind}:${l.id}:${proposalId}`, { lead_id: l.id, client_id: clientId }, { proposal_id: proposalId });
    if (kind === "accepted" && s.conversion_rule === "proposal_accepted") await recomputeConversion(clientId);
  }
}

/** Called after a payment's status changes. Conversion follows the net of confirmed minus refunded payments. */
export async function onPaymentChanged(paymentId: string) {
  const [x] = await withDb(SYSTEM, (tx) => tx<{ client_id: string }[]>`select p.client_id from payments x join projects p on p.id = x.project_id where x.id = ${paymentId}`);
  if (x) await recomputeConversion(x.client_id);
}

export async function recomputeConversion(clientId: string) {
  const s = await getReferralSettings();
  const leads = await withDb(SYSTEM, (tx) => tx<{ id: string; converted_at: Date | null; proposal_accepted_at: Date | null }[]>`
    select id, converted_at, proposal_accepted_at from leads where client_id = ${clientId} and stage not in ('lost', 'disqualified')`);
  for (const l of leads) {
    const state = await withDb(SYSTEM, async (tx) => {
      const [r] = await tx<{ net: number; first: Date | null }[]>`select ${revenueSql(tx, clientId)} as net,
        (select min(coalesce(x.confirmed_at, x.created_at)) from payments x join projects p on p.id = x.project_id where p.client_id = ${clientId} and x.status = 'confirmed') as first`;
      const converted = s.conversion_rule === "proposal_accepted" ? !!l.proposal_accepted_at : Number(r.net) > 0;
      const at = s.conversion_rule === "proposal_accepted" ? l.proposal_accepted_at : r.first;
      if (converted && !l.converted_at) {
        await tx`update leads set converted_at = ${at ?? new Date()}, stage = 'won', closed_at = now(), qualified_at = coalesce(qualified_at, now()), verified_at = coalesce(verified_at, now()) where id = ${l.id}`;
        await tx`insert into lead_activities (lead_id, kind, body) values (${l.id}, 'payment', ${s.conversion_rule === "proposal_accepted" ? "Converted: proposal accepted" : "Converted: first payment confirmed"})`;
        return "converted";
      }
      if (!converted && l.converted_at) {
        await tx`update leads set converted_at = null, stage = 'negotiation', closed_at = null where id = ${l.id}`;
        await tx`insert into lead_activities (lead_id, kind, body) values (${l.id}, 'payment', 'Conversion reversed: payments were refunded or reversed')`;
        return "reversed";
      }
      return null;
    });
    if (state === "converted") await emit("referral.converted", `referral.converted:${l.id}`, { lead_id: l.id, client_id: clientId });
    if (state === "reversed") await emit("referral.conversion.reversed", `referral.conversion.reversed:${l.id}:${Date.now()}`, { lead_id: l.id, client_id: clientId });
  }
}

HANDLERS["referral.converted"] = async ({ lead_id }) => {
  const s = await getReferralSettings();
  const info = await withDb(SYSTEM, async (tx) => {
    const [a] = await tx<{ referrer_client_id: string; business_name: string }[]>`select a.referrer_client_id, l.business_name from referral_attributions a join leads l on l.id = a.lead_id where a.lead_id = ${lead_id!}`;
    const [l] = await tx<{ business_name: string; owner_id: string | null }[]>`select business_name, owner_id from leads where id = ${lead_id!}`;
    await notifyAdmins(tx, null, { type: "referral_converted", link: `/admin/referrals/leads/${lead_id}`, title: `Referral converted: ${l?.business_name ?? "a lead"} is now a paying client` });
    if (!a) return null;
    await notifyClientUsers(tx, null, a.referrer_client_id, { type: "referral_success", link: "/portal/referrals", title: "Thank you! One of your referrals became a client of Infinity Web & Apps." });
    return { referrer: await clientContact(tx, a.referrer_client_id) };
  });
  if (info && s.email_enabled && !info.referrer.referral_emails_opt_out) {
    await referralEmail({ key: `converted:${lead_id}`, to: info.referrer.email, subject: `Thank you for your referral!`,
      body: `Hi ${info.referrer.owner_name},\n\nGreat news — a business you referred has started working with ${company().name}. Thank you for recommending us!\n\nSee your referrals: ${appUrl()}/portal/referrals\n\n${company().name}` });
  }
};

// Events that are recorded for the timeline/analytics but need no extra side effects.
for (const t of ["referral.link.visited", "referral.proposal.sent", "referral.proposal.accepted", "referral.conversion.reversed"] as EventType[]) HANDLERS[t] = async () => undefined;

// ---------------------------------------------------------------------------
// Admin: events log and workflows
// ---------------------------------------------------------------------------
export async function listEvents(actor: Actor, status?: string) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ id: string; type: string; dedupe_key: string; status: string; attempts: number; error: string | null; created_at: Date; processed_at: Date | null;
    lead_id: string | null; project_id: string | null; payload: Record<string, unknown> }[]>`
    select id, type, dedupe_key, status, attempts, error, created_at, processed_at, lead_id, project_id, payload from referral_events
    where ${status ? tx`status = ${status}` : tx`true`} order by created_at desc limit 300`);
}

export async function listWorkflows(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ id: string; status: string; status_reason: string | null; completed_at: Date; feedback_requested_at: Date | null; reminders_sent: number;
    next_reminder_at: Date | null; project_id: string; project_name: string; business_name: string; sentiment: string | null }[]>`
    select w.id, w.status, w.status_reason, w.completed_at, w.feedback_requested_at, w.reminders_sent, w.next_reminder_at, w.project_id, p.name as project_name, c.business_name, f.sentiment
    from referral_workflows w join projects p on p.id = w.project_id join client_profiles c on c.id = w.client_id left join project_feedback f on f.workflow_id = w.id
    order by w.updated_at desc limit 300`);
}

export { HANDLERS as _handlers };
