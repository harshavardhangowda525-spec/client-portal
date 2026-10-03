import { withDb, assertAdmin, getProjectFor, type Actor, type Tx } from "./core";
import { computeProgress, isOverdue, todayISO } from "@/lib/progress";
import { effectiveStatus } from "./quotations";
import type { Milestone } from "./milestones";

async function milestonesOf(tx: Tx, projectId: string) {
  return tx<Milestone[]>`select * from milestones where project_id = ${projectId} order by position`;
}

function milestoneSummary(ms: Milestone[]) {
  const today = todayISO();
  const current = ms.find((m) => m.status === "in_progress") ?? ms.find((m) => m.status === "awaiting_client") ?? ms.find((m) => m.status === "blocked");
  const next = ms.find((m) => m.status !== "completed" && m !== current && m.position > (current?.position ?? 0)) ?? null;
  return {
    progress: computeProgress(ms),
    current: current ?? null,
    next,
    completedCount: ms.filter((m) => m.status === "completed").length,
    total: ms.length,
    overdue: ms.filter((m) => isOverdue(m, today)),
  };
}

export type PendingAction = { kind: "quotation" | "approval" | "preview" | "invoice"; id: string; title: string; detail?: string | null; due?: string | null; href: string };

async function pendingClientActions(tx: Tx, projectId: string): Promise<PendingAction[]> {
  const actions: PendingAction[] = [];
  const quotes = await tx<{ id: string; quotation_id: string; status: string; valid_until: string; number: string; version_no: number }[]>`
    select v.id, v.quotation_id, v.status, v.valid_until, q.number, v.version_no from quotation_versions v join quotations q on q.id = v.quotation_id
    where v.project_id = ${projectId} and v.status in ('sent', 'viewed')
      and not exists (select 1 from quotation_versions n where n.quotation_id = v.quotation_id and n.version_no > v.version_no and n.status <> 'draft')`;
  for (const q of quotes.filter((q) => effectiveStatus(q) !== "expired")) {
    actions.push({ kind: "quotation", id: q.id, title: `Review quotation ${q.number}${q.version_no > 1 ? ` v${q.version_no}` : ""}`, due: q.valid_until, href: `/portal/${projectId}/quotation` });
  }
  const approvals = await tx<{ id: string; title: string; description: string | null; kind: string; due_date: string | null }[]>`
    select id, title, description, kind, due_date from approval_requests where project_id = ${projectId} and status = 'pending' order by created_at`;
  for (const a of approvals) {
    actions.push({ kind: "approval", id: a.id, title: a.title, detail: a.description, due: a.due_date, href: `/portal/${projectId}#action-${a.id}` });
  }
  const previews = await tx<{ id: string; version_no: number }[]>`
    select id, version_no from previews where project_id = ${projectId} and status = 'ready_for_review' order by version_no desc limit 1`;
  for (const p of previews) actions.push({ kind: "preview", id: p.id, title: `Review website preview v${p.version_no}`, href: `/portal/${projectId}/preview` });
  const invoices = await tx<{ id: string; number: string; due_date: string | null }[]>`
    select id, number, due_date from invoices where project_id = ${projectId} and status in ('issued', 'partially_paid') order by due_date nulls last`;
  for (const i of invoices) actions.push({ kind: "invoice", id: i.id, title: `Invoice ${i.number} awaiting payment`, due: i.due_date, href: `/portal/${projectId}/payments` });
  return actions;
}

export async function clientProjects(actor: Actor) {
  return withDb(actor, (tx) => tx<{ id: string; name: string; project_type: string; status: string; business_name: string }[]>`
    select p.id, p.name, p.project_type, p.status, c.business_name from projects p join client_profiles c on c.id = p.client_id
    where ${actor.role === "client" ? tx`exists (select 1 from project_members m where m.project_id = p.id and m.user_id = ${actor.userId})` : tx`true`}
    order by p.created_at desc`);
}

export async function projectOverview(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    const project = await getProjectFor(tx, actor, projectId);
    const [client] = await tx<{ business_name: string; owner_name: string; email: string; phone: string | null; business_category: string | null; portal_access_revoked_at: Date | null }[]>`
      select business_name, owner_name, email, phone, business_category, portal_access_revoked_at from client_profiles where id = ${project.client_id}`;
    const ms = await milestonesOf(tx, projectId);
    const [latestUpdate] = await tx<{ id: string; title: string; body: string | null; created_at: Date; kind: string }[]>`
      select id, title, body, created_at, kind from project_updates where project_id = ${projectId}
      ${actor.role === "client" ? tx`and visibility = 'client'` : tx``} order by created_at desc limit 1`;
    const [latestPreview] = await tx<{ id: string; version_no: number; url: string; status: string }[]>`
      select id, version_no, url, status from previews where project_id = ${projectId} order by version_no desc limit 1`;
    const [manager] = project.project_manager_id
      ? await tx<{ name: string; email: string }[]>`select name, email from users where id = ${project.project_manager_id}`
      : [];
    return {
      project, client, manager: manager ?? null,
      milestones: ms, ...milestoneSummary(ms),
      latestUpdate: latestUpdate ?? null, latestPreview: latestPreview ?? null,
      pendingActions: await pendingClientActions(tx, projectId),
    };
  });
}

