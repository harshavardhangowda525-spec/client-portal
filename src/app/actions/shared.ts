"use server";

import * as X from "@/server/content";
import * as M from "@/server/milestones";
import * as Q from "@/server/quotations";
import { run, form, type ActionState } from "./run";
import { requestMeta } from "@/lib/session";
import { AppError } from "@/lib/errors";

/** Actions available to both admins and clients (authorization happens in the services). */
export async function addCommentAction(projectId: string, _: ActionState, fd: FormData) {
  return run("any", async (a) => { await X.addComment(a, projectId, form(fd)); return "Sent."; });
}

export async function markThreadReadAction(projectId: string) {
  return run("any", async (a) => { await X.markThreadRead(a, projectId); });
}

export async function markNotificationsReadAction(id?: string) {
  return run("any", async (a) => { await X.markNotificationsRead(a, id); });
}

export async function uploadDocumentAction(projectId: string, _: ActionState, fd: FormData) {
  return run("any", async (a) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a file to upload.");
    await X.uploadDocument(a, projectId, { name: file.name, type: file.type, data: Buffer.from(await file.arrayBuffer()) }, form(fd));
    return "File uploaded.";
  });
}

// ---- client-only ----
export async function respondApprovalAction(requestId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => { await M.respondToApproval(a, requestId, form(fd)); return "Thank you — your response was sent."; });
}

export async function reviewPreviewAction(previewId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    await X.reviewPreview(a, previewId, form(fd));
    return fd.get("decision") === "approved" ? "Preview approved. Thank you!" : "Your feedback was sent to the team.";
  });
}

export async function acceptQuotationAction(versionId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    const meta = await requestMeta();
    await Q.acceptQuotation(a, versionId, {
      signer_name: String(fd.get("signer_name") ?? ""),
      confirm_scope: fd.get("confirm_scope") === "on",
      confirm_terms: fd.get("confirm_terms") === "on",
      content_hash: String(fd.get("content_hash") ?? ""),
    }, meta);
    return "Quotation accepted. Infinity Web & Apps has been notified and will confirm the project start.";
  });
}

export async function requestChangesAction(versionId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => { await Q.requestQuotationChanges(a, versionId, form(fd)); return "Your change request was sent."; });
}

export async function rejectQuotationAction(versionId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => { await Q.rejectQuotation(a, versionId, form(fd)); return "Quotation declined. The team has been notified."; });
}
