import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listFeedback, feedbackTrend } from "@/server/referrals";
import { listAdmins } from "@/server/clients";
import { Badge, Empty, Panel } from "@/components/ui";
import { ActionForm, ActionButton, Submit } from "@/components/forms";
import { Columns } from "@/components/referrals/charts";
import { updateFeedbackAction, releaseInvitationAction } from "@/app/actions/referrals";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Client feedback" };
export const dynamic = "force-dynamic";

export default async function Feedback({ searchParams }: { searchParams: Promise<{ sentiment?: string; issue?: string }> }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const [rows, trend, admins] = await Promise.all([listFeedback(actor, sp), feedbackTrend(actor), listAdmins(actor)]);
  return (
    <div className="stack">
      <Panel title="Average rating by month" sub="Overall experience (1–5).">
        <Columns title="Average rating" series={["Average rating"]} data={trend.map((t) => ({ label: t.month, values: [t.avg] }))} />
      </Panel>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <Link className="btn btn-sm" href="?">All</Link><Link className="btn btn-sm" href="?sentiment=high">4–5★</Link><Link className="btn btn-sm" href="?sentiment=moderate">3★</Link>
        <Link className="btn btn-sm" href="?sentiment=low">1–2★</Link><Link className="btn btn-sm" href="?issue=open">Open issues</Link>
      </div>
      <Panel>
        {rows.length === 0 ? <Empty icon="sparkle" title="No feedback yet">Feedback appears after clients rate completed projects.</Empty> : (
          <div className="list">{rows.map((f) => (
            <div key={f.id} className="list-item" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <div className="grow stack-sm" style={{ minWidth: 260 }}>
                <div className="row" style={{ flexWrap: "wrap" }}><strong>{f.business_name}</strong><span className="small muted">{f.project_name}</span>
                  <Badge tone={f.sentiment === "high" ? "green" : f.sentiment === "low" ? "red" : "amber"}>{f.overall}★ {f.sentiment}</Badge>
                  {f.issue_status === "open" && <Badge tone="red" plain>issue open</Badge>}<Badge plain>{f.workflow_status.replace(/_/g, " ")}</Badge></div>
                <span className="tiny faint">Satisfaction {f.satisfaction} · Quality {f.quality} · Communication {f.communication} · Delivery {f.delivery} · {fmtDateTime(f.created_at)}</span>
                {f.comments && <p className="small" style={{ margin: 0 }}>“{f.comments}”</p>}
                {f.suggestions && <p className="small muted" style={{ margin: 0 }}>Suggestion: {f.suggestions}</p>}
                {f.ai_summary && <p className="tiny" style={{ margin: 0 }}>AI summary: {f.ai_summary}</p>}
                {f.resolve_ticket_id && <Link className="tiny" href={`/admin/resolve/${f.resolve_ticket_id}`}>Service recovery ticket →</Link>}
              </div>
              <div className="stack-sm" style={{ minWidth: 240 }}>
                <ActionForm action={updateFeedbackAction.bind(null, f.id)} className="stack-sm" toast>
                  <select name="issue_status" defaultValue={f.issue_status} className="select" aria-label="Issue status"><option value="none">No issue</option><option value="open">Issue open</option><option value="resolved">Issue resolved</option></select>
                  <select name="issue_assigned_to" defaultValue={f.issue_assigned_to ?? ""} className="select" aria-label="Assign to"><option value="">Unassigned</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                  <input name="issue_note" defaultValue={f.issue_note ?? ""} className="input" placeholder="Note" aria-label="Note" maxLength={2000} />
                  <label className="check small"><input type="checkbox" name="testimonial_approved" defaultChecked={f.testimonial_approved} disabled={!f.testimonial_consent} />
                    <span>{f.testimonial_consent ? "Show as testimonial on referral pages" : "No testimonial consent"}</span></label>
                  <Submit className="btn btn-sm">Save</Submit>
                </ActionForm>
                {["on_hold", "suppressed"].includes(f.workflow_status) && f.issue_status !== "open" && (
                  <ActionButton action={releaseInvitationAction.bind(null, f.workflow_id)} className="btn btn-sm" confirm="Open the referral invitation for this client?">Open referral invitation</ActionButton>)}
              </div>
            </div>
          ))}</div>
        )}
      </Panel>
    </div>
  );
}
