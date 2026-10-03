import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { adminDashboard } from "@/server/dashboards";
import { Badge, Empty, PageHead, Panel, ProgressBar, ProjectBadge } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const actor = await requireAdmin();
  const { projects } = await adminDashboard(actor);
  return (
    <>
      <PageHead title="Projects" sub="All client projects, newest activity first." />
      <Panel>
        {projects.length === 0 ? <Empty icon="briefcase" title="No projects yet" action={<Link href="/admin/clients" className="btn btn-primary">Go to clients</Link>}>Projects are created from a client&apos;s page.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Project</th><th>Status</th><th style={{ minWidth: 140 }}>Progress</th><th className="hide-sm">Waiting on client</th><th className="hide-sm">Delivery</th></tr></thead>
            <tbody>{projects.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/admin/projects/${p.id}`} style={{ fontWeight: 500 }}>{p.name}</Link> {p.is_sample && <Badge plain>Sample</Badge>}<div className="tiny faint">{p.business_name}{p.currentMilestone ? ` · ${p.currentMilestone}` : ""}</div></td>
                <td><ProjectBadge status={p.status} />{p.overdueCount > 0 && <div className="tiny" style={{ color: "var(--red)", marginTop: 4 }}>{p.overdueCount} overdue milestone(s)</div>}</td>
                <td><div className="row" style={{ gap: 8 }}><div style={{ flex: 1 }}><ProgressBar value={p.progress} /></div><span className="tiny mono">{p.progress}%</span></div></td>
                <td className="hide-sm">{p.awaitingClient || "—"}</td>
                <td className="hide-sm" style={p.deliveryOverdue ? { color: "var(--red)" } : undefined}>{fmtDate(p.target_delivery_date)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
