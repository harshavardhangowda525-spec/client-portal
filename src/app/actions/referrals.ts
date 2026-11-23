"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import * as RF from "@/server/referrals";
import * as PUB from "@/server/referral-public";
import * as BK from "@/server/booking";
import * as AI from "@/server/referral-ai";
import { runReferralJob } from "@/server/referral-jobs";
import { referralAnalytics, type AnalyticsFilter } from "@/server/referral-analytics";
import { run, form, checkbox, type ActionState } from "./run";
import { AppError } from "@/lib/errors";

const ip = async () => {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
};
const publicRun = async (fn: () => Promise<string | void>): Promise<ActionState> => {
  try {
    const m = await fn();
    return { ok: true, message: m || undefined, at: Date.now() };
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof AppError) return { ok: false, error: e.message, at: Date.now() };
    console.error("[public referral action]", e);
    return { ok: false, error: "Something went wrong. Please try again.", at: Date.now() };
  }
};

// ---- public (no sign-in): referral enquiry and booking ----
export async function submitEnquiryAction(token: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let booking = "";
  const r = await publicRun(async () => {
    const out = await PUB.submitEnquiry(token, { ...form(fd), consent: fd.get("consent") === "on" }, { ip: await ip() });
    booking = out.token;
  });
  if (r?.ok && booking) redirect(`/book/${booking}?new=1`);
  return r;
}
export async function bookAction(token: string, _: ActionState, fd: FormData) {
  return publicRun(async () => { await BK.bookByToken(token, form(fd)); return "Booked! A confirmation email is on its way."; });
}
export async function cancelBookingAction(token: string) {
  return publicRun(async () => { await BK.cancelByToken(token); return "Your call was cancelled."; });
}

// ---- client ----
export async function submitFeedbackAction(projectId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    const r = await RF.submitFeedback(a, projectId, { ...form(fd), testimonial_consent: checkbox(fd, "testimonial_consent") });
    return r.sentiment === "high" ? "Thank you so much for your feedback!" : "Thank you for your honest feedback. Our team will be in touch.";
  });
}
export async function createLinkAction() {
  return run("client", async (a) => { await RF.getOrCreateLink(a); return "Your referral link is ready."; });
}
export async function manageLinkAction(action: "regenerate" | "disable" | "enable") {
  return run("client", async (a) => { await RF.manageLink(a, action); return action === "regenerate" ? "New link created. The old one no longer works." : action === "disable" ? "Link turned off." : "Link turned on."; });
}
export async function dismissInvitationAction() {
  return run("client", async (a) => { await RF.dismissInvitation(a); return "No problem — you can come back to this any time."; });
}
export async function emailPreferenceAction(_: ActionState, fd: FormData) {
  return run("client", async (a) => { await RF.setEmailPreference(a, fd.get("opt_out") === "1"); return "Preference saved."; });
}
export async function introductionAction(_: ActionState, fd: FormData) {
  return run("client", async (a) => {
    await RF.submitIntroduction(a, { ...form(fd), contact_permission: checkbox(fd, "contact_permission") });
    return "Thank you for the introduction! Our team will take it from here.";
  });
}

