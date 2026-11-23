"use server";

import * as MK from "@/server/marketplace";
import * as RW from "@/server/rewards";
import * as AD from "@/server/advisor";
import * as MT from "@/server/meetings";
import * as PF from "@/server/preferences";
import * as SC from "@/server/showcase";
import { run, form, checkbox, type ActionState } from "./run";

// ---- Service marketplace ----
export async function requestUpgradeAction(serviceId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    const r = await MK.requestUpgrade(a, { service_id: serviceId, note: fd.get("note"), source: fd.get("source") || "marketplace" });
    return r.created ? `Request sent. We'll get back to you about ${r.service} within one working day.` : `You've already asked about ${r.service}. We'll be in touch soon.`;
  });
}
export async function hideRecommendationsAction(hidden: boolean, _: ActionState) {
  return run("client", async (a) => { await MK.setRecommendationsHidden(a, hidden); return hidden ? "Suggestions hidden." : "Suggestions shown again."; });
}
export async function saveServiceAction(id: string | null, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await MK.saveService(a, id, { ...form(fd), is_active: checkbox(fd, "is_active") }); return "Service saved."; });
}
export async function setInquiryStatusAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await MK.setInquiryStatus(a, id, String(fd.get("status")) as keyof typeof MK.INQUIRY_STATUSES); return "Status updated and the client was notified."; });
}

// ---- Referral rewards ----
export async function saveCampaignAction(id: string | null, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await RW.saveCampaign(a, id, { ...form(fd), is_active: checkbox(fd, "is_active") }); return "Campaign saved."; });
}
export async function decideRewardAction(id: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => { await RW.decideReward(a, id, form(fd)); return "Reward updated and the client was notified."; });
}

// ---- AI advisor ----
export async function askAdvisorAction(_: ActionState, fd: FormData) {
  return run("client", async (a) => { await AD.ask(a, fd.get("q")); });
}
export async function advisorConsultationAction(_: ActionState) {
  return run("client", async (a) => { const r = await AD.requestConsultation(a); return `Sent to our team (${r.services} service${r.services === 1 ? "" : "s"}). We'll contact you within one working day.`; });
}
export async function deleteAdvisorAction(_: ActionState) {
  return run("client", async (a) => { await AD.deleteAdvisorHistory(a); return "Your advisor chat history was deleted."; });
}

// ---- Meetings ----
export async function bookMeetingAction(_: ActionState, fd: FormData) {
  return run("client", async (a) => { await MT.bookMeeting(a, form(fd)); return fd.get("replaces") ? "Meeting moved. A confirmation is on its way." : "You're booked. A confirmation is on its way."; });
}
export async function cancelMeetingAction(id: string, _: ActionState) {
  return run("client", async (a) => { await MT.cancelMeeting(a, id); return "Meeting cancelled."; });
}

// ---- Notification preferences ----
export async function savePreferencesAction(_: ActionState, fd: FormData) {
  return run("client", async (a) => {
    await PF.savePreferences(a, { notify_email: checkbox(fd, "notify_email"), notify_whatsapp: checkbox(fd, "notify_whatsapp"), whatsapp_consent: checkbox(fd, "whatsapp_consent") });
    return "Preferences saved.";
  });
}

// ---- Showcase & testimonials ----
export async function saveShowcaseAction(id: string | null, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const itemId = await SC.saveShowcaseItem(a, id, { ...form(fd), permission_confirmed: checkbox(fd, "permission_confirmed") });
    for (const kind of ["before", "after"] as const) {
      const f = fd.get(`${kind}_image`);
      if (f instanceof File && f.size > 0) await SC.uploadShowcaseImage(a, itemId, kind, { type: f.type, data: Buffer.from(await f.arrayBuffer()) });
    }
    return "Case study saved.";
  });
}
export async function showcaseStatusAction(id: string, publish: boolean, _: ActionState) {
  return run("admin", async (a) => { await SC.setShowcaseStatus(a, id, publish); return publish ? "Published to the showcase." : "Unpublished."; });
}
export async function reviewTestimonialAction(id: string, decision: "published" | "rejected" | "submitted", _: ActionState) {
  return run("admin", async (a) => { await SC.reviewTestimonial(a, id, decision); return decision === "published" ? "Testimonial published." : "Testimonial updated."; });
}
export async function submitTestimonialAction(_: ActionState, fd: FormData) {
  return run("client", async (a) => { await SC.submitTestimonial(a, { ...form(fd), consent: checkbox(fd, "consent") }); return "Thank you! We'll review it and let you know when it's published."; });
}
export async function withdrawTestimonialAction(id: string, _: ActionState) {
  return run("client", async (a) => { await SC.withdrawTestimonial(a, id); return "Testimonial withdrawn."; });
}
