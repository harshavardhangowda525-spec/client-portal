"use server";

import * as P from "@/server/proposals";
import * as Pricing from "@/server/pricing";
import { run, form, checkbox, type ActionState } from "./run";
import { requestMeta } from "@/lib/session";
import { AppError } from "@/lib/errors";

function json(fd: FormData, key = "payload") {
  try { return JSON.parse(String(fd.get(key) ?? "{}")); } catch { throw new AppError("Invalid form data."); }
}

// ---- wizard ----
/** Called directly from the wizard (not a form) with the full proposal state. */
export async function saveProposalAction(proposalId: string | null, payload: unknown): Promise<ActionState> {
  return run("admin", async (a) => {
    const r = await P.saveProposal(a, proposalId, payload);
    return { message: "Draft saved.", data: { proposalId: r.proposalId, versionId: r.versionId, number: r.number, clientId: r.clientId, total: r.computed.total } };
  });
}

export async function markReadyAction(proposalId: string) {
  return run("admin", async (a) => { await P.markReady(a, proposalId); return "Marked ready to send."; });
}

export async function sendProposalAction(proposalId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const r = await P.sendProposal(a, proposalId, { sendEmail: checkbox(fd, "send_email") });
    const parts = ["Published to the client portal."];
    if (r.portalUsers === 0) parts.push("The client has no portal account yet — send them an invitation from the Share panel.");
    if (r.email) {
      parts.push(r.email.status === "sent" ? "Email sent." : r.email.status === "not_configured" ? "Email is not configured, so nothing was emailed." : `Email failed: ${r.email.error ?? "unknown error"}.`);
    }
    return parts.join(" ");
  });
}

export async function reviseProposalAction(proposalId: string) {
  return run("admin", async (a) => { await P.reviseProposal(a, proposalId); return "New draft version created. Edit it, then send it for fresh approval."; });
}

export async function cancelProposalAction(proposalId: string) {
  return run("admin", async (a) => { await P.cancelProposal(a, proposalId); return "Proposal cancelled."; });
}

export async function deleteProposalAction(proposalId: string) {
  return run("admin", async (a) => { await P.deleteDraftProposal(a, proposalId); return "Draft deleted."; });
}

export async function connectProjectAction(proposalId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const projectId = await P.connectProject(a, proposalId, { projectId: (fd.get("project_id") as string) || null });
    return { message: "Project linked. Confirm commencement on the project page and raise invoices from the payment schedule.", data: { projectId } };
  });
}

// ---- shared (admin + client) ----
export async function proposalCommentAction(proposalId: string, _: ActionState, fd: FormData) {
  return run("any", async (a) => { await P.addProposalComment(a, proposalId, form(fd)); return "Sent."; });
}

// ---- client ----
export async function acceptProposalAction(versionId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    await P.acceptProposal(a, versionId, {
      signer_name: String(fd.get("signer_name") ?? ""), content_hash: String(fd.get("content_hash") ?? ""),
      confirm_scope: fd.get("confirm_scope") === "on", confirm_amount: fd.get("confirm_amount") === "on", confirm_recurring: fd.get("confirm_recurring") === "on",
    }, await requestMeta());
    return "Proposal accepted. Infinity Web & Apps has been notified and will confirm the next steps. No payment has been taken.";
  });
}

export async function rejectProposalAction(versionId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => { await P.rejectProposal(a, versionId, form(fd)); return "Proposal declined. The team has been notified."; });
}

export async function requestProposalChangesAction(versionId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => { await P.requestProposalChanges(a, versionId, form(fd)); return "Your change request was sent."; });
}

// ---- pricing configuration ----
export async function saveSettingAction(key: "business" | "tax" | "proposal_defaults", _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const data = form(fd);
    if (key === "tax") { data.enabled = checkbox(fd, "enabled"); data.apply_to_external = checkbox(fd, "apply_to_external"); }
    if (key === "proposal_defaults") data.discount_applies_to_external = checkbox(fd, "discount_applies_to_external");
    await Pricing.saveSetting(a, key, data);
    return "Settings saved.";
  });
}

export async function saveLogoAction(_: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    if (fd.get("remove") === "1") { await Pricing.saveLogo(a, null); return "Logo removed."; }
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a PNG or JPEG logo.");
    await Pricing.saveLogo(a, { type: file.type, data: Buffer.from(await file.arrayBuffer()) });
    return "Logo updated.";
  });
}

export async function savePackageAction(packageId: string | null, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await Pricing.savePackage(a, packageId, json(fd)); return "Package saved."; });
}

export async function saveCatalogItemAction(kind: Pricing.CatalogKind, id: string | null, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const data = kind === "template" ? json(fd) : { ...form(fd), is_active: checkbox(fd, "is_active"), open_ended: checkbox(fd, "open_ended") };
    await Pricing.saveCatalogItem(a, kind, id, data);
    return "Saved.";
  });
}

export async function deleteCatalogItemAction(kind: Pricing.CatalogKind | "package", id: string) {
  return run("admin", async (a) => { await Pricing.deleteCatalogItem(a, kind, id); return "Deleted."; });
}
