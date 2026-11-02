import { requireAdmin } from "@/lib/session";
import { getResolveSettings } from "@/server/resolve";
import { adminRecipient } from "@/server/resolve-email";
import { aiConfigured } from "@/server/ai";
import { integrations } from "@/lib/config";
import { Badge, Panel } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveResolveSettingsAction } from "@/app/actions/resolve";

export const metadata = { title: "Infinity Resolve settings" };
export const dynamic = "force-dynamic";

const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="field"><span className="label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>
);

export default async function ResolveSettingsPage() {
  await requireAdmin();
  const [s, to] = await Promise.all([getResolveSettings(), adminRecipient()]);
  const st = (ok: boolean, on: string, off: string) => <Badge tone={ok ? "green" : "amber"}>{ok ? on : off}</Badge>;
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <Panel title="Settings">
        <ActionForm action={saveResolveSettingsAction} className="form-grid" toast>
          <label className="check full"><input type="checkbox" name="ai_enabled" defaultChecked={s.ai_enabled} /> AI assistant on (when off, requests go straight to you)</label>
          <F label="Administrator email" hint={`Briefings go here. Currently: ${to || "not set"}`}><input name="admin_email" type="email" className="input" defaultValue={s.admin_email} /></F>
          <F label="Daily summary hour (IST, 0–23)" hint="Runs with the daily job at 8 PM IST; see the setup notes to change the time."><input name="daily_summary_hour" type="number" min={0} max={23} className="input" defaultValue={s.daily_summary_hour} /></F>
          <F label="Max AI questions per request"><input name="max_clarification_turns" type="number" min={1} max={15} className="input" defaultValue={s.max_clarification_turns} /></F>
          <F label="Unanswered client message after (hours)"><input name="unanswered_hours" type="number" min={1} className="input" defaultValue={s.unanswered_hours} /></F>
          <F label="Pending approval after (hours)"><input name="approval_hours" type="number" min={1} className="input" defaultValue={s.approval_hours} /></F>
          <F label="Client follow-up after (hours)"><input name="client_followup_hours" type="number" min={1} className="input" defaultValue={s.client_followup_hours} /></F>
          <F label="Unverified fix after (days)"><input name="verification_days" type="number" min={1} className="input" defaultValue={s.verification_days} /></F>
          <F label="Repeated complaints threshold (14 days)"><input name="repeated_complaint_count" type="number" min={1} className="input" defaultValue={s.repeated_complaint_count} /></F>
          <F label="Urgent emails per hour (max)"><input name="urgent_max_per_hour" type="number" min={1} className="input" defaultValue={s.urgent_max_per_hour} /></F>
          <F label="Keep voice recordings (days)"><input name="voice_retention_days" type="number" min={1} max={365} className="input" defaultValue={s.voice_retention_days} /></F>
          <F label="Client messages per hour (limit)"><input name="client_messages_per_hour" type="number" min={5} className="input" defaultValue={s.client_messages_per_hour} /></F>
          <F label="New requests per client per day (limit)"><input name="client_tickets_per_day" type="number" min={1} className="input" defaultValue={s.client_tickets_per_day} /></F>
          <div className="form-actions full"><Submit>Save settings</Submit></div>
        </ActionForm>
      </Panel>
      <Panel title="Setup status">
        <div className="list">
          <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Groq AI (GROQ_API_KEY)</strong><div className="tiny faint">Clarification, briefings, gap checks and Whisper transcription.</div></div>{st(aiConfigured(), "Configured", "Not set")}</div>
          <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Email (SMTP)</strong><div className="tiny faint">Briefings, urgent alerts and daily summaries.</div></div>{st(integrations().email, "Configured", "Not set")}</div>
          <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Daily job (CRON_SECRET)</strong><div className="tiny faint">Gap detection, retries, recording clean-up and the daily summary.</div></div>{st(!!process.env.CRON_SECRET, "Set", "Not set")}</div>
          <div className="list-item"><div className="grow"><strong style={{ fontWeight: 500 }}>Administrator email</strong></div>{st(!!to, to, "Not set")}</div>
        </div>
        <p className="tiny faint" style={{ marginTop: 10 }}>“Configured” means the setting exists. Delivery is confirmed only by the Email briefings and AI activity tabs.</p>
      </Panel>
    </div>
  );
}
