import { z } from "zod";
import { withDb, assertAdmin, audit, getProjectFor, asSystem, type Actor, type Tx } from "./core";
import { parse, text, optText, url, uuid } from "./validate";
import { notifyAdmins, notifyProjectClients } from "./notify";
import { AppError, notFound } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";

const optUuid = z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable());

// ---------------------------------------------------------------------------
// Website previews
// ---------------------------------------------------------------------------

/** Detect whether the site forbids being framed (X-Frame-Options / CSP frame-ancestors). */
export async function detectEmbedBlocked(target: string): Promise<boolean> {
  try {
    const res = await fetch(target, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000) });
    const xfo = res.headers.get("x-frame-options");
    const csp = res.headers.get("content-security-policy") ?? "";
    await res.body?.cancel();
    if (xfo && /deny|sameorigin/i.test(xfo)) return true;
    const fa = /frame-ancestors([^;]*)/i.exec(csp);
    if (fa && !/\*|https:/.test(fa[1])) return true;
    return false;
  } catch {
    return false; // unknown: we still offer the external link
  }
}

export async function publishPreview(actor: Actor, projectId: string, input: unknown, opts: { detectEmbed?: boolean } = {}) {
  assertAdmin(actor);
  const d = parse(z.object({ url, title: optText(200), notes: optText(5000) }), input);
  const embedBlocked = opts.detectEmbed === false ? false : await detectEmbedBlocked(d.url);
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(version_no), 0) + 1 as next from previews where project_id = ${projectId}`;
    await tx`update previews set status = 'superseded' where project_id = ${projectId} and status = 'ready_for_review'`;
    const [p] = await tx<{ id: string }[]>`
      insert into previews (project_id, version_no, url, title, notes, embed_blocked, published_by)
      values (${projectId}, ${next}, ${d.url}, ${d.title}, ${d.notes}, ${embedBlocked}, ${actor.userId}) returning id`;
    await audit(tx, actor, "preview.published", "preview", p.id, projectId, { url: d.url, version: next });
    await tx`insert into project_updates (project_id, author_id, kind, title, body)
             values (${projectId}, ${actor.userId}, 'preview', ${`Website preview v${next} published`}, ${d.notes})`;
    await notifyProjectClients(tx, actor, projectId, {
      type: "preview_ready", title: `Website preview v${next} is ready for your review`, link: `/portal/${projectId}/preview`,
    });
    return p.id;
  });
}

export async function setPreviewEmbed(actor: Actor, previewId: string, blocked: boolean) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const r = await tx`update previews set embed_blocked = ${blocked} where id = ${previewId}`;
    if (r.count === 0) throw notFound();
  });
}

export async function reviewPreview(actor: Actor, previewId: string, input: unknown) {
  if (actor.role !== "client") throw new AppError("Only the client can review a preview.");
  const d = parse(z.object({ decision: z.enum(["approved", "changes_requested"]), note: optText(10000) }), input);
  if (d.decision === "changes_requested" && !d.note) throw new AppError("Please describe the changes you would like.");
  return withDb(actor, async (tx) => {
    const [p] = await tx<{ id: string; project_id: string; status: string; version_no: number }[]>`
      select id, project_id, status, version_no from previews where id = ${previewId}`;
    if (!p) throw notFound("Preview not found.");
    await getProjectFor(tx, actor, p.project_id);
    if (p.status !== "ready_for_review" && p.status !== "changes_requested") throw new AppError("This preview version is no longer open for review.");
    await asSystem(tx, actor, () => tx`update previews set status = ${d.decision}, reviewed_by = ${actor.userId}, reviewed_at = now() where id = ${previewId}`);
    if (d.note) {
      await tx`insert into comments (project_id, target_type, target_id, author_id, body)
               values (${p.project_id}, 'preview', ${previewId}, ${actor.userId}, ${d.note})`;
    }
    await audit(tx, actor, "preview.reviewed", "preview", previewId, p.project_id, { decision: d.decision });
    await notifyAdmins(tx, actor, {
      type: "client_feedback", projectId: p.project_id, link: `/admin/projects/${p.project_id}/previews`,
      title: `${actor.name} ${d.decision === "approved" ? "approved" : "requested changes on"} preview v${p.version_no}`, body: d.note,
    });
  });
}

export async function listPreviews(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const previews = await tx<{ id: string; version_no: number; url: string; title: string | null; notes: string | null; status: string;
      embed_blocked: boolean; published_at: Date; reviewed_at: Date | null }[]>`
      select * from previews where project_id = ${projectId} order by version_no desc`;
    const comments = await listComments(tx, projectId, "preview");
    const shots = await tx<{ id: string; preview_id: string; name: string; mime_type: string }[]>`
      select id, preview_id, name, mime_type from documents where project_id = ${projectId} and preview_id is not null order by created_at`;
    return previews.map((p) => ({
      ...p, comments: comments.filter((c) => c.target_id === p.id), screenshots: shots.filter((s) => s.preview_id === p.id),
    }));
  });
}

// ---------------------------------------------------------------------------
// Project updates & comments
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  title: text(200),
  body: optText(20000),
  kind: z.enum(["progress", "requirements", "design", "preview", "milestone", "testing", "feedback_request", "deployment", "handover", "general"]),
  milestone_id: optUuid,
  visibility: z.enum(["client", "internal"]),
  requests_feedback: z.coerce.boolean().default(false),
});

export async function postUpdate(actor: Actor, projectId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(updateSchema, input);
  if (d.requests_feedback && d.visibility === "internal") throw new AppError("Internal notes cannot request client feedback.");
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    if (d.milestone_id) {
      const [ok] = await tx`select 1 from milestones where id = ${d.milestone_id} and project_id = ${projectId}`;
      if (!ok) throw new AppError("Milestone does not belong to this project.");
    }
    const [u] = await tx<{ id: string }[]>`insert into project_updates ${tx({ ...d, project_id: projectId, author_id: actor.userId })} returning id`;
    if (d.visibility === "client") {
      if (d.requests_feedback) {
        await tx`insert into approval_requests (project_id, milestone_id, title, description, kind, requested_by)
                 values (${projectId}, ${d.milestone_id}, ${d.title}, ${d.body}, 'feedback', ${actor.userId})`;
      }
      await notifyProjectClients(tx, actor, projectId, {
        type: d.requests_feedback ? "feedback_requested" : "project_update",
        title: d.requests_feedback ? `Feedback requested: ${d.title}` : `Project update: ${d.title}`,
        link: `/portal/${projectId}/updates`,
      });
    }
    await audit(tx, actor, "update.posted", "project_update", u.id, projectId, { title: d.title, visibility: d.visibility });
    return u.id;
  });
}

export async function deleteUpdate(actor: Actor, updateId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const r = await tx`delete from project_updates where id = ${updateId} returning project_id, title`;
    if (r.count === 0) throw notFound();
    await audit(tx, actor, "update.deleted", "project_update", updateId, r[0].project_id, { title: r[0].title });
  });
}

export type CommentRow = { id: string; target_type: string; target_id: string | null; body: string; created_at: Date;
  author_id: string | null; author_name: string | null; author_role: string | null };

async function listComments(tx: Tx, projectId: string, targetType?: string) {
  return tx<CommentRow[]>`
    select c.id, c.target_type, c.target_id, c.body, c.created_at, c.author_id, u.name as author_name, u.role as author_role
    from comments c left join users u on u.id = c.author_id
    where c.project_id = ${projectId} ${targetType ? tx`and c.target_type = ${targetType}` : tx``}
    order by c.created_at`;
}

export async function listUpdates(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    // RLS removes internal updates for clients; the explicit filter keeps intent obvious.
    const updates = await tx<{ id: string; title: string; body: string | null; kind: string; visibility: string; requests_feedback: boolean;
      created_at: Date; milestone_title: string | null; author_name: string | null }[]>`
      select pu.*, m.title as milestone_title, u.name as author_name
      from project_updates pu left join milestones m on m.id = pu.milestone_id left join users u on u.id = pu.author_id
      where pu.project_id = ${projectId} ${actor.role === "client" ? tx`and pu.visibility = 'client'` : tx``}
      order by pu.created_at desc limit 200`;
    const comments = await listComments(tx, projectId, "update");
    const files = await tx<{ id: string; update_id: string; name: string; mime_type: string }[]>`
      select id, update_id, name, mime_type from documents where project_id = ${projectId} and update_id is not null`;
    return updates.map((u) => ({ ...u, comments: comments.filter((c) => c.target_id === u.id), attachments: files.filter((f) => f.update_id === u.id) }));
  });
}

const commentSchema = z.object({
  target_type: z.enum(["thread", "update", "preview", "milestone", "quotation"]),
  target_id: optUuid,
  body: text(10000),
});

export async function addComment(actor: Actor, projectId: string, input: unknown) {
  const d = parse(commentSchema, input);
  if (d.target_type !== "thread" && !d.target_id) throw new AppError("Missing comment target.");
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    if (d.target_type !== "thread") {
      const table = { update: tx`project_updates`, preview: tx`previews`, milestone: tx`milestones`, quotation: tx`quotations` }[d.target_type];
      // Under RLS a client cannot see (and therefore cannot comment on) internal targets.
      const [ok] = await tx`select 1 from ${table} where id = ${d.target_id} and project_id = ${projectId}`;
      if (!ok) throw notFound("The item you are commenting on was not found.");
    }
    const [c] = await tx<{ id: string }[]>`
      insert into comments (project_id, target_type, target_id, author_id, body)
      values (${projectId}, ${d.target_type}, ${d.target_id}, ${actor.userId}, ${d.body}) returning id`;
    const snippet = d.body.length > 140 ? `${d.body.slice(0, 140)}…` : d.body;
    if (d.target_type === "thread") {
      await tx`update project_members set last_read_messages_at = now() where project_id = ${projectId} and user_id = ${actor.userId}`;
    }
    if (actor.role === "client") {
      await notifyAdmins(tx, actor, { type: "client_message", projectId, title: `New message from ${actor.name}`, body: snippet,
        link: `/admin/projects/${projectId}/messages` });
    } else {
      const link = d.target_type === "thread" ? `/portal/${projectId}/messages` : d.target_type === "preview" ? `/portal/${projectId}/preview` : `/portal/${projectId}/updates`;
      await notifyProjectClients(tx, actor, projectId, { type: "message", title: `New message from ${actor.name}`, body: snippet, link });
    }
    return c.id;
  });
}

export async function listThread(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    return listComments(tx, projectId, "thread");
  });
}

export async function markThreadRead(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    if (actor.role === "admin") {
      // Admins track read state through a manager membership row.
      await tx`insert into project_members (project_id, user_id, member_role, last_read_messages_at)
               values (${projectId}, ${actor.userId}, 'manager', now())
               on conflict (project_id, user_id) do update set last_read_messages_at = now()`;
    }
    await tx`update project_members set last_read_messages_at = now() where project_id = ${projectId} and user_id = ${actor.userId}`;
    await tx`update notifications set read_at = now() where user_id = ${actor.userId} and project_id = ${projectId}
             and type in ('message', 'client_message') and read_at is null`;
  });
}

export async function unreadMessageCount(actor: Actor, projectId: string): Promise<number> {
  return withDb(actor, async (tx) => {
    const [r] = await tx<{ n: number }[]>`
      select count(*)::int as n from comments c
      where c.project_id = ${projectId} and c.target_type = 'thread' and c.author_id is distinct from ${actor.userId}
        and c.created_at > coalesce((select last_read_messages_at from project_members where project_id = ${projectId} and user_id = ${actor.userId}), '-infinity')
        ${actor.role === "admin" ? tx`and exists (select 1 from users u where u.id = c.author_id and u.role = 'client')` : tx``}`;
    return r.n;
  });
}

// ---------------------------------------------------------------------------
// Documents (private; served only through authenticated routes)
// ---------------------------------------------------------------------------
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/plain|text\/csv|application\/zip|application\/x-zip-compressed|application\/msword|application\/vnd\.openxmlformats-officedocument\.[\w.]+|application\/vnd\.ms-excel|application\/vnd\.ms-powerpoint|image\/svg\+xml|application\/postscript|image\/vnd\.adobe\.photoshop|application\/octet-stream)$/;

const docSchema = z.object({
  category: z.enum(["quotation", "invoice", "requirements", "brand_asset", "screenshot", "handover", "contract", "other"]),
  visibility: z.enum(["client", "internal"]).default("client"),
  milestone_id: optUuid,
  preview_id: optUuid,
  update_id: optUuid,
});

export async function uploadDocument(actor: Actor, projectId: string, file: { name: string; type: string; data: Buffer }, input: unknown) {
  const d = parse(docSchema, input);
  if (actor.role === "client") {
    if (!["brand_asset", "requirements", "other"].includes(d.category)) throw new AppError("You can upload brand assets, requirements or other files.");
    d.visibility = "client"; d.milestone_id = null; d.preview_id = null; d.update_id = null;
  }
  if (!file.data.length) throw new AppError("The file is empty.");
  if (file.data.length > MAX_UPLOAD_BYTES) throw new AppError("Files must be 15 MB or smaller.");
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIME.test(mime)) throw new AppError("This file type is not supported.");
  const name = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 255) || "file";
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    for (const [col, table] of [["milestone_id", tx`milestones`], ["preview_id", tx`previews`], ["update_id", tx`project_updates`]] as const) {
      const id = d[col];
      if (id) {
        const [ok] = await tx`select 1 from ${table} where id = ${id} and project_id = ${projectId}`;
        if (!ok) throw new AppError("Linked item does not belong to this project.");
      }
    }
    const [doc] = await tx<{ id: string }[]>`
      insert into documents (project_id, category, name, mime_type, size_bytes, sha256, visibility, milestone_id, preview_id, update_id, uploaded_by)
      values (${projectId}, ${d.category}, ${name}, ${mime}, ${file.data.length}, ${sha256(file.data)}, ${d.visibility},
              ${d.milestone_id}, ${d.preview_id}, ${d.update_id}, ${actor.userId}) returning id`;
    await tx`insert into document_blobs (document_id, data) values (${doc.id}, ${file.data})`;
    await audit(tx, actor, "document.uploaded", "document", doc.id, projectId, { name, category: d.category, visibility: d.visibility });
    if (actor.role === "client") {
      await notifyAdmins(tx, actor, { type: "client_upload", projectId, title: `${actor.name} uploaded ${name}`, link: `/admin/projects/${projectId}/documents` });
    } else if (d.visibility === "client") {
      await notifyProjectClients(tx, actor, projectId, { type: "document", title: `New document: ${name}`, link: `/portal/${projectId}/documents` });
    }
    return doc.id;
  });
}

export async function listDocuments(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    return tx<{ id: string; category: string; name: string; mime_type: string; size_bytes: number; visibility: string; created_at: Date; uploader: string | null; uploader_role: string | null }[]>`
      select d.id, d.category, d.name, d.mime_type, d.size_bytes, d.visibility, d.created_at, u.name as uploader, u.role as uploader_role
      from documents d left join users u on u.id = d.uploaded_by
      where d.project_id = ${projectId} order by d.created_at desc`;
  });
}

/** Returns file content only if the actor can see the document under RLS. */
export async function readDocument(actor: Actor, documentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw notFound();
  return withDb(actor, async (tx) => {
    const [doc] = await tx<{ id: string; project_id: string; name: string; mime_type: string; data: Buffer }[]>`
      select d.id, d.project_id, d.name, d.mime_type, b.data from documents d join document_blobs b on b.document_id = d.id
      where d.id = ${documentId}`;
    if (!doc) throw notFound("Document not found.");
    await getProjectFor(tx, actor, doc.project_id);
    return doc;
  });
}

export async function deleteDocument(actor: Actor, documentId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const r = await tx`delete from documents where id = ${documentId} returning project_id, name`;
    if (r.count === 0) throw notFound();
    await audit(tx, actor, "document.deleted", "document", documentId, r[0].project_id, { name: r[0].name });
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export async function listNotifications(actor: Actor, limit = 50) {
  return withDb(actor, (tx) => tx<{ id: string; type: string; title: string; body: string | null; link: string | null; read_at: Date | null; created_at: Date; project_id: string | null }[]>`
    select * from notifications where user_id = ${actor.userId} order by created_at desc limit ${limit}`);
}

export async function unreadNotificationCount(actor: Actor) {
  return withDb(actor, async (tx) => {
    const [r] = await tx<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${actor.userId} and read_at is null`;
    return r.n;
  });
}

export async function markNotificationsRead(actor: Actor, id?: string) {
  return withDb(actor, (tx) => tx`update notifications set read_at = now()
    where user_id = ${actor.userId} and read_at is null ${id ? tx`and id = ${id}` : tx``}`);
}
