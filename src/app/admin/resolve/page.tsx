import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listTickets, resolveStats, CATEGORIES, STATUSES, PRIORITIES } from "@/server/resolve";
import { Badge, Empty, Panel, PriorityBadge, ResolveStatusBadge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Infinity Resolve" };
export const dynamic = "force-dynamic";

export default async function ResolveRequests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const view = sp.view ?? "all";
  const [rows, s] = await Promise.all([listTickets(actor, { view, q: sp.q, status: sp.status, priority: sp.priority, category: sp.category }), resolveStats(actor)]);
  type Row = (typeof rows)[number];
  const byAssignee = new Map<string, Row[]>();
  if (view === "assigned") for (const r of rows) byAssignee.set(r.assignee_name ?? "Unassigned", [...(byAssignee.get(r.assignee_name ?? "Unassigned") ?? []), r]);
  return (
    <div className="stack">
      <div className="grid grid-4">
        {([["Open requests", s.open, "/admin/resolve"], ["Awaiting your approval", s.approvals, "/admin/resolve?view=approvals"], ["Open gaps", s.gaps, "/admin/resolve/gaps"],
          ["Open action items", s.actions, "/admin/resolve/actions"]] as const).map(([l, n, href]) => (
          <Link key={l} href={href} className="panel" style={{ display: "block" }}><span className="tiny faint">{l}</span><div className="stat-value">{n}</div></Link>
        ))}
      </div>
      {s.urgent > 0 && <div className="notice warn">{s.urgent} high-priority request(s) are open.</div>}
      {s.new_tickets > 0 && <div className="notice info">{s.new_tickets} request(s) reached you without AI clarification (assistant unavailable). Review them directly.</div>}
      <Panel>
        <form className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }} role="search">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <input name="q" defaultValue={sp.q} className="input" style={{ flex: "1 1 220px" }} placeholder="Search ticket, client, project or text" aria-label="Search" />
          <select name="status" defaultValue={sp.status ?? ""} className="select" style={{ width: 200 }} aria-label="Status"><option value="">All statuses</option>
            {Object.entries(STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select name="priority" defaultValue={sp.priority ?? ""} className="select" style={{ width: 140 }} aria-label="Priority"><option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <select name="category" defaultValue={sp.category ?? ""} className="select" style={{ width: 200 }} aria-label="Category"><option value="">All categories</option>
            {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn">Filter</button>
        </form>
        {rows.length === 0 ? <Empty icon="inbox" title="No requests here">Client requests appear here as soon as they start talking to the assistant.</Empty> : view === "assigned" ? (
          <div className="stack">{[...byAssignee.entries()].map(([who, list]) => (
            <div key={who}><h3 className="small" style={{ margin: "4px 0 8px" }}>{who} · {list.length}</h3><TicketTable rows={list} /></div>
          ))}</div>
        ) : view === "summaries" ? (
          <div className="list">{rows.map((t) => (
            <Link key={t.id} href={`/admin/resolve/${t.id}`} className="list-item" style={{ alignItems: "flex-start" }}>
              <div className="grow stack-sm"><div className="row"><strong style={{ fontWeight: 500 }}>{t.number} · {t.title}</strong><ResolveStatusBadge status={t.status} admin /></div>
                <span className="tiny faint">{t.business_name} · {t.project_name} · {t.message_count} messages · {fmtDateTime(t.updated_at)}</span>
                <p className="small muted" style={{ margin: 0 }}>{t.summary ?? t.requirement ?? t.original_message.slice(0, 300)}</p></div>
            </Link>
          ))}</div>
        ) : <TicketTable rows={rows} />}
      </Panel>
    </div>
  );
}

function TicketTable({ rows }: { rows: Awaited<ReturnType<typeof listTickets>>[number][] }) {
  return (
    <div className="table-wrap"><table className="table table-cards">
      <thead><tr><th>Request</th><th>Client / project</th><th>Category</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Updated</th></tr></thead>
      <tbody>{rows.map((t) => (
        <tr key={t.id}>
          <td data-label="Request"><Link href={`/admin/resolve/${t.id}`} style={{ fontWeight: 500 }}>{t.title}</Link>
            <div className="tiny faint">{t.number} · {t.source}{t.open_gaps ? ` · ` : ""}{t.open_gaps ? <Badge tone="amber" plain>{t.open_gaps} gap(s)</Badge> : null}{t.ai_failed ? " · AI unavailable" : ""}</div></td>
          <td data-label="Client" className="small">{t.business_name}<div className="tiny faint">{t.project_name}</div></td>
          <td data-label="Category" className="small">{CATEGORIES[t.category]}</td>
          <td data-label="Priority"><PriorityBadge priority={t.priority} /></td>
          <td data-label="Status"><ResolveStatusBadge status={t.status} admin /></td>
          <td data-label="Assigned" className="small">{t.assignee_name ?? "—"}</td>
          <td data-label="Updated" className="small">{fmtDateTime(t.updated_at)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
