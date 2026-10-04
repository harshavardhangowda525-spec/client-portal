import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listClients } from "@/server/clients";
import { Badge, Empty, PageHead, Panel } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ archived?: string; deleted?: string; done?: string }> }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const showArchived = sp.archived === "1";
  const clients = await listClients(actor, { archived: showArchived });
  return (
    <>
      <PageHead title={showArchived ? "Archived clients" : "Clients"} sub={showArchived ? "Hidden clients whose signed and financial records are kept." : "Businesses you work with and their portal access."}
        actions={<>
          <Link href={showArchived ? "/admin/clients" : "/admin/clients?archived=1"} className="btn btn-ghost">{showArchived ? "Show active clients" : "Show archived"}</Link>
          <Link href="/admin/clients/new" className="btn btn-primary"><Icon name="plus" /> New client</Link>
        </>} />
      {sp.deleted && <div className="notice success" role="status" style={{ marginBottom: 16 }}>Client deleted permanently.</div>}
      {sp.done && <div className="notice success" role="status" style={{ marginBottom: 16 }}>Client archived. Their signed and financial records were kept, and they can no longer sign in.</div>}
      <Panel>
        {clients.length === 0 ? (showArchived ? <Empty icon="users" title="No archived clients" /> : <Empty icon="users" title="No clients yet" action={<Link href="/admin/clients/new" className="btn btn-primary">Add a client</Link>}>Add a client to create their project and portal.</Empty>) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Business</th><th>Owner</th><th className="hide-sm">Contact</th><th>Projects</th><th>Portal</th><th className="hide-sm">Added</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{clients.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/admin/clients/${c.id}`} style={{ fontWeight: 500 }}>{c.business_name}</Link> {c.is_sample && <Badge plain>Sample</Badge>}<div className="tiny faint">{c.business_category}</div></td>
                <td>{c.owner_name}</td>
                <td className="hide-sm small muted">{c.email}<br />{c.phone}</td>
                <td>{c.project_count}</td>
                <td>{c.archived_at ? <Badge>Archived</Badge> : c.portal_access_revoked_at ? <Badge tone="red">Revoked</Badge> : c.user_count ? <Badge tone="green">Active</Badge> : <Badge>Not joined</Badge>}</td>
                <td className="hide-sm small muted">{fmtDate(c.created_at)}</td>
                <td className="right">{!showArchived && (
                  <Link href={`/admin/clients/${c.id}#danger`} className="btn btn-sm btn-ghost icon-btn" aria-label={`Delete ${c.business_name}`} title="Delete client"><Icon name="trash" /></Link>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
