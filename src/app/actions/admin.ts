"use server";

import { redirect } from "next/navigation";
import * as C from "@/server/clients";
import * as M from "@/server/milestones";
import * as Q from "@/server/quotations";
import * as X from "@/server/content";
import * as B from "@/server/billing";
import { run, form, checkbox, type ActionState } from "./run";
import { AppError } from "@/lib/errors";

// ---- clients & projects ----
export async function createClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run("admin", async (a) => { id = await C.createClient(a, form(fd)); });
  if (r?.ok) redirect(`/admin/clients/${id}`);
  return r;
}

export async function updateClientAction(clientId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await C.updateClient(a, clientId, form(fd)); return "Client details saved."; });
}

export async function createProjectAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run("admin", async (a) => {
    id = await C.createProject(a, clientId, form(fd), { defaultMilestones: checkbox(fd, "default_milestones") });
  });
  if (r?.ok) redirect(`/admin/projects/${id}`);
  return r;
}

export async function updateProjectAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await C.updateProject(a, projectId, form(fd)); return "Project saved."; });
}

export async function setProjectStatusAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    await C.setProjectStatus(a, projectId, String(fd.get("status")), (fd.get("reason") as string) || null);
    return "Project status updated.";
  });
}

export async function commenceProjectAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await C.commenceProject(a, projectId, form(fd)); return "Project activated. Work can begin."; });
}

export async function addInternalNoteAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await C.addInternalNote(a, projectId, String(fd.get("body") ?? "")); return "Note saved."; });
}

export async function inviteClientAction(clientId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const r = await C.inviteClient(a, clientId, form(fd), { sendEmail: checkbox(fd, "send_email") });
    return { message: inviteMessage(r), data: { link: r.link, email: r.email?.status ?? null } };
  });
}

export async function resendInvitationAction(invitationId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const r = await C.resendInvitation(a, invitationId, { sendEmail: checkbox(fd, "send_email") });
    return { message: inviteMessage(r), data: { link: r.link, email: r.email?.status ?? null } };
  });
}

function inviteMessage(r: C.InvitationResult) {
  if (!r.email) return "Invitation link created. Copy it and send it to the client.";
  if (r.email.status === "sent") return "Invitation emailed. You can also copy the link below.";
  if (r.email.status === "not_configured") return "Email is not configured, so nothing was emailed. Copy the link below and send it manually.";
  return `Email delivery failed (${r.email.error ?? "unknown error"}). Copy the link below and send it manually.`;
}

export async function revokeInvitationAction(invitationId: string) {
  return run("admin", async (a) => { await C.revokeInvitation(a, invitationId); return "Invitation revoked."; });
}

export async function setPortalAccessAction(clientId: string, enabled: boolean) {
  return run("admin", async (a) => { await C.setPortalAccess(a, clientId, enabled); return enabled ? "Portal access restored." : "Portal access revoked and sessions ended."; });
}

// ---- milestones & approvals ----
export async function createMilestoneAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await M.createMilestone(a, projectId, form(fd)); return "Milestone added."; });
}
export async function updateMilestoneAction(milestoneId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await M.updateMilestone(a, milestoneId, form(fd)); return "Milestone updated."; });
}
export async function deleteMilestoneAction(milestoneId: string) {
  return run("admin", async (a) => { await M.deleteMilestone(a, milestoneId); return "Milestone deleted."; });
}
export async function moveMilestoneAction(milestoneId: string, direction: "up" | "down") {
  return run("admin", async (a) => { await M.moveMilestone(a, milestoneId, direction); });
}
export async function createApprovalAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await M.createApprovalRequest(a, projectId, form(fd)); return "Request sent to the client."; });
}
export async function cancelApprovalAction(requestId: string) {
  return run("admin", async (a) => { await M.cancelApprovalRequest(a, requestId); return "Request cancelled."; });
}

