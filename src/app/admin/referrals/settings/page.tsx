import { requireAdmin } from "@/lib/session";
import { getReferralSettings } from "@/server/referrals";
import { listAdmins } from "@/server/clients";
import { integrations, appUrl } from "@/lib/config";
import { aiConfigured } from "@/server/ai";
import { Badge, Panel } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveReferralSettingsAction } from "@/app/actions/referrals";

export const metadata = { title: "Referral settings" };
export const dynamic = "force-dynamic";
const F = ({ label, children, hint, full }: { label: string; children: React.ReactNode; hint?: string; full?: boolean }) => (
  <label className={`field${full ? " full" : ""}`}><span className="label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>);

export default async function ReferralSettingsPage() {
  const actor = await requireAdmin();
  const [s, admins] = await Promise.all([getReferralSettings(), listAdmins(actor)]);
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <Panel title="Program & rules">
        <ActionForm action={saveReferralSettingsAction} className="form-grid" toast>
          <label className="check full"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Referral program on</label>
          <label className="check full"><input type="checkbox" name="paused" defaultChecked={s.paused} /> Pause workflows (no new feedback requests, reminders or invitations)</label>
          <label className="check full"><input type="checkbox" name="email_enabled" defaultChecked={s.email_enabled} /> Send emails to clients (portal notices are always shown; clients can opt out)</label>
          <label className="check full"><input type="checkbox" name="require_no_open_complaints" defaultChecked={s.require_no_open_complaints} /> Don&apos;t ask for referrals while a complaint on the project is open</label>
          <F label="Feedback request delay (hours after completion)"><input name="feedback_delay_hours" type="number" min={0} className="input" defaultValue={s.feedback_delay_hours} /></F>
          <F label="Feedback reminders (days after the request)" hint="Comma-separated, e.g. 3, 7"><input name="reminder_days" className="input" defaultValue={s.reminder_days.join(", ")} /></F>
          <F label="“Happy” from (stars)"><input name="high_threshold" type="number" min={2} max={5} className="input" defaultValue={s.high_threshold} /></F>
          <F label="“Unhappy” at or below (stars)"><input name="low_threshold" type="number" min={1} max={4} className="input" defaultValue={s.low_threshold} /></F>
          <F label="Invitation delay after positive feedback (days)"><input name="invitation_delay_days" type="number" min={0} className="input" defaultValue={s.invitation_delay_days} /></F>
          <F label="Referral link validity (days, 0 = never expires)"><input name="link_expiry_days" type="number" min={0} className="input" defaultValue={s.link_expiry_days} /></F>
          <F label="Follow up qualified leads without a call after (days)"><input name="follow_up_days" type="number" min={1} className="input" defaultValue={s.follow_up_days} /></F>
          <F label="Remind to send a proposal after a call (days)"><input name="proposal_follow_up_days" type="number" min={1} className="input" defaultValue={s.proposal_follow_up_days} /></F>
          <F label="Default lead owner"><select name="default_owner_id" className="select" defaultValue={s.default_owner_id}><option value="">First admin</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></F>
          <F label="Max enquiries per connection per hour"><input name="max_enquiries_per_hour" type="number" min={1} className="input" defaultValue={s.max_enquiries_per_hour} /></F>
          <F label="A referral counts as converted when" full><select name="conversion_rule" className="select" defaultValue={s.conversion_rule}>
            <option value="first_payment">The referred client&apos;s first payment is confirmed (recommended)</option><option value="proposal_accepted">The referred client accepts a proposal</option></select></F>
          <F label="Share message" hint="Must contain {{link}}" full><textarea name="share_template" className="textarea" defaultValue={s.share_template} /></F>
          <F label="Landing page headline" full><input name="landing_headline" className="input" defaultValue={s.landing_headline} /></F>
          <F label="Landing page introduction" full><textarea name="landing_intro" className="textarea" defaultValue={s.landing_intro} /></F>
          <F label="Services (one per line)"><textarea name="landing_services" className="textarea" defaultValue={s.landing_services.join("\n")} /></F>
          <F label="Problems you solve (one per line)"><textarea name="landing_problems" className="textarea" defaultValue={s.landing_problems.join("\n")} /></F>
          <div className="form-actions full"><Submit>Save settings</Submit></div>
          <p className="tiny faint full" style={{ margin: 0 }}>Referral rewards are not enabled. Referring clients see their referral progress only.</p>
        </ActionForm>
      </Panel>
      <Panel title="Setup status">
        <div className="list">
          <div className="list-item"><div className="grow small">Email (SMTP)</div><Badge tone={integrations().email ? "green" : "amber"}>{integrations().email ? "Configured" : "Not set"}</Badge></div>
          <div className="list-item"><div className="grow small">Daily reminders (CRON_SECRET)</div><Badge tone={process.env.CRON_SECRET ? "green" : "amber"}>{process.env.CRON_SECRET ? "Set" : "Not set"}</Badge></div>
          <div className="list-item"><div className="grow small">AI suggestions (GROQ_API_KEY, optional)</div><Badge tone={aiConfigured() ? "green" : ""}>{aiConfigured() ? "Configured" : "Off"}</Badge></div>
          <div className="list-item"><div className="grow small">Referral links use</div><code className="tiny">{appUrl()}/r/…</code></div>
        </div>
      </Panel>
    </div>
  );
}
