import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getClient, listAdmins } from "@/server/clients";
import { Badge, Empty, PageHead, Panel, ProjectBadge } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { ClientForm } from "../client-form";
import { NewProjectForm } from "./new-project";
import { InvitePanel } from "./invite";
import { updateClientAction, revokeInvitationAction, setPortalAccessAction } from "@/app/actions/admin";
import { fmtDate, fmtDateTime, PROJECT_TYPES } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { integrations } from "@/lib/config";

export const metadata = { title: "Client" };
export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const actor = await requireAdmin();
  const { clientId } = await params;
  let data: Awaited<ReturnType<typeof getClient>>;
  try { data = await getClient(actor, clientId); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const admins = await listAdmins(actor);
  const { client, projects, users, invitations } = data as unknown as {
    client: { id: string; business_name: string; owner_name: string; email: string; phone: string | null; business_category: string | null; address: string | null; portal_access_revoked_at: Date | null; is_sample: boolean };
    projects: { id: string; name: string; project_type: string; status: string; target_delivery_date: string | null }[];
    users: { id: string; name: string; email: string; disabled_at: Date | null; last_login_at: Date | null }[];
    invitations: { id: string; email: string; project_name: string | null; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null; last_sent_at: Date | null; created_at: Date }[];
  };
  const revoked = !!client.portal_access_revoked_at;
  return (
    <>
      <PageHead eyebrow={<Link href="/admin/clients">Clients</Link>} title={<>{client.business_name} {client.is_sample && <Badge plain>Sample</Badge>}</>}
        sub={`${client.owner_name} · ${client.email}${client.phone ? ` · ${client.phone}` : ""}`} />
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Projects">
            {projects.length === 0 ? <p className="small muted" style={{ marginBottom: 14 }}>No projects yet. Create one below.</p> : (
              <div className="list" style={{ marginBottom: 14 }}>
                {projects.map((p) => (
                  <Link key={p.id} href={`/admin/projects/${p.id}`} className="list-item">
                    <div className="grow"><div style={{ fontWeight: 500 }}>{p.name}</div><div className="tiny faint">{PROJECT_TYPES[p.project_type]}{p.target_delivery_date ? ` · delivery ${fmtDate(p.target_delivery_date)}` : ""}</div></div>
                    <ProjectBadge status={p.status} />
                  </Link>
                ))}
              </div>
            )}
            <details open={projects.length === 0}>
              <summary className="btn btn-sm">+ New project</summary>
              <div style={{ marginTop: 14 }}><NewProjectForm clientId={client.id} admins={admins} defaultManager={actor.userId} /></div>
            </details>
          </Panel>
          <Panel title="Client profile"><ClientForm action={updateClientAction.bind(null, client.id)} client={client} submitLabel="Save changes" /></Panel>
        </div>
        <div className="stack">
          <Panel title="Portal access" sub={revoked ? "Access is revoked. The client cannot sign in." : "Invite the client with a private, single-use link."}>
            {revoked ? (
              <div className="stack">
                <div className="notice error">Portal access revoked on {fmtDate(client.portal_access_revoked_at)}.</div>
                <ActionButton action={setPortalAccessAction.bind(null, client.id, true)} className="btn">Restore access</ActionButton>
              </div>
            ) : (
              <InvitePanel clientId={client.id} email={client.email} phone={client.phone} ownerName={client.owner_name}
                projects={projects.map((p) => ({ id: p.id, name: p.name }))} emailConfigured={integrations().email} />
            )}
          </Panel>
          <Panel title="Portal users">
            {users.length === 0 ? <p className="small muted">Nobody has joined yet.</p> : (
              <div className="list">{users.map((u) => (
                <div key={u.id} className="list-item"><div className="grow"><div className="small" style={{ fontWeight: 500 }}>{u.name}</div><div className="tiny faint">{u.email} · last sign-in {u.last_login_at ? fmtDateTime(u.last_login_at) : "never"}</div></div></div>
              ))}</div>
            )}
            {!revoked && users.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <ActionButton action={setPortalAccessAction.bind(null, client.id, false)} className="btn btn-sm btn-danger"
                  confirm="Revoke portal access? The client will be signed out immediately and pending invitations will stop working.">Revoke portal access</ActionButton>
              </div>
            )}
          </Panel>
          <Panel title="Invitations">
            {invitations.length === 0 ? <Empty icon="link" title="No invitations sent" /> : (
              <div className="list">{invitations.map((i) => {
                const state = i.accepted_at ? "Accepted" : i.revoked_at ? "Revoked" : new Date(i.expires_at) < new Date() ? "Expired" : "Pending";
                return (
                  <div key={i.id} className="list-item" style={{ alignItems: "flex-start" }}>
                    <div className="grow">
                      <div className="small">{i.email}{i.project_name ? ` · ${i.project_name}` : ""}</div>
                      <div className="tiny faint">Created {fmtDateTime(i.created_at)} · expires {fmtDate(i.expires_at)}{i.last_sent_at ? ` · emailed ${fmtDateTime(i.last_sent_at)}` : ""}</div>
                    </div>
                    <Badge tone={state === "Accepted" ? "green" : state === "Pending" ? "blue" : ""}>{state}</Badge>
                    {state === "Pending" && <ActionButton action={revokeInvitationAction.bind(null, i.id)} className="btn btn-sm btn-ghost" confirm="Revoke this invitation link?">Revoke</ActionButton>}
                  </div>
                );
              })}</div>
            )}
            <p className="tiny faint" style={{ marginTop: 10 }}>Links are stored only as secure hashes, so a lost link cannot be shown again — create a new one instead (the old link stops working).</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