export async function adminDashboard(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const today = todayISO();
    const projects = await tx<{ id: string; name: string; status: string; current_stage: string | null; target_delivery_date: string | null;
      business_name: string; client_id: string; is_sample: boolean }[]>`
      select p.id, p.name, p.status, p.current_stage, p.target_delivery_date, c.business_name, p.client_id, p.is_sample
      from projects p join client_profiles c on c.id = p.client_id order by p.updated_at desc`;
    const ms = await tx<(Milestone & { project_id: string })[]>`select * from milestones order by project_id, position`;
    const waiting = await tx<{ project_id: string; n: number }[]>`
      select project_id, count(*)::int as n from approval_requests where status = 'pending' group by project_id`;
    const quotesOut = await tx<{ project_id: string; n: number }[]>`
      select project_id, count(*)::int as n from quotation_versions where status in ('sent', 'viewed') and valid_until >= current_date group by project_id`;
    const changeReqs = await tx<{ project_id: string; id: string; quotation_id: string; number: string; client_response_note: string | null }[]>`
      select v.project_id, v.id, v.quotation_id, q.number, v.client_response_note from quotation_versions v join quotations q on q.id = v.quotation_id
      where v.status = 'changes_requested'
        and not exists (select 1 from quotation_versions n where n.quotation_id = v.quotation_id and n.version_no > v.version_no)`;
    const accepted = await tx<{ id: string; name: string; business_name: string }[]>`
      select p.id, p.name, c.business_name from projects p join client_profiles c on c.id = p.client_id where p.status = 'quotation_accepted'`;
    const overdueInvoices = await tx<{ id: string; project_id: string; number: string; amount: number; due_date: string; project_name: string }[]>`
      select i.id, i.project_id, i.number, i.amount, i.due_date, p.name as project_name from invoices i join projects p on p.id = i.project_id
      where i.status in ('issued', 'partially_paid') and i.due_date < current_date order by i.due_date`;
    const [money] = await tx<{ received: number; pending: number; outstanding: number }[]>`
      select coalesce((select sum(amount) from payments where status = 'confirmed'), 0) as received,
             coalesce((select sum(amount) from payments where status = 'pending'), 0) as pending,
             coalesce((select sum(i.amount - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.status = 'confirmed'), 0))
                       from invoices i where i.status in ('issued', 'partially_paid')), 0) as outstanding`;
    const pendingPayments = await tx<{ id: string; project_id: string; amount: number; method: string; reference: string | null; project_name: string }[]>`
      select pm.id, pm.project_id, pm.amount, pm.method, pm.reference, p.name as project_name
      from payments pm join projects p on p.id = pm.project_id where pm.status = 'pending' order by pm.created_at`;
    const activity = await tx<{ id: number; action: string; entity_type: string; created_at: Date; actor_name: string | null; actor_role: string | null; project_id: string | null; project_name: string | null; data: Record<string, unknown> }[]>`
      select a.id, a.action, a.entity_type, a.created_at, u.name as actor_name, a.actor_role, a.project_id, p.name as project_name, a.data
      from audit_logs a left join users u on u.id = a.actor_id left join projects p on p.id = a.project_id
      order by a.created_at desc limit 15`;
    const rows = projects.map((p) => {
      const pm = ms.filter((m) => m.project_id === p.id);
      const s = milestoneSummary(pm);
      return {
        ...p, progress: s.progress, overdueCount: s.overdue.length, currentMilestone: s.current?.title ?? null,
        awaitingClient: (waiting.find((w) => w.project_id === p.id)?.n ?? 0) + (quotesOut.find((q) => q.project_id === p.id)?.n ?? 0),
        deliveryOverdue: !!p.target_delivery_date && p.target_delivery_date < today && !["completed", "cancelled", "declined"].includes(p.status),
      };
    });
    const overdueMilestones = ms.filter((m) => isOverdue(m, today) && rows.find((r) => r.id === m.project_id && !["completed", "cancelled", "declined", "on_hold"].includes(r.status)))
      .map((m) => ({ ...m, project_name: rows.find((r) => r.id === m.project_id)?.name ?? "" }));
    return { projects: rows, overdueMilestones, changeReqs, accepted, overdueInvoices, money, pendingPayments, activity };
  });
}

export async function projectActivity(actor: Actor, projectId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    return tx<{ id: number; action: string; entity_type: string; entity_id: string | null; data: Record<string, unknown>; created_at: Date; actor_name: string | null; actor_role: string | null; ip: string | null }[]>`
      select a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at, u.name as actor_name, a.actor_role, a.ip
      from audit_logs a left join users u on u.id = a.actor_id where a.project_id = ${projectId} order by a.created_at desc limit 300`;
  });
}

export async function internalNotes(actor: Actor, projectId: string) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ id: string; body: string; created_at: Date; author: string | null }[]>`
    select n.id, n.body, n.created_at, u.name as author from project_internal_notes n left join users u on u.id = n.author_id
    where n.project_id = ${projectId} order by n.created_at desc`);
}

export async function deliveryLog(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ id: string; channel: string; recipient: string; subject: string | null; purpose: string; status: string; error: string | null; created_at: Date }[]>`
    select * from message_deliveries order by created_at desc limit 50`);
}

export async function databaseSecurityStatus(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [r] = await tx<{ rolsuper: boolean; rolbypassrls: boolean }[]>`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    const [t] = await tx<{ total: number; forced: number }[]>`
      select count(*)::int as total, count(*) filter (where relforcerowsecurity and relrowsecurity)::int as forced
      from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname <> 'schema_migrations'`;
    const [s] = await tx<{ n: number }[]>`select count(*)::int as n from client_profiles where is_sample`;
    return { rlsEnforced: !r.rolsuper && !r.rolbypassrls, tablesForced: t.forced, tablesTotal: t.total, sampleClients: s.n };
  });
}
