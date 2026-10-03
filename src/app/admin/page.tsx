import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { adminDashboard } from "@/server/dashboards";
import { Badge, Empty, Money, PageHead, Panel, ProgressBar, ProjectBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate, PAYMENT_METHODS, timeAgo } from "@/lib/format";
import { describeAction } from "@/components/views/activity";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const actor = await requireAdmin();
  const d = await adminDashboard(actor);
  const live = d.projects.filter((p) => !["completed", "cancelled", "declined"].includes(p.status));
  const attention = d.accepted.length + d.changeReqs.length + d.overdueMilestones.length + d.overdueInvoices.length + d.pendingPayments.length;
  return (
    <>
      <PageHead eyebrow="Infinity Web & Apps" title={`Hello, ${actor.name.split(" ")[0]}`} sub={`${live.length} active project${live.length === 1 ? "" : "s"} · ${attention} item${attention === 1 ? "" : "s"} need attention`} />
      <div className="grid grid-3">
        <Panel><span className="tiny faint">Received (confirmed)</span><div className="stat-value"><Money value={d.money.received} /></div></Panel>
        <Panel><span className="tiny faint">Outstanding on issued invoices</span><div className="stat-value"><Money value={d.money.outstanding} /></div></Panel>
        <Panel><span className="tiny faint">Awaiting your confirmation</span><div className="stat-value"><Money value={d.money.pending} /></div></Panel>
      </div>

      {attention > 0 && (
        <Panel title={<><Icon name="alert" style={{ color: "var(--amber)" }} /> Needs attention</>} className="section">
          <div className="list">
            {d.accepted.map((p) => (
              <Link key={p.id} href={`/admin/projects/${p.id}`} className="list-item">
                <Badge tone="green" plain>Quotation accepted</Badge>
                <div className="grow small"><strong style={{ fontWeight: 500 }}>{p.business_name}</strong> accepted — confirm commencement for <em>{p.name}</em>.</div>
                <Icon name="external" />
              </Link>
            ))}
            {d.changeReqs.map((q) => (
              <Link key={q.id} href={`/admin/projects/${q.project_id}/quotations/${q.quotation_id}`} className="list-item">
                <Badge tone="amber" plain>Changes requested</Badge>
                <div className="grow small truncate">{q.number}: {q.client_response_note}</div>
                <Icon name="external" />
              </Link>
            ))}
            {d.pendingPayments.map((p) => (
              <Link key={p.id} href={`/admin/projects/${p.project_id}/billing`} className="list-item">
                <Badge tone="amber" plain>Confirm payment</Badge>
                <div className="grow small"><Money value={p.amount} /> via {PAYMENT_METHODS[p.method]} {p.reference ? `(${p.reference})` : ""} · {p.project_name}</div>
                <Icon name="external" />
              </Link>
            ))}
            {d.overdueInvoices.map((i) => (
              <Link key={i.id} href={`/admin/projects/${i.project_id}/billing`} className="list-item">
                <Badge tone="red" plain>Overdue invoice</Badge>
                <div className="grow small">{i.number} · <Money value={i.amount} /> · due {fmtDate(i.due_date)} · {i.project_name}</div>
                <Icon name="external" />
              </Link>
            ))}
            {d.overdueMilestones.map((m) => (
              <Link key={m.id} href={`/admin/projects/${m.project_id}/milestones`} className="list-item">
                <Badge tone="red" plain>Overdue milestone</Badge>
                <div className="grow small">{m.title} · due {fmtDate(m.due_date)} · {m.project_name}</div>
                <Icon name="external" />
              </Link>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid grid-main section" style={{ alignItems: "start" }}>
        <Panel title="Projects" actions={<Link href="/admin/projects" className="btn btn-sm btn-ghost">View all</Link>}>
          {d.projects.length === 0 ? (
            <Empty icon="briefcase" title="No projects yet" action={<Link href="/admin/clients/new" className="btn btn-primary"><Icon name="plus" /> Add your first client</Link>}>
              Create a client, then a project, to start the workflow.
            </Empty>
          ) : (
            <div className="list">
              {d.projects.slice(0, 10).map((p) => (
                <Link key={p.id} href={`/admin/projects/${p.id}`} className="list-item" style={{ alignItems: "flex-start" }}>
                  <div className="grow stack-sm">
                    <div className="row-between">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }} className="truncate">{p.name} {p.is_sample && <Badge plain>Sample</Badge>}</div>
                        <div className="tiny faint">{p.business_name}{p.currentMilestone ? ` · ${p.currentMilestone}` : ""}</div>
                      </div>
                      <ProjectBadge status={p.status} />
                    </div>
                    <div className="row" style={{ gap: 12 }}>
                      <div style={{ flex: 1 }}><ProgressBar value={p.progress} label={`${p.name} progress`} /></div>
                      <span className="tiny mono faint">{p.progress}%</span>
                    </div>
                    <div className="row tiny faint">
                      {p.awaitingClient > 0 && <span style={{ color: "var(--amber)" }}>{p.awaitingClient} awaiting client</span>}
                      {p.overdueCount > 0 && <span style={{ color: "var(--red)" }}>{p.overdueCount} overdue</span>}
                      {p.target_delivery_date && <span style={p.deliveryOverdue ? { color: "var(--red)" } : undefined}>Delivery {fmtDate(p.target_delivery_date)}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Recent activity">
          {d.activity.length === 0 ? <p className="small muted">No activity yet.</p> : (
            <div className="list">
              {d.activity.map((a) => (
                <div key={a.id} className="list-item" style={{ alignItems: "flex-start" }}>
                  <div className="grow">
                    <div className="small">{describeAction(a.action, a.data)}</div>
                    <div className="tiny faint">{a.actor_name ?? "System"}{a.project_name ? ` · ${a.project_name}` : ""} · {timeAgo(a.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
