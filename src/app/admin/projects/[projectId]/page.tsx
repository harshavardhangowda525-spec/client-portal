import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { projectOverview, internalNotes } from "@/server/dashboards";
import { listApprovalRequests, listMilestones } from "@/server/milestones";
import { listAdmins, getClient } from "@/server/clients";
import { Badge, Empty, Panel, ProgressRing } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { cancelApprovalAction } from "@/app/actions/admin";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { CommenceForm, ProjectSettingsForm, StatusForm, ApprovalRequestForm, InternalNoteForm } from "./overview-forms";

export const dynamic = "force-dynamic";

export default async function AdminProjectOverview({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const o = await projectOverview(actor, projectId);
  const [approvals, notes, admins, milestones, clientData] = await Promise.all([
    listApprovalRequests(actor, projectId), internalNotes(actor, projectId), listAdmins(actor), listMilestones(actor, projectId), getClient(actor, o.project.client_id),
  ]);
  const hasPortalUser = (clientData.users as unknown as { disabled_at: Date | null }[]).some((u) => !u.disabled_at);
  const pendingInvite = (clientData.invitations as unknown as { accepted_at: Date | null; revoked_at: Date | null; expires_at: Date }[])
    .some((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  const p = o.project;

  return (
    <div className="stack" style={{ gap: 18 }}>
      {p.status === "quotation_accepted" && (
        <section className="glass hero">
          <div style={{ position: "relative", zIndex: 1 }} className="stack">
            <div><span className="eyebrow">Next step</span><h2>The client accepted the quotation — activate the project</h2>
              <p className="muted small" style={{ marginTop: 4 }}>Confirm the start date and payment terms. This does not mark any payment as received or deploy anything.</p></div>
            {!hasPortalUser && (
              <div className="notice warn row-between">
                <span>{pendingInvite ? "A portal invitation is pending — the client has not joined yet." : "The client has not been invited to the portal yet."}</span>
                <Link className="btn btn-sm" href={`/admin/clients/${p.client_id}`}><Icon name="send" /> {pendingInvite ? "Resend invitation" : "Send portal invitation"}</Link>
              </div>
            )}
            <CommenceForm projectId={projectId} start={p.start_date} delivery={p.target_delivery_date} />
            <span className="small muted">Then raise the advance invoice under <Link href={`/admin/projects/${projectId}/billing`}>Invoices &amp; payments</Link>.</span>
          </div>
        </section>
      )}
      {p.status === "proposal" && !hasPortalUser && (
        <div className="notice info row-between">
          <span>{pendingInvite ? "Invitation sent — waiting for the client to join the portal." : "Invite the client to the portal so they can review and accept the quotation."}</span>
          <Link className="btn btn-sm" href={`/admin/clients/${p.client_id}`}>{pendingInvite ? "Manage invitation" : "Invite client"}</Link>
        </div>
      )}

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Status">
            <div className="row" style={{ gap: 22, alignItems: "center" }}>
              <ProgressRing value={o.progress} />
              <dl className="kv" style={{ flex: 1 }}>
                <div><dt>Current milestone</dt><dd>{o.current?.title ?? "—"}</dd></div>
                <div><dt>Next milestone</dt><dd>{o.next?.title ?? "—"}{o.next?.due_date ? ` · ${fmtDate(o.next.due_date)}` : ""}</dd></div>
                <div><dt>Start</dt><dd>{fmtDate(p.start_date)}</dd></div>
                <div><dt>Delivery</dt><dd>{fmtDate(p.target_delivery_date)}</dd></div>
                <div><dt>Overdue milestones</dt><dd style={o.overdue.length ? { color: "var(--red)" } : undefined}>{o.overdue.length}</dd></div>
                <div><dt>Commenced</dt><dd>{p.commenced_at ? fmtDate(p.commenced_at) : "Not yet"}</dd></div>
              </dl>
            </div>
            <hr />
            <StatusForm projectId={projectId} status={p.status} />
          </Panel>

          <Panel title="Client approvals & questions" sub="Recorded separately from development status.">
            {approvals.length === 0 ? <p className="small muted" style={{ marginBottom: 12 }}>No requests yet.</p> : (
              <div className="list" style={{ marginBottom: 12 }}>
                {approvals.map((a) => (
                  <div key={a.id} className="list-item" style={{ alignItems: "flex-start" }}>
                    <div className="grow stack-sm">
                      <div className="row"><strong style={{ fontWeight: 500 }}>{a.title}</strong>
                        <Badge tone={a.status === "pending" ? "amber" : a.status === "approved" || a.status === "answered" ? "green" : a.status === "cancelled" ? "" : "red"}>{a.status.replace(/_/g, " ")}</Badge>
                        <Badge plain>{a.kind}</Badge></div>
                      {a.milestone_title && <span className="tiny faint">Milestone: {a.milestone_title}</span>}
                      {a.response && <p className="small pre" style={{ color: "#c7dcff" }}>“{a.response}” — {a.responder}, {fmtDateTime(a.responded_at)}</p>}
                    </div>
                    {a.status === "pending" && <ActionButton action={cancelApprovalAction.bind(null, a.id)} className="btn btn-sm btn-ghost">Cancel</ActionButton>}
                  </div>
                ))}
              </div>
            )}
            <details><summary className="btn btn-sm">+ Request approval or feedback</summary>
              <div style={{ marginTop: 12 }}><ApprovalRequestForm projectId={projectId} milestones={milestones.map((m) => ({ id: m.id, title: m.title }))} /></div>
            </details>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Waiting on the client">
            {o.pendingActions.length === 0 ? <p className="small muted">Nothing pending.</p> : (
              <div className="list">{o.pendingActions.map((a) => <div key={a.id} className="list-item small"><Icon name="clock" style={{ color: "var(--amber)" }} /><span className="grow">{a.title}</span>{a.due && <span className="tiny faint">{fmtDate(a.due)}</span>}</div>)}</div>
            )}
          </Panel>
          <Panel title={<><Icon name="shield" /> Internal notes</>} sub="Never visible to the client.">
            <InternalNoteForm projectId={projectId} />
            {notes.length > 0 && <div className="list" style={{ marginTop: 10 }}>{notes.map((n) => (
              <div key={n.id} className="list-item" style={{ alignItems: "flex-start" }}><div className="grow"><p className="small pre">{n.body}</p><span className="tiny faint">{n.author} · {fmtDateTime(n.created_at)}</span></div></div>
            ))}</div>}
          </Panel>
          <Panel title="Project settings">
            <ProjectSettingsForm projectId={projectId} project={p} admins={admins} />
          </Panel>
          {o.latestPreview ? null : <Panel><Empty icon="monitor" title="No preview yet" action={<Link className="btn btn-sm" href={`/admin/projects/${projectId}/previews`}>Publish preview</Link>} /></Panel>}
        </div>
      </div>
    </div>
  );
}
