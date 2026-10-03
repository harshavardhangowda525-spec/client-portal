import { z } from "zod";
import { withDb, SYSTEM, assertAdmin, audit, getProjectFor, type Actor, type Tx } from "./core";
import { parse, text, optText, email as emailSchema, optDate, uuid } from "./validate";
import { DEFAULT_MILESTONES } from "./defaults";
import { AppError, notFound, conflict } from "@/lib/errors";
import { randomToken, sha256, hashPassword, verifyPassword } from "@/lib/crypto";
import { appUrl, company } from "@/lib/config";
import { sendEmail, escapeHtml, type DeliveryResult } from "./delivery";
import { createSession, validatePasswordStrength } from "./auth";
import { notifyAdmins } from "./notify";

export const INVITE_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
const clientSchema = z.object({
  business_name: text(200),
  owner_name: text(200),
  email: emailSchema,
  phone: optText(40),
  business_category: optText(100),
  address: optText(500),
});

export async function createClient(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const d = parse(clientSchema, input);
  return withDb(actor, async (tx) => {
    const [c] = await tx<{ id: string }[]>`insert into client_profiles ${tx(d)} returning id`;
    await audit(tx, actor, "client.created", "client", c.id, null, { business_name: d.business_name });
    return c.id;
  });
}

export async function updateClient(actor: Actor, clientId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(clientSchema, input);
  return withDb(actor, async (tx) => {
    const r = await tx`update client_profiles set ${tx(d)} where id = ${clientId}`;
    if (r.count === 0) throw notFound("Client not found.");
    await audit(tx, actor, "client.updated", "client", clientId, null, d);
  });
}

export async function listClients(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{
    id: string; business_name: string; owner_name: string; email: string; phone: string | null;
    business_category: string | null; portal_access_revoked_at: Date | null; is_sample: boolean;
    project_count: number; user_count: number; created_at: Date;
  }[]>`
    select c.*, (select count(*)::int from projects p where p.client_id = c.id) as project_count,
           (select count(*)::int from users u where u.client_id = c.id and u.disabled_at is null) as user_count
    from client_profiles c order by c.created_at desc`);
}

export async function getClient(actor: Actor, clientId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [client] = await tx`select * from client_profiles where id = ${clientId}`;
    if (!client) throw notFound("Client not found.");
    const projects = await tx`select id, name, project_type, status, current_stage, start_date, target_delivery_date, created_at
                              from projects where client_id = ${clientId} order by created_at desc`;
    const users = await tx`select id, name, email, disabled_at, last_login_at, created_at from users where client_id = ${clientId} order by created_at`;
    const invitations = await tx`select i.id, i.email, i.project_id, i.expires_at, i.accepted_at, i.revoked_at, i.last_sent_at, i.send_count, i.created_at,
                                        p.name as project_name
                                 from client_invitations i left join projects p on p.id = i.project_id
                                 where i.client_id = ${clientId} order by i.created_at desc`;
    return { client, projects, users, invitations };
  });
}

export async function listAdmins(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ id: string; name: string; email: string }[]>`
    select id, name, email from users where role = 'admin' and disabled_at is null order by name`);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
const projectSchema = z.object({
  name: text(200),
  project_type: z.enum(["website", "ecommerce", "mobile_app", "web_app", "branding", "maintenance", "other"]),
  description: optText(5000),
  project_manager_id: z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable()),
  start_date: optDate,
  target_delivery_date: optDate,
});

export async function createProject(actor: Actor, clientId: string, input: unknown, opts: { defaultMilestones?: boolean } = {}) {
  assertAdmin(actor);
  const d = parse(projectSchema, input);
  if (d.start_date && d.target_delivery_date && d.target_delivery_date < d.start_date) {
    throw new AppError("Delivery date must be after the start date.");
  }
  return withDb(actor, async (tx) => {
    const [client] = await tx`select id from client_profiles where id = ${clientId}`;
    if (!client) throw notFound("Client not found.");
    const [p] = await tx<{ id: string }[]>`
      insert into projects ${tx({ ...d, client_id: clientId, current_stage: "Proposal and quotation" })} returning id`;
    if (opts.defaultMilestones !== false) {
      const rows = DEFAULT_MILESTONES.map((m, i) => ({ project_id: p.id, position: i + 1, ...m }));
      await tx`insert into milestones ${tx(rows)}`;
    }
    // Existing portal users of this client automatically get access to the new project.
    await tx`insert into project_members (project_id, user_id, member_role)
             select ${p.id}, u.id, 'client' from users u where u.client_id = ${clientId} and u.disabled_at is null
             on conflict do nothing`;
    await audit(tx, actor, "project.created", "project", p.id, p.id, { name: d.name });
    return p.id;
  });
}