// ---- quotations ----
export async function createQuotationAction(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let qid = "";
  const r = await run("admin", async (a) => {
    qid = (await Q.createQuotation(a, projectId, { title: String(fd.get("title") ?? ""), template_id: (fd.get("template_id") as string) || null })).quotationId;
  });
  if (r?.ok) redirect(`/admin/projects/${projectId}/quotations/${qid}`);
  return r;
}
export async function saveDraftAction(versionId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    let payload: unknown;
    try { payload = JSON.parse(String(fd.get("payload") ?? "{}")); } catch { throw new AppError("Invalid form data."); }
    await Q.saveDraft(a, versionId, payload);
    return "Draft saved.";
  });
}
export async function sendQuotationAction(versionId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const r = await Q.sendQuotation(a, versionId, { sendEmail: checkbox(fd, "send_email") });
    const emailed = r.deliveries.filter((d) => d.status === "sent").length;
    const note = r.recipients === 0
      ? " The client has no portal account yet — send them a portal invitation so they can review it."
      : checkbox(fd, "send_email") ? (emailed ? ` Emailed ${emailed} recipient(s).` : " Email is not configured or failed; the client was notified in the portal.") : " The client was notified in the portal.";
    return `Quotation sent.${note}`;
  });
}
export async function reviseQuotationAction(quotationId: string) {
  return run("admin", async (a) => { await Q.reviseQuotation(a, quotationId); return "New draft version created."; });
}
export async function withdrawVersionAction(versionId: string) {
  return run("admin", async (a) => { await Q.withdrawVersion(a, versionId); return "Quotation withdrawn."; });
}
export async function deleteDraftAction(projectId: string, versionId: string): Promise<ActionState> {
  return run("admin", async (a) => { await Q.deleteDraft(a, versionId); return "Draft deleted."; });
}
export async function saveTemplateAction(templateId: string | null, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    let content: unknown;
    try { content = JSON.parse(String(fd.get("content") ?? "{}")); } catch { throw new AppError("Template content must be valid JSON."); }
    await Q.saveTemplate(a, templateId, { name: String(fd.get("name") ?? ""), description: (fd.get("description") as string) || null, content });
    return "Template saved.";
  });
}
export async function deleteTemplateAction(templateId: string) {
  return run("admin", async (a) => { await Q.deleteTemplate(a, templateId); return "Template deleted."; });
}

// ---- previews, updates, documents ----
export async function publishPreviewAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await X.publishPreview(a, projectId, form(fd)); return "Preview published and the client was notified."; });
}
export async function setPreviewEmbedAction(previewId: string, blocked: boolean) {
  return run("admin", async (a) => { await X.setPreviewEmbed(a, previewId, blocked); });
}
export async function postUpdateAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    await X.postUpdate(a, projectId, { ...form(fd), requests_feedback: checkbox(fd, "requests_feedback") });
    return "Update posted.";
  });
}
export async function deleteUpdateAction(updateId: string) {
  return run("admin", async (a) => { await X.deleteUpdate(a, updateId); return "Update deleted."; });
}
export async function deleteDocumentAction(documentId: string) {
  return run("admin", async (a) => { await X.deleteDocument(a, documentId); return "Document deleted."; });
}

// ---- billing ----
export async function createInvoiceAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await B.createInvoice(a, projectId, form(fd)); return "Draft invoice created."; });
}
export async function invoiceFromTermAction(projectId: string, termIndex: number, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await B.createInvoiceFromTerm(a, projectId, termIndex, (fd.get("due_date") as string) || null); return "Draft invoice created."; });
}
export async function issueInvoiceAction(invoiceId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await B.issueInvoice(a, invoiceId, (fd.get("due_date") as string) || null); return "Invoice issued to the client."; });
}
export async function voidInvoiceAction(invoiceId: string) {
  return run("admin", async (a) => { await B.voidInvoice(a, invoiceId); return "Invoice voided."; });
}
export async function recordPaymentAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    await B.recordPayment(a, projectId, form(fd));
    return fd.get("status") === "confirmed" ? "Payment recorded and confirmed." : "Payment recorded as awaiting confirmation.";
  });
}
export async function setPaymentStatusAction(paymentId: string, status: "confirmed" | "failed" | "refunded") {
  return run("admin", async (a) => { await B.setPaymentStatus(a, paymentId, status); return `Payment marked ${status}.`; });
}
export async function saveVersionAsTemplateAction(versionId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await Q.saveVersionAsTemplate(a, versionId, String(fd.get("name") ?? "")); return "Saved as a reusable template."; });
}
