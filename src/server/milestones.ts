import { z } from "zod";
import { withDb, assertAdmin, audit, getProjectFor, asSystem, type Actor, type Tx } from "./core";
import { parse, text, optText, optDate, uuid } from "./validate";
import { notifyAdmins, notifyProjectClients } from "./notify";
import { AppError, notFound } from "@/lib/errors";
import { MILESTONE_STATUS } from "@/lib/format";

export type Milestone = {
  id: string; project_id: string; position: number; title: string; description: string | null;
  status: "not_started" | "in_progress" | "awaiting_client" | "completed" | "blocked";
  weight: number; start_date: string | null; due_date: string | null; completed_at: Date | null;
  blocked_reason: string | null; updated_at: Date;
};

export async function listMilestones(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const milestones = await tx<Milestone[]>`select * from milestones where project_id = ${projectId} order by position`;
    const history = await tx<{ id: string; milestone_id: string; changes: Record<string, [unknown, unknown]>; note: string | null; created_at: Date; actor_name: string | null }[]>`
      select h.id, h.milestone_id, h.changes, h.note, h.created_at, u.name as actor_name
      from milestone_history h left join users u on u.id = h.actor_id
      where h.project_id = ${projectId} order by h.created_at desc`;
    const attachments = await tx<{ id: string; milestone_id: string; name: string; mime_type: string; size_bytes: number }[]>`
      select id, milestone_id, name, mime_type, size_bytes from documents
      where project_id = ${projectId} and milestone_id is not null order by created_at`;
    return milestones.map((m) => ({
      ...m,
      history: history.filter((h) => h.milestone_id === m.id),
      attachments: attachments.filter((a) => a.milestone_id === m.id),
    }));
  });
}

const fields = {
  title: text(200),
  description: optText(5000),
  weight: z.coerce.number().min(0).max(1000),
  start_date: optDate,
  due_date: optDate,
};

