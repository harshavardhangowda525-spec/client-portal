"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, VIEW_AS_COOKIE, VIEW_AS_MINUTES, viewAsValue } from "@/lib/session";
import * as C from "@/server/clients";
import * as M from "@/server/milestones";
import * as X from "@/server/content";
import * as B from "@/server/billing";
import * as AB from "@/server/app-builds";
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

export async function deleteClientAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await run("admin", async (a) => { await C.deleteClient(a, clientId, String(fd.get("confirm_name") ?? "")); });
  if (r?.ok) redirect("/admin/clients?deleted=1");
  return r;
}

// ---- app builds ----
const fileOf = async (v: FormDataEntryValue | null) =>
  v instanceof File && v.size > 0 ? { name: v.name, type: v.type, data: Buffer.from(await v.arrayBuffer()) } : null;

export async function publishAppBuildAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const screenshots = (await Promise.all(fd.getAll("screenshots").map(fileOf))).filter((f) => f !== null);
    await AB.publishAppBuild(a, projectId, form(fd), { apk: await fileOf(fd.get("apk")), screenshots });
    return "App build published and the client was notified.";
  });
}
export async function deleteAppBuildAction(buildId: string) {
  return run("admin", async (a) => { await AB.deleteAppBuild(a, buildId); return "App build deleted."; });
}

// ---- view as client (read-only) ----
export async function viewAsClientAction(clientId: string, projectId?: string | null): Promise<ActionState> {
  let dest = "/portal";
  const r = await run("admin", async (a) => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) throw new AppError("Your session has expired. Please sign in again.");
    const target = await C.viewAsTarget(a, clientId, projectId);
    const expiresAt = Date.now() + VIEW_AS_MINUTES * 60_000;
    (await cookies()).set(VIEW_AS_COOKIE, viewAsValue(token, target.userId, expiresAt), {
      httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "true", path: "/portal", expires: new Date(expiresAt),
    });
    dest = target.projectId ? `/portal/${target.projectId}` : "/portal";
  });
  if (r?.ok) redirect(dest);
  return r;
}
