import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listClients } from "@/server/clients";
import { Badge, Empty, PageHead, Panel } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const actor = await requireAdmin();
  const clients = await listClients(actor);
  return (
    <>
      <PageHead title="Clients" sub="Businesses you work with and their portal access." actions={<Link href="/admin/clients/new" className="btn btn-primary"><Icon name="plus" /> New client</Link>} />
      <Panel>
        {clients.length === 0 ? <Empty icon="users" title="No clients yet" action={<Link href="/admin/clients/new" className="btn btn-primary">Add a client</Link>}>Add a client to create their project and portal.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Business</th><th>Owner</th><th className="hide-sm">Contact</th><th>Projects</th><th>Portal</th><th className="hide-sm">Added</th></tr></thead>
            <tbody>{clients.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/admin/clients/${c.id}`} style={{ fontWeight: 500 }}>{c.business_name}</Link> {c.is_sample && <Badge plain>Sample</Badge>}<div className="tiny faint">{c.business_category}</div></td>
                <td>{c.owner_name}</td>
                <td className="hide-sm small muted">{c.email}<br />{c.phone}</td>
                <td>{c.project_count}</td>
                <td>{c.portal_access_revoked_at ? <Badge tone="red">Revoked</Badge> : c.user_count ? <Badge tone="green">Active</Badge> : <Badge>Not joined</Badge>}</td>
                <td className="hide-sm small muted">{fmtDate(c.created_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}
