import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listActionItems } from "@/server/resolve";
import { listAdmins } from "@/server/clients";
import { Badge, Empty, Panel, PriorityBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { updateActionItemAction } from "@/app/actions/resolve";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const metadata = { title: "My action items" };
export const dynamic = "force-dynamic";

export default async function ActionItems({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string }> }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const [items, admins] = await Promise.all([listActionItems(actor, { status: sp.status, mine: sp.mine === "1" }), listAdmins(actor)]);
  return (
    <Panel sub="Every email briefing and detected gap creates items here. Marking them done here is what the next daily summary reports."
      actions={<div className="row">
        <Link className="btn btn-sm" href="?">Open</Link><Link className="btn btn-sm" href="?mine=1">Mine &amp; unassigned</Link>
        <Link className="btn btn-sm" href="?status=needs_info">Needs info</Link><Link className="btn btn-sm" href="?status=all">All</Link></div>}>
      {items.length === 0 ? <Empty icon="check" title="Nothing to do">You're all caught up.</Empty> : (
        <div className="table-wrap"><table className="table table-cards">
          <thead><tr><th>Task</th><th>Client / project</th><th>Priority</th><th>Status &amp; assignment</th></tr></thead>
          <tbody>{items.map((a) => (
            <tr key={a.id} style={a.status === "done" ? { opacity: 0.55 } : undefined}>
              <td data-label="Task"><div style={{ fontWeight: 500 }}>{a.description}</div>
                <div className="tiny faint">{a.ticket_number && a.ticket_id ? <Link href={`/admin/resolve/${a.ticket_id}`}>{a.ticket_number}</Link> : "—"} · {a.source} · {fmtDateTime(a.created_at)}
                  {a.due_date ? ` · due ${fmtDate(a.due_date)}` : ""}{a.note ? ` · ${a.note}` : ""}</div></td>
              <td data-label="Client" className="small">{a.business_name}<div className="tiny faint">{a.project_name}</div></td>
              <td data-label="Priority"><PriorityBadge priority={a.priority} />{a.status === "needs_info" && <Badge tone="amber" plain>needs info</Badge>}</td>
              <td data-label="Update">
                <ActionForm action={updateActionItemAction.bind(null, a.id)} className="row" toast>
                  <select name="status" defaultValue={a.status} className="select" style={{ width: 130 }} aria-label="Status">
                    <option value="open">Open</option><option value="done">Done</option><option value="needs_info">Needs info</option></select>
                  <select name="assigned_to" defaultValue={a.assigned_to ?? ""} className="select" style={{ width: 150 }} aria-label="Assigned to">
                    <option value="">Unassigned</option>{admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  <input type="date" name="due_date" defaultValue={a.due_date ?? ""} className="input" style={{ width: 150 }} aria-label="Due date" />
                  <input name="note" defaultValue={a.note ?? ""} className="input" style={{ width: 180 }} placeholder="Note / question to client" aria-label="Note" maxLength={1000} />
                  <Submit className="btn btn-sm">Save</Submit>
                </ActionForm>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="tiny faint" style={{ marginTop: 10 }}>“Needs info” with a note sends that note to the client on the ticket and waits for their reply.</p>
    </Panel>
  );
}
