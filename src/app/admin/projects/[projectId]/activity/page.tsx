import { requireAdmin } from "@/lib/session";
import { projectActivity } from "@/server/dashboards";
import { Empty, Panel } from "@/components/ui";
import { describeAction } from "@/components/views/activity";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminActivity({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const rows = await projectActivity(actor, projectId);
  return (
    <Panel title="Audit trail" sub="Append-only record of every important action on this project.">
      {rows.length === 0 ? <Empty icon="activity" title="No activity yet" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th className="hide-sm">IP</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
              <td className="small">{r.actor_name ?? "System"}<div className="tiny faint">{r.actor_role}</div></td>
              <td className="small">{describeAction(r.action, r.data)}</td>
              <td className="hide-sm tiny faint">{r.ip ?? ""}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Panel>
  );
}
