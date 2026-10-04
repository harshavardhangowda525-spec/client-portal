import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listProposals, PROJECT_TYPES } from "@/server/proposals";
import { Empty, Money, PageHead, Panel, PROPOSAL_STATUS, ProposalBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate, PROJECT_TYPE_LABELS } from "@/lib/format";

export const metadata = { title: "Proposals" };
export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; type?: string; sort?: string; page?: string };

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const r = await listProposals(actor, { search: sp.q, status: sp.status, type: sp.type, sort: sp.sort, page: Number(sp.page) || 1 });
  const s = r.stats;
  const qs = (over: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...over }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };
  const stat = (label: string, value: React.ReactNode, status?: string) => (
    <Link href={status ? qs({ status, page: undefined }) : qs({ status: undefined, page: undefined })} className="glass panel" style={{ padding: "14px 16px", color: "inherit",
      outline: sp.status === status && status ? "1px solid rgba(61,139,255,.5)" : undefined }}>
      <span className="tiny faint">{label}</span><div className="stat-value" style={{ fontSize: "1.25rem" }}>{value}</div>
    </Link>
  );
  return (
    <>
      <PageHead eyebrow="Sales" title="Proposals" sub="Create, price and send proposals for websites and apps."
        actions={<Link href="/admin/proposals/new" className="btn btn-primary"><Icon name="plus" /> New proposal</Link>} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {stat("Total", s.total)}
        {stat("Draft", s.draft + s.ready, "draft")}
        {stat("Sent", s.sent, "sent")}
        {stat("Viewed", s.viewed, "viewed")}
        {stat("Awaiting response", s.awaiting, "awaiting")}
        {stat("Changes requested", s.changes_requested, "changes_requested")}
        {stat("Accepted", s.accepted, "accepted")}
        {stat("Rejected", s.rejected, "rejected")}
      </div>
      <div className="grid grid-3 section">
        <Panel><span className="tiny faint">Total proposed value</span><div className="stat-value"><Money value={s.proposed_value} /></div><span className="tiny faint">Latest versions sent to clients (one-time)</span></Panel>
        <Panel><span className="tiny faint">Total accepted value</span><div className="stat-value" style={{ color: "#6ee7b7" }}><Money value={s.accepted_value} /></div><span className="tiny faint">Accepted versions (one-time)</span></Panel>
        <Panel><span className="tiny faint">Total discounts offered</span><div className="stat-value"><Money value={s.discounts} /></div><span className="tiny faint">On proposals sent to clients</span></Panel>
      </div>

      <Panel className="section">
        <form className="row" style={{ marginBottom: 14 }} role="search">
          <label className="sr-only" htmlFor="q">Search</label>
          <input id="q" name="q" className="input" placeholder="Search number, title or client…" defaultValue={sp.q ?? ""} style={{ flex: "1 1 220px" }} />
          <label className="sr-only" htmlFor="status">Status</label>
          <select id="status" name="status" className="select" defaultValue={sp.status ?? ""} style={{ width: "auto" }}>
            <option value="">All statuses</option><option value="awaiting">Awaiting response</option>
            {Object.entries(PROPOSAL_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="sr-only" htmlFor="type">Project type</label>
          <select id="type" name="type" className="select" defaultValue={sp.type ?? ""} style={{ width: "auto" }}>
            <option value="">All types</option>{PROJECT_TYPES.map((t) => <option key={t} value={t}>{PROJECT_TYPE_LABELS[t]}</option>)}
          </select>
          <label className="sr-only" htmlFor="sort">Sort</label>
          <select id="sort" name="sort" className="select" defaultValue={sp.sort ?? "newest"} style={{ width: "auto" }}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="total_desc">Highest value</option>
            <option value="total_asc">Lowest value</option><option value="expiry">Expiring soonest</option><option value="number">Number</option>
          </select>
          <button className="btn">Apply</button>
          {(sp.q || sp.status || sp.type) && <Link href="/admin/proposals" className="btn btn-ghost">Clear</Link>}
        </form>
        {r.rows.length === 0 ? (
          <Empty icon="file" title={s.total === 0 ? "No proposals yet" : "No proposals match these filters"}
            action={s.total === 0 ? <Link href="/admin/proposals/new" className="btn btn-primary">Create your first proposal</Link> : undefined} />
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Proposal</th><th className="hide-sm">Client</th><th className="hide-sm">Type</th><th>Status</th><th className="num">One-time</th><th className="hide-sm">Created</th><th className="hide-sm">Valid until</th></tr></thead>
            <tbody>{r.rows.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/admin/proposals/${p.id}`} style={{ fontWeight: 500 }}>{p.title}</Link><div className="tiny faint">{p.number} · v{p.version_no}</div></td>
                <td className="hide-sm small">{p.business_name}</td>
                <td className="hide-sm small muted">{PROJECT_TYPE_LABELS[p.project_type]}</td>
                <td><ProposalBadge status={p.status} /></td>
                <td className="num"><Money value={p.total} />{(Number(p.recurring_monthly) > 0 || Number(p.recurring_annual) > 0) && <div className="tiny faint">+ recurring</div>}</td>
                <td className="hide-sm small muted">{fmtDate(p.created_at)}</td>
                <td className="hide-sm small muted">{fmtDate(p.valid_until)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {r.pages > 1 && (
          <nav className="row-between" style={{ marginTop: 14 }} aria-label="Pagination">
            <span className="small muted">Page {r.page} of {r.pages} · {r.total} proposals</span>
            <div className="row">
              {r.page > 1 ? <Link className="btn btn-sm" href={qs({ page: String(r.page - 1) })}>Previous</Link> : <span className="btn btn-sm" aria-disabled="true">Previous</span>}
              {r.page < r.pages ? <Link className="btn btn-sm" href={qs({ page: String(r.page + 1) })}>Next</Link> : <span className="btn btn-sm" aria-disabled="true">Next</span>}
            </div>
          </nav>
        )}
      </Panel>
    </>
  );
}