export async function createMilestone(actor: Actor, projectId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(z.object(fields), input);
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(position), 0) + 1 as next from milestones where project_id = ${projectId}`;
    const [m] = await tx<{ id: string }[]>`insert into milestones ${tx({ ...d, project_id: projectId, position: next })} returning id`;
    await tx`insert into milestone_history (milestone_id, project_id, actor_id, changes, note)
             values (${m.id}, ${projectId}, ${actor.userId}, ${tx.json({ created: [null, d.title] })}, null)`;
    await audit(tx, actor, "milestone.created", "milestone", m.id, projectId, { title: d.title });
    return m.id;
  });
}

const updateSchema = z.object({
  ...fields,
  status: z.enum(["not_started", "in_progress", "awaiting_client", "completed", "blocked"]),
  blocked_reason: optText(1000),
  note: optText(2000),
});

async function loadMilestone(tx: Tx, actor: Actor, id: string) {
  const [m] = await tx<Milestone[]>`select * from milestones where id = ${id}`;
  if (!m) throw notFound("Milestone not found.");
  await getProjectFor(tx, actor, m.project_id);
  return m;
}

/** Only admins can change development status, including marking work completed. */
export async function updateMilestone(actor: Actor, milestoneId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(updateSchema, input);
  if (d.status === "blocked" && !d.blocked_reason) throw new AppError("Explain why the milestone is blocked.");
  if (d.start_date && d.due_date && d.due_date < d.start_date) throw new AppError("Due date must be after the start date.");
  return withDb(actor, async (tx) => {
    const m = await loadMilestone(tx, actor, milestoneId);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of ["title", "description", "weight", "start_date", "due_date", "status", "blocked_reason"] as const) {
      const before = (m as Record<string, unknown>)[k] ?? null;
      const after = (d as Record<string, unknown>)[k] ?? null;
      if (String(before ?? "") !== String(after ?? "")) changes[k] = [before, after];
    }
    if (Object.keys(changes).length === 0 && !d.note) return;
    const becameComplete = d.status === "completed" && m.status !== "completed";
    await tx`update milestones set title = ${d.title}, description = ${d.description}, weight = ${d.weight},
               start_date = ${d.start_date}, due_date = ${d.due_date}, status = ${d.status},
               blocked_reason = ${d.status === "blocked" ? d.blocked_reason : null},
               completed_at = ${d.status === "completed" ? (becameComplete ? tx`now()` : m.completed_at) : null},
               completed_by = ${d.status === "completed" ? actor.userId : null}
             where id = ${milestoneId}`;
    await tx`insert into milestone_history (milestone_id, project_id, actor_id, changes, note)
             values (${milestoneId}, ${m.project_id}, ${actor.userId}, ${tx.json(changes as never)}, ${d.note})`;
    await audit(tx, actor, "milestone.updated", "milestone", milestoneId, m.project_id, changes);
    if (changes.status) {
      const link = `/portal/${m.project_id}/timeline`;
      if (d.status === "awaiting_client") {
        await notifyProjectClients(tx, actor, m.project_id, { type: "milestone_review", title: `Ready for your review: ${d.title}`, body: d.note, link });
      } else if (d.status === "completed") {
        await notifyProjectClients(tx, actor, m.project_id, { type: "milestone_completed", title: `Milestone completed: ${d.title}`, body: d.note, link });
      } else if (d.status === "in_progress") {
        await tx`update projects set current_stage = ${d.title} where id = ${m.project_id}`;
      }
    }
  });
}

export async function deleteMilestone(actor: Actor, milestoneId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const m = await loadMilestone(tx, actor, milestoneId);
    await tx`delete from milestones where id = ${milestoneId}`;
    await tx`update milestones set position = position - 1 where project_id = ${m.project_id} and position > ${m.position}`;
    await audit(tx, actor, "milestone.deleted", "milestone", milestoneId, m.project_id, { title: m.title });
  });
}

export async function moveMilestone(actor: Actor, milestoneId: string, direction: "up" | "down") {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const m = await loadMilestone(tx, actor, milestoneId);
    const [other] = await tx<{ id: string; position: number }[]>`
      select id, position from milestones where project_id = ${m.project_id}
      and position ${direction === "up" ? tx`<` : tx`>`} ${m.position}
      order by position ${direction === "up" ? tx`desc` : tx`asc`} limit 1`;
    if (!other) return;
    await tx`update milestones set position = ${other.position} where id = ${m.id}`;
    await tx`update milestones set position = ${m.position} where id = ${other.id}`;
  });
}

export async function reorderMilestones(actor: Actor, projectId: string, orderedIds: string[]) {
  assertAdmin(actor);
  const ids = parse(z.array(uuid).max(200), orderedIds);
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const existing = await tx<{ id: string }[]>`select id from milestones where project_id = ${projectId}`;
    if (existing.length !== ids.length || !existing.every((e) => ids.includes(e.id))) {
      throw new AppError("Reorder must include every milestone exactly once.");
    }
    for (let i = 0; i < ids.length; i++) await tx`update milestones set position = ${i + 1} where id = ${ids[i]}`;
    await audit(tx, actor, "milestone.reordered", "project", projectId, projectId);
  });
}

// ---------------------------------------------------------------------------
// Client approvals / feedback requests (separate from development status)
// ---------------------------------------------------------------------------
const approvalSchema = z.object({
  title: text(200),
  description: optText(5000),
  kind: z.enum(["approval", "feedback", "question"]),
  milestone_id: z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable()),
  preview_id: z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable()),
  due_date: optDate,
});

export async function createApprovalRequest(actor: Actor, projectId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(approvalSchema, input);
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    if (d.milestone_id) {
      const [ok] = await tx`select 1 from milestones where id = ${d.milestone_id} and project_id = ${projectId}`;
      if (!ok) throw new AppError("Milestone does not belong to this project.");
    }
    const [r] = await tx<{ id: string }[]>`insert into approval_requests ${tx({ ...d, project_id: projectId, requested_by: actor.userId })} returning id`;
    await audit(tx, actor, "approval.requested", "approval_request", r.id, projectId, { title: d.title, kind: d.kind });
    await notifyProjectClients(tx, actor, projectId, {
      type: "feedback_requested",
      title: d.kind === "approval" ? `Approval requested: ${d.title}` : d.kind === "question" ? `Question: ${d.title}` : `Feedback requested: ${d.title}`,
      body: d.description, link: `/portal/${projectId}`,
    });
    return r.id;
  });
}

export async function respondToApproval(actor: Actor, requestId: string, input: unknown) {
  const d = parse(z.object({ decision: z.enum(["approved", "changes_requested", "answered"]), response: optText(5000) }), input);
  if (actor.role !== "client") throw new AppError("Only the client can respond to an approval request.");
  if (d.decision !== "approved" && !d.response) throw new AppError("Please add a short note with your response.");
  return withDb(actor, async (tx) => {
    const [r] = await tx<{ id: string; project_id: string; status: string; title: string; kind: string }[]>`
      select id, project_id, status, title, kind from approval_requests where id = ${requestId}`;
    if (!r) throw notFound("Request not found.");
    await getProjectFor(tx, actor, r.project_id);
    if (r.status !== "pending") throw new AppError("This request has already been answered.");
    if (r.kind === "approval" && d.decision === "answered") throw new AppError("Please approve or request changes.");
    await asSystem(tx, actor, () => tx`
      update approval_requests set status = ${d.decision}, response = ${d.response}, responded_by = ${actor.userId}, responded_at = now()
      where id = ${requestId}`);
    await audit(tx, actor, "approval.responded", "approval_request", requestId, r.project_id, { decision: d.decision });
    await notifyAdmins(tx, actor, {
      type: "client_response", projectId: r.project_id, link: `/admin/projects/${r.project_id}`,
      title: `${actor.name} ${d.decision === "approved" ? "approved" : d.decision === "answered" ? "answered" : "requested changes on"}: ${r.title}`,
      body: d.response,
    });
  });
}

export async function cancelApprovalRequest(actor: Actor, requestId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const r = await tx`update approval_requests set status = 'cancelled' where id = ${requestId} and status = 'pending' returning project_id`;
    if (r.count === 0) throw new AppError("Request is not pending.");
    await audit(tx, actor, "approval.cancelled", "approval_request", requestId, r[0].project_id);
  });
}

export async function listApprovalRequests(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    return tx<{ id: string; title: string; description: string | null; kind: string; status: string; due_date: string | null;
      response: string | null; responded_at: Date | null; created_at: Date; milestone_title: string | null; responder: string | null; preview_id: string | null }[]>`
      select a.*, m.title as milestone_title, u.name as responder
      from approval_requests a left join milestones m on m.id = a.milestone_id left join users u on u.id = a.responded_by
      where a.project_id = ${projectId} order by (a.status = 'pending') desc, a.created_at desc`;
  });
}

export const milestoneStatusLabel = (s: string) => MILESTONE_STATUS[s] ?? s;