// ---- admin ----
export async function saveReferralSettingsAction(_: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    await RF.saveReferralSettings(a, { ...form(fd), enabled: checkbox(fd, "enabled"), paused: checkbox(fd, "paused"), email_enabled: checkbox(fd, "email_enabled"),
      require_no_open_complaints: checkbox(fd, "require_no_open_complaints") });
    return "Referral settings saved.";
  });
}
export async function saveBookingSettingsAction(_: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const parseWin = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.split("-").map((t) => t.trim()) as [string, string]);
    await BK.saveBookingSettings(a, {
      slot_minutes: fd.get("slot_minutes"), min_notice_hours: fd.get("min_notice_hours"), horizon_days: fd.get("horizon_days"),
      weekly: Object.fromEntries(days.map((d) => [d, parseWin(String(fd.get(`day_${d}`) ?? ""))])),
      blocked_dates: String(fd.get("blocked_dates") ?? "").split(/[\s,]+/).filter(Boolean),
      meeting_types: fd.getAll("meeting_types").map(String), default_meeting_link: String(fd.get("default_meeting_link") ?? ""),
    });
    return "Calendar saved.";
  });
}
export async function updateFeedbackAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await RF.updateFeedback(a, id, { ...form(fd), testimonial_approved: checkbox(fd, "testimonial_approved") }); return "Feedback updated."; });
}
export async function releaseInvitationAction(workflowId: string) {
  return run("admin", async (a) => { await RF.releaseInvitation(a, workflowId); return "Referral invitation opened for the client."; });
}
export async function createLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await run("admin", async (a) => { id = await RF.createLead(a, form(fd)); });
  if (r?.ok) redirect(`/admin/referrals/leads/${id}`);
  return r;
}
export async function updateLeadAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await RF.updateLead(a, id, form(fd)); return "Lead updated."; });
}
export async function changeStageAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await RF.changeStage(a, id, form(fd)); return "Stage updated."; });
}
export async function leadNoteAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await RF.addLeadNote(a, id, fd.get("body")); return "Note added."; });
}
export async function leadTaskAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await RF.addLeadTask(a, id, form(fd)); return "Task added."; });
}
export async function taskStatusAction(taskId: string, status: "done" | "cancelled") {
  return run("admin", async (a) => { await RF.setTaskStatus(a, taskId, status); });
}
export async function convertLeadAction(id: string): Promise<ActionState> {
  let clientId = "";
  const r = await run("admin", async (a) => { clientId = await RF.convertLeadToClient(a, id); });
  if (r?.ok) redirect(`/admin/proposals/new?client=${clientId}`);
  return r;
}
export async function bookingLinkAction(id: string) {
  return run("admin", async (a) => ({ message: "New booking link created — copy it below.", data: { url: await BK.bookingLinkFor(a, id) } }));
}
export async function scheduleCallAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await BK.scheduleCall(a, id, form(fd)); return "Call scheduled and confirmation sent."; });
}
export async function callOutcomeAction(callId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await BK.recordCallOutcome(a, callId, form(fd)); return "Outcome recorded."; });
}
export async function cancelCallAction(callId: string) {
  return run("admin", async (a) => { await BK.cancelCall(a, callId); return "Call cancelled."; });
}
export async function qualifyLeadAction(id: string) {
  return run("admin", async (a) => { await AI.qualifyLead(a, id); return "AI suggestion added (suggestion only)."; });
}
export async function draftFollowUpAction(id: string) {
  return run("admin", async (a) => { await AI.draftFollowUp(a, id); return "Draft added to the timeline. Review and edit before sending."; });
}
export async function sendLeadEmailAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const { getLead, referralEmail } = RF;
    const { lead } = await getLead(a, id);
    if (!lead.email) throw new AppError("This lead has no email address.");
    if (!lead.contact_consent_at && !lead.contact_permission) throw new AppError("This prospect hasn't agreed to be contacted by email.");
    const subject = String(fd.get("subject") ?? "").trim(), body = String(fd.get("body") ?? "").trim();
    if (subject.length < 3 || body.length < 10) throw new AppError("Write a subject and a message.");
    const r = await referralEmail({ key: `manual:${id}:${Date.now()}`, to: lead.email, subject: subject.slice(0, 200), body: body.slice(0, 5000) });
    await RF.addLeadNote(a, id, `Email sent by ${a.name}: ${subject} (${r})`);
    return r === "sent" ? "Email sent." : `Email ${String(r).replace("_", " ")}.`;
  });
}
export async function retryEventAction(id: string) {
  return run("admin", async () => { await RF.retryFailedEvents(id); return "Retried."; });
}
export async function runReferralJobAction() {
  return run("admin", async () => {
    const r = await runReferralJob();
    return r.paused ? "Referral program is paused — only retries ran." : `Done: ${r.feedbackRequests ?? 0} feedback request(s), ${r.reminders ?? 0} reminder(s), ${r.followUps ?? 0} follow-up(s).`;
  });
}
export async function insightsAction(filter: AnalyticsFilter) {
  return run("admin", async (a) => {
    const m = await referralAnalytics(a, filter);
    const r = await AI.pipelineInsights(a, { counts: m.counts, rates: m.rates, avgDaysToConversion: m.avgDaysToConversion, stages: m.stages });
    return { data: r as unknown as Record<string, unknown> };
  });
}