export async function updateProject(actor: Actor, projectId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(projectSchema.extend({ current_stage: optText(200) }), input);
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    await tx`update projects set ${tx(d)} where id = ${projectId}`;
    await audit(tx, actor, "project.updated", "project", projectId, projectId, d);
  });
}

const STATUS_TRANSITIONS: Record<string, string[]> = {
  proposal: ["quotation_accepted", "declined", "cancelled", "on_hold"],
  quotation_accepted: ["active", "on_hold", "cancelled"],
  active: ["awaiting_client", "on_hold", "completed", "cancelled"],
  awaiting_client: ["active", "on_hold", "completed", "cancelled"],
  on_hold: ["active", "awaiting_client", "proposal", "cancelled"],
  completed: ["active"],
  cancelled: ["proposal", "active"],
  declined: ["proposal"],
};

export async function setProjectStatus(actor: Actor, projectId: string, status: string, reason?: string | null) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const p = await getProjectFor(tx, actor, projectId);
    if (p.status === status) return;
    if (!STATUS_TRANSITIONS[p.status]?.includes(status)) {
      throw new AppError(`A project cannot move from "${p.status}" to "${status}".`);
    }
    await tx`update projects set status = ${status},
              completed_at = ${status === "completed" ? tx`now()` : null},
              cancelled_at = ${status === "cancelled" ? tx`now()` : null},
              cancel_reason = ${status === "cancelled" || status === "declined" ? reason ?? null : null}
             where id = ${projectId}`;
    await audit(tx, actor, "project.status_changed", "project", projectId, projectId, { from: p.status, to: status, reason });
  });
}

/**
 * After the client accepts a quotation, the admin explicitly confirms commencement.
 * Nothing is deployed and no payment is marked as received here.
 */
export async function commenceProject(actor: Actor, projectId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(z.object({ start_date: optDate, target_delivery_date: optDate, current_stage: optText(200) }), input);
  return withDb(actor, async (tx) => {
    const p = await getProjectFor(tx, actor, projectId);
    if (!["quotation_accepted", "proposal", "on_hold"].includes(p.status)) {
      throw new AppError("This project has already been activated.");
    }
    const [accepted] = await tx`select 1 from quotation_versions where project_id = ${projectId} and status = 'accepted' limit 1`;
    if (!accepted) throw new AppError("The client must accept a quotation before the project can commence.");
    await tx`update projects set status = 'active', commenced_at = now(),
               start_date = coalesce(${d.start_date}, start_date, current_date),
               target_delivery_date = coalesce(${d.target_delivery_date}, target_delivery_date),
               current_stage = coalesce(${d.current_stage}, 'Project kick-off')
             where id = ${projectId}`;
    await audit(tx, actor, "project.commenced", "project", projectId, projectId, d);
  });
}

export async function addInternalNote(actor: Actor, projectId: string, body: string) {
  assertAdmin(actor);
  const b = parse(text(10000), body);
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    await tx`insert into project_internal_notes (project_id, author_id, body) values (${projectId}, ${actor.userId}, ${b})`;
  });
}

// ---------------------------------------------------------------------------
// Invitations & access
// ---------------------------------------------------------------------------
export type InvitationResult = { invitationId: string; link: string; email: DeliveryResult | null };

function inviteLink(token: string) {
  return `${appUrl()}/invite/${token}`;
}

async function issueInvitation(tx: Tx, actor: Actor, clientId: string, projectId: string | null, toEmail: string) {
  const token = randomToken();
  // Only one live invitation per client email: older pending ones are revoked.
  await tx`update client_invitations set revoked_at = now()
           where client_id = ${clientId} and lower(email) = ${toEmail} and accepted_at is null and revoked_at is null`;
  const [inv] = await tx<{ id: string }[]>`
    insert into client_invitations (client_id, project_id, email, token_hash, expires_at, created_by)
    values (${clientId}, ${projectId}, ${toEmail}, ${sha256(token)}, now() + make_interval(days => ${INVITE_TTL_DAYS}), ${actor.userId})
    returning id`;
  return { id: inv.id, token };
}

