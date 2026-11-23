import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listEvents, listWorkflows } from "@/server/referrals";
import { lastReferralJob } from "@/server/referral-jobs";
import { Badge, Panel } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { retryEventAction } from "@/app/actions/referrals";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Referral automation" };
export const dynamic = "force-dynamic";

export default async function Automation({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requireAdmin();
  const status = (await searchParams).status;
  const [events, workflows, job] = await Promise.all([listEvents(actor, status), listWorkflows(actor), lastReferralJob()]);
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{job ? `Last daily run: ${fmtDateTime(String(job.last_run_at))}.` : "The daily run hasn't happened yet."} It runs with the 9:00 AM IST scheduled job.</p>
      <Panel title="Completed-project workflows">
        <div className="table-wrap"><table className="table"><thead><tr><th>Project</th><th>Status</th><th>Feedback</th><th>Reminders</th><th>Next reminder</th></tr></thead>
          <tbody>{workflows.map((w) => (
            <tr key={w.id}><td><Link href={`/admin/projects/${w.project_id}`}>{w.project_name}</Link><div className="tiny faint">{w.business_name} · completed {fmtDateTime(w.completed_at)}</div></td>
              <td><Badge tone={w.status === "referral_eligible" ? "green" : ["suppressed", "cancelled"].includes(w.status) ? "red" : "amber"}>{w.status.replace(/_/g, " ")}</Badge>{w.status_reason && <div className="tiny faint">{w.status_reason}</div>}</td>
              <td className="small">{w.sentiment ?? "—"}</td><td className="small">{w.reminders_sent}</td><td className="small">{w.next_reminder_at ? fmtDateTime(w.next_reminder_at) : "—"}</td></tr>
          ))}</tbody></table></div>
      </Panel>
      <Panel title="Event log" actions={<div className="row"><Link className="btn btn-sm" href="?">All</Link><Link className="btn btn-sm" href="?status=failed">Failed</Link></div>}>
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Event</th><th>Status</th><th>Attempts</th><th>Related</th><th></th></tr></thead>
          <tbody>{events.map((e) => (
            <tr key={e.id}><td className="small">{fmtDateTime(e.created_at)}</td><td className="small mono">{e.type}<div className="tiny faint">{e.id}</div></td>
              <td><Badge tone={e.status === "processed" ? "green" : e.status === "failed" ? "red" : ""}>{e.status}</Badge>{e.error && <div className="tiny faint">{e.error}</div>}</td>
              <td className="small">{e.attempts}</td>
              <td className="small">{e.lead_id ? <Link href={`/admin/referrals/leads/${e.lead_id}`}>Lead</Link> : e.project_id ? <Link href={`/admin/projects/${e.project_id}`}>Project</Link> : "—"}</td>
              <td>{e.status === "failed" && <ActionButton action={retryEventAction.bind(null, e.id)} className="btn btn-sm">Retry</ActionButton>}</td></tr>
          ))}</tbody></table></div>
      </Panel>
    </div>
  );
}
