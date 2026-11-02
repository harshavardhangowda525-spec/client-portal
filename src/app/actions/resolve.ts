"use server";

import { redirect } from "next/navigation";
import * as R from "@/server/resolve";
import { resendBriefing, runResolveJob } from "@/server/resolve-email";
import { run, form, checkbox, type ActionState } from "./run";
import { AppError } from "@/lib/errors";

const fileOf = async (v: FormDataEntryValue | null) =>
  v instanceof File && v.size > 0 ? { name: v.name || "screenshot.png", type: v.type, data: Buffer.from(await v.arrayBuffer()) } : null;

// ---- client ----
/** Start a request (text, voice transcript or visual feedback). Screenshots are stored first, then linked to the ticket. */
export async function startRequestAction(projectId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let ticketId = "";
  const r = await run("client", async (a) => {
    const docIds = fd.getAll("document_ids").map(String).filter(Boolean);
    for (const v of fd.getAll("screenshots")) {
      const f = await fileOf(v);
      if (f) docIds.push(await R.storeAttachment(a, projectId, f, { kind: "image" }));
    }
    let details: Record<string, unknown> = {};
    const raw = fd.get("details");
    if (typeof raw === "string" && raw) { try { details = JSON.parse(raw); } catch { throw new AppError("Invalid feedback details."); } }
    const out = await R.startRequest(a, projectId, {
      message: String(fd.get("message") ?? ""), source: String(fd.get("source") || "text"), details,
      preview_id: (fd.get("preview_id") as string) || null, document_ids: docIds,
    });
    ticketId = out.ticketId;
  });
  if (r?.ok) redirect(`/portal/${projectId}/resolve/${ticketId}`);
  return r;
}

export async function replyAction(ticketId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    const r = await R.replyToRequest(a, ticketId, { message: fd.get("message") });
    return r.aiFailed ? "Saved and sent to the team." : undefined;
  });
}

export async function confirmAction(ticketId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    await R.confirmRequest(a, ticketId, { requirement: (fd.get("requirement") as string) || null });
    return "Confirmed — your request is with the team.";
  });
}

export async function clientCommentAction(ticketId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => { await R.clientComment(a, ticketId, form(fd)); return "Sent."; });
}

export async function verifyAction(ticketId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    const fixed = fd.get("fixed") === "1";
    await R.verifyResolution(a, ticketId, { fixed, note: (fd.get("note") as string) || null });
    return fixed ? "Thanks for confirming!" : "Thanks — we've reopened it.";
  });
}

// ---- admin ----
export async function updateTicketAction(ticketId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await R.updateTicket(a, ticketId, form(fd)); return "Ticket updated."; });
}
export async function teamMessageAction(ticketId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    await R.teamMessage(a, ticketId, form(fd));
    return fd.get("visibility") === "internal" ? "Internal note added." : "Reply sent to the client.";
  });
}
export async function updateActionItemAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await R.updateActionItem(a, id, form(fd)); return "Action item updated."; });
}
export async function createActionItemAction(ticketId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await R.createActionItem(a, ticketId, form(fd)); return "Action item added."; });
}
export async function closeGapAction(gapId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await R.closeGap(a, gapId, form(fd)); return "Gap updated."; });
}
export async function saveResolveSettingsAction(_: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    await R.saveResolveSettings(a, { ...form(fd), ai_enabled: checkbox(fd, "ai_enabled") });
    return "Settings saved.";
  });
}
export async function runResolveJobAction() {
  return run("admin", async () => {
    const r = await runResolveJob({ forceDaily: false });
    const g = r.gaps as { created: number; resolved: number };
    return `Check complete: ${g.created} new gap(s), ${g.resolved} cleared. Daily summary: ${String(r.daily).replace("_", " ")}.`;
  });
}
export async function sendDailyNowAction() {
  return run("admin", async () => {
    const r = await runResolveJob({ forceDaily: true });
    return r.daily === "duplicate" ? "Today's summary was already sent." : `Daily summary: ${String(r.daily).replace("_", " ")}.`;
  });
}
export async function resendBriefingAction(id: string) {
  return run("admin", async () => `Resend: ${String(await resendBriefing(id)).replace("_", " ")}.`);
}