export async function inviteClient(actor: Actor, clientId: string, input: unknown, opts: { sendEmail?: boolean } = {}): Promise<InvitationResult> {
  assertAdmin(actor);
  const d = parse(z.object({ email: emailSchema, project_id: z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable()) }), input);
  const { inv, client } = await withDb(actor, async (tx) => {
    const [client] = await tx<{ id: string; owner_name: string; business_name: string; portal_access_revoked_at: Date | null }[]>`
      select id, owner_name, business_name, portal_access_revoked_at from client_profiles where id = ${clientId}`;
    if (!client) throw notFound("Client not found.");
    if (client.portal_access_revoked_at) throw new AppError("Portal access is revoked for this client. Restore access first.");
    if (d.project_id) {
      const [p] = await tx`select 1 from projects where id = ${d.project_id} and client_id = ${clientId}`;
      if (!p) throw new AppError("The selected project does not belong to this client.");
    }
    const [existing] = await tx<{ role: string; client_id: string | null }[]>`select role, client_id from users where lower(email) = ${d.email}`;
    if (existing && (existing.role !== "client" || existing.client_id !== clientId)) {
      throw conflict("This email address is already used by another account.");
    }
    const inv = await issueInvitation(tx, actor, clientId, d.project_id, d.email);
    await audit(tx, actor, "invitation.created", "invitation", inv.id, d.project_id, { email: d.email });
    return { inv, client };
  });
  const link = inviteLink(inv.token);
  const email = opts.sendEmail ? await emailInvitation(inv.id, d.email, client.owner_name, client.business_name, link, d.project_id) : null;
  return { invitationId: inv.id, link, email };
}

async function emailInvitation(invId: string, to: string, ownerName: string, business: string, link: string, projectId: string | null) {
  const co = company().name;
  const res = await sendEmail({
    to, purpose: "invitation", projectId,
    subject: `Your private project portal — ${co}`,
    text: `Hi ${ownerName},\n\n${co} has created a private project portal for ${business}. Use the link below to set up your access. The link works once and expires in ${INVITE_TTL_DAYS} days.\n\n${link}\n\nIf you were not expecting this email you can ignore it.`,
    html: `<p>Hi ${escapeHtml(ownerName)},</p><p>${escapeHtml(co)} has created a private project portal for <strong>${escapeHtml(business)}</strong>.</p>
           <p><a href="${escapeHtml(link)}">Open your project portal</a></p>
           <p style="color:#666">The link works once and expires in ${INVITE_TTL_DAYS} days.</p>`,
  });
  await withDb(SYSTEM, (tx) => tx`update client_invitations set last_sent_at = case when ${res.status} = 'sent' then now() else last_sent_at end,
                                   send_count = send_count + case when ${res.status} = 'sent' then 1 else 0 end where id = ${invId}`);
  return res;
}

/** Resending issues a fresh token (tokens are stored only as hashes) and invalidates the old link. */
export async function resendInvitation(actor: Actor, invitationId: string, opts: { sendEmail?: boolean } = {}): Promise<InvitationResult> {
  assertAdmin(actor);
  const [old] = await withDb(actor, (tx) => tx<{ client_id: string; project_id: string | null; email: string; accepted_at: Date | null }[]>`
    select client_id, project_id, email, accepted_at from client_invitations where id = ${invitationId}`);
  if (!old) throw notFound("Invitation not found.");
  if (old.accepted_at) throw new AppError("This invitation has already been accepted.");
  return inviteClient(actor, old.client_id, { email: old.email, project_id: old.project_id }, opts);
}

export async function revokeInvitation(actor: Actor, invitationId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const r = await tx`update client_invitations set revoked_at = now() where id = ${invitationId} and accepted_at is null and revoked_at is null returning project_id`;
    if (r.count === 0) throw new AppError("Invitation is not pending.");
    await audit(tx, actor, "invitation.revoked", "invitation", invitationId, r[0].project_id);
  });
}

export async function setPortalAccess(actor: Actor, clientId: string, enabled: boolean) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const r = await tx`update client_profiles set portal_access_revoked_at = ${enabled ? null : tx`now()`} where id = ${clientId}`;
    if (r.count === 0) throw notFound("Client not found.");
    if (!enabled) {
      await tx`delete from sessions where user_id in (select id from users where client_id = ${clientId})`;
      await tx`update client_invitations set revoked_at = now() where client_id = ${clientId} and accepted_at is null and revoked_at is null`;
    }
    await audit(tx, actor, enabled ? "client.access_restored" : "client.access_revoked", "client", clientId, null);
  });
}

type InvitationView = {
  state: "valid" | "expired" | "used" | "revoked" | "invalid";
  email?: string; businessName?: string; ownerName?: string; hasAccount?: boolean;
};

export async function inspectInvitation(token: string): Promise<InvitationView> {
  if (!token || token.length > 100) return { state: "invalid" };
  return withDb(SYSTEM, async (tx) => {
    const [i] = await tx<{ email: string; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null;
      business_name: string; owner_name: string; access_revoked: Date | null; has_account: boolean }[]>`
      select i.email, i.expires_at, i.accepted_at, i.revoked_at, c.business_name, c.owner_name,
             c.portal_access_revoked_at as access_revoked,
             exists (select 1 from users u where lower(u.email) = lower(i.email)) as has_account
      from client_invitations i join client_profiles c on c.id = i.client_id
      where i.token_hash = ${sha256(token)}`;
    if (!i) return { state: "invalid" };
    if (i.accepted_at) return { state: "used" };
    if (i.revoked_at || i.access_revoked) return { state: "revoked" };
    if (new Date(i.expires_at) < new Date()) return { state: "expired" };
    return { state: "valid", email: i.email, businessName: i.business_name, ownerName: i.owner_name, hasAccount: i.has_account };
  });
}

/**
 * Consume a single-use invitation. New users choose a password; existing client users
 * confirm with their current password. Returns a new session.
 */
export async function acceptInvitation(token: string, input: { name?: string; password: string }, ip?: string | null, ua?: string | null) {
  if (!token || token.length > 100) throw new AppError("This invitation link is invalid.");
  const userId = await withDb(SYSTEM, async (tx) => {
    const [inv] = await tx<{ id: string; client_id: string; project_id: string | null; email: string }[]>`
      update client_invitations i set accepted_at = now()
      from client_profiles c
      where i.token_hash = ${sha256(token)} and c.id = i.client_id and c.portal_access_revoked_at is null
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      returning i.id, i.client_id, i.project_id, i.email`;
    if (!inv) throw new AppError("This invitation link is invalid, expired or has already been used.");

    const [existing] = await tx<{ id: string; role: string; client_id: string | null; disabled_at: Date | null }[]>`
      select id, role, client_id, disabled_at from users where lower(email) = lower(${inv.email})`;
    let uid: string;
    if (existing) {
      if (existing.role !== "client" || existing.client_id !== inv.client_id) throw new AppError("This invitation cannot be used with this account.");
      const [cred] = await tx<{ password_hash: string }[]>`select password_hash from user_credentials where user_id = ${existing.id}`;
      if (!cred || !(await verifyPassword(input.password, cred.password_hash))) throw new AppError("Incorrect password for this account.");
      await tx`update users set disabled_at = null where id = ${existing.id}`;
      uid = existing.id;
    } else {
      const name = parse(text(200), input.name ?? "");
      const weak = validatePasswordStrength(input.password);
      if (weak) throw new AppError(weak);
      const [u] = await tx<{ id: string }[]>`
        insert into users (email, name, role, client_id) values (${inv.email.toLowerCase()}, ${name}, 'client', ${inv.client_id}) returning id`;
      await tx`insert into user_credentials (user_id, password_hash) values (${u.id}, ${await hashPassword(input.password)})`;
      uid = u.id;
    }
    await tx`update client_invitations set accepted_user_id = ${uid} where id = ${inv.id}`;
    // Membership: the invited project, or every project of the client when none was specified.
    await tx`insert into project_members (project_id, user_id, member_role)
             select p.id, ${uid}, 'client' from projects p
             where p.client_id = ${inv.client_id} and (${inv.project_id}::uuid is null or p.id = ${inv.project_id})
             on conflict do nothing`;
    await audit(tx, null, "invitation.accepted", "invitation", inv.id, inv.project_id, { user_id: uid, email: inv.email }, ip);
    await notifyAdmins(tx, null, { type: "invitation_accepted", title: `${inv.email} joined the client portal`, projectId: inv.project_id,
      link: inv.project_id ? `/admin/projects/${inv.project_id}` : `/admin/clients/${inv.client_id}` });
    return uid;
  });
  return createSession(userId, ip, ua);
}

export async function grantProjectAccess(actor: Actor, projectId: string, userId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const p = await getProjectFor(tx, actor, projectId);
    const [u] = await tx`select 1 from users where id = ${userId} and client_id = ${p.client_id}`;
    if (!u) throw new AppError("User does not belong to this client.");
    await tx`insert into project_members (project_id, user_id) values (${projectId}, ${userId}) on conflict do nothing`;
  });
}
