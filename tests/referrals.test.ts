import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawAs, rawSystem, sendProjectProposal, acceptAsClient, uniq } from "./helpers";
import * as RF from "@/server/referrals";
import * as PUB from "@/server/referral-public";
import * as BK from "@/server/booking";
import * as AN from "@/server/referral-analytics";
import { runReferralJob } from "@/server/referral-jobs";
import * as C from "@/server/clients";
import * as P from "@/server/proposals";
import * as B from "@/server/billing";
import * as R from "@/server/resolve";
import { listNotifications } from "@/server/content";
import { actorFromToken } from "@/server/auth";
import { istToday, addDays } from "@/lib/dates";

const mails: { to: string; subject: string; raw: string }[] = [];
let smtp: SMTPServer;
let smtpFail = false;
let admin: Actor;

const stars = (n: number, over: Record<string, unknown> = {}) => ({ satisfaction: n, quality: n, communication: n, delivery: n, overall: n, ...over });
const enquiry = (over: Record<string, unknown> = {}) => ({ business_name: "Green Leaf Salon", contact_name: "Nisha Rao", email: `${uniq("nisha")}@example.test`, phone: "9811122233",
  business_category: "Salon", service: "Website", problem: "We need online booking for our salon customers.", preferred_contact: "phone", consent: true, website: "", started_at: Date.now() - 10_000, ...over });
const wf = async (projectId: string) => (await rawSystem((tx) => tx<Record<string, any>[]>`select * from referral_workflows where project_id = ${projectId}`))[0];
const lead = async (id: string) => (await rawSystem((tx) => tx<Record<string, any>[]>`select * from leads where id = ${id}`))[0];
const leadByEmail = async (email: string) => (await rawSystem((tx) => tx<Record<string, any>[]>`select * from leads where lower(email) = ${email.toLowerCase()} order by created_at`));

async function complete(projectId: string) {
  await C.setProjectStatus(admin, projectId, "quotation_accepted");
  await C.setProjectStatus(admin, projectId, "active");
  await C.setProjectStatus(admin, projectId, "completed");
}
async function referrerWithLink(label: string) {
  const r = await makeClientWithProject(admin, label);
  await complete(r.projectId);
  await RF.submitFeedback(r.client, r.projectId, stars(5, { comments: "Fantastic work, very professional team!", testimonial_consent: true }));
  const link = await RF.getOrCreateLink(r.client);
  return { ...r, token: link.token };
}

beforeAll(async () => {
  smtp = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], logger: false, onData(stream, session, cb) {
    let raw = ""; stream.on("data", (c) => (raw += c));
    stream.on("end", () => { if (smtpFail) return cb(new Error("Mailbox unavailable")); mails.push({ to: session.envelope.rcptTo.map((x) => x.address).join(","), subject: /^Subject: (.*)$/m.exec(raw)?.[1] ?? "", raw }); cb(); });
  } });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String((smtp.server.address() as AddressInfo).port); process.env.SMTP_FROM = "Infinity <hello@infinity.test>";
  delete process.env.GROQ_API_KEY; // AI is optional: everything below must work without it
  admin = await makeAdmin();
  await R.saveResolveSettings(admin, { ...(await R.getResolveSettings()), admin_email: "owner@infinity.test" });
  // Open the booking calendar every day 09:00–21:00 so tests don't depend on the weekday.
  const day = [["09:00", "21:00"]];
  await BK.saveBookingSettings(admin, { slot_minutes: 30, min_notice_hours: 1, horizon_days: 14, weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
    blocked_dates: [], meeting_types: ["video_call", "phone"], default_meeting_link: "https://meet.example.com/infinity" });
});
beforeEach(() => { smtpFail = false; });
afterAll(async () => { vi.unstubAllGlobals(); delete process.env.SMTP_HOST; await new Promise<void>((r) => smtp.close(() => r())); });

describe("1–4. completion → feedback → invitation", () => {
  it("completing a project creates one workflow and a feedback request (portal + email); repeats don't duplicate", async () => {
    const r = await makeClientWithProject(admin, "Complete");
    await complete(r.projectId);
    const w = await wf(r.projectId);
    expect(w.status).toBe("awaiting_feedback");
    expect(w.feedback_requested_at).toBeTruthy();
    expect((await listNotifications(r.client)).some((n) => n.type === "feedback_request" && n.link === `/portal/${r.projectId}/feedback`)).toBe(true);
    expect(mails.some((m) => m.to === r.email && /complete/i.test(m.subject))).toBe(true);
    // Re-running the same completion event is a no-op.
    await RF.onProjectStatusChanged(r.projectId, "active", "completed");
    expect(await rawSystem((tx) => tx`select id from referral_workflows where project_id = ${r.projectId}`)).toHaveLength(1);
    // Reopening pauses; completing again resumes the same workflow.
    await C.setProjectStatus(admin, r.projectId, "active");
    expect((await wf(r.projectId)).status).toBe("paused");
    await expect(RF.submitFeedback(r.client, r.projectId, stars(5))).rejects.toThrow(/isn't open/);
    await C.setProjectStatus(admin, r.projectId, "completed");
    expect((await wf(r.projectId)).status).toBe("awaiting_feedback");
    expect(await rawSystem((tx) => tx`select id from referral_workflows where project_id = ${r.projectId}`)).toHaveLength(1);
  });

  it("high feedback is stored once and opens the referral invitation", async () => {
    const r = await makeClientWithProject(admin, "Happy");
    await complete(r.projectId);
    const out = await RF.submitFeedback(r.client, r.projectId, stars(5, { comments: "Loved it", testimonial_consent: true }));
    expect(out.sentiment).toBe("high");
    const [fb] = await rawSystem((tx) => tx`select * from project_feedback where project_id = ${r.projectId}`);
    expect(fb).toMatchObject({ overall: 5, testimonial_consent: true, testimonial_approved: false, sentiment: "high" });
    await expect(RF.submitFeedback(r.client, r.projectId, stars(1))).rejects.toThrow(/already shared/);
    expect((await wf(r.projectId)).status).toBe("referral_eligible");
    expect((await RF.myReferrals(r.client)).eligible).toBe(true);
    expect((await listNotifications(r.client)).some((n) => n.type === "referral_invitation")).toBe(true);
  });

  it("3-star feedback holds the invitation and alerts the team; low feedback suppresses it and opens a service-recovery ticket", async () => {
    const m = await makeClientWithProject(admin, "Meh");
    await complete(m.projectId);
    expect((await RF.submitFeedback(m.client, m.projectId, stars(3))).sentiment).toBe("moderate");
    expect((await wf(m.projectId)).status).toBe("on_hold");
    await expect(RF.getOrCreateLink(m.client)).rejects.toThrow(/positive feedback/);

    const low = await makeClientWithProject(admin, "Sad");
    await complete(low.projectId);
    expect((await RF.submitFeedback(low.client, low.projectId, stars(2, { comments: "Delivery was late" }))).sentiment).toBe("low");
    expect((await wf(low.projectId)).status).toBe("suppressed");
    const [fb] = await rawSystem((tx) => tx`select resolve_ticket_id, issue_status from project_feedback where project_id = ${low.projectId}`);
    expect(fb.issue_status).toBe("open");
    const [ticket] = await rawSystem((tx) => tx`select category, priority from resolve_tickets where id = ${fb.resolve_ticket_id}`);
    expect(ticket).toEqual({ category: "complaint", priority: "high" });
    expect(await rawSystem((tx) => tx`select 1 from referral_invitations where client_id = ${low.clientId}`)).toHaveLength(0);
    // High stars but one very poor score → not "high".
    expect(RF.classify(stars(5, { communication: 2 }), { high_threshold: 4, low_threshold: 2 })).toBe("moderate");
    // An open complaint blocks "high".
    expect(RF.classify(stars(5), { high_threshold: 4, low_threshold: 2 }, 1)).toBe("moderate");
    // Admin can release after addressing concerns.
    const w = await wf(m.projectId);
    await RF.releaseInvitation(admin, w.id);
    expect((await wf(m.projectId)).status).toBe("referral_eligible");
  });

  it("14. settings control the workflow: paused program creates no feedback request", async () => {
    const s = await RF.getReferralSettings();
    await RF.saveReferralSettings(admin, { ...s, paused: true });
    const r = await makeClientWithProject(admin, "Paused");
    await complete(r.projectId);
    expect((await wf(r.projectId)).status).toBe("not_eligible");
    await RF.saveReferralSettings(admin, s);
    await expect(RF.saveReferralSettings(admin, { ...s, share_template: "no link here" })).rejects.toThrow(/link/);
  });
});

describe("5–8. links, landing page and enquiries", () => {
  let ref: Awaited<ReturnType<typeof referrerWithLink>>;
  beforeAll(async () => { ref = await referrerWithLink("Referrer"); });

  it("links are long random tokens on the configured domain; regenerate invalidates the old token", async () => {
    expect(ref.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const mine = await RF.myReferrals(ref.client);
    expect(mine.link?.url).toBe(`http://localhost:3000/r/${ref.token}`);
    const other = await referrerWithLink("Other");
    expect(other.token).not.toBe(ref.token);
    await RF.manageLink(other.client, "regenerate");
    expect(await PUB.landing(other.token)).toBeNull();
    await RF.manageLink(other.client, "disable");
    const [l] = await rawSystem((tx) => tx`select token from referral_links where client_id = ${other.clientId}`);
    expect(await PUB.landing(l.token)).toBeNull();
  });

  it("the landing page validates tokens, counts unique visitors and never reveals the referrer", async () => {
    expect(await PUB.landing("not-a-real-token")).toBeNull();
    expect(await PUB.landing("x".repeat(40))).toBeNull();
    const page = await PUB.landing(ref.token, "203.0.113.10");
    expect(page?.headline).toBeTruthy();
    await PUB.landing(ref.token, "203.0.113.10");
    await PUB.landing(ref.token, "203.0.113.11");
    const [{ n }] = await rawSystem((tx) => tx`select count(*)::int as n from referral_visits v join referral_links k on k.id = v.link_id where k.client_id = ${ref.clientId}`);
    expect(n).toBe(2);
    expect(JSON.stringify(page)).not.toContain(ref.email);
    // Testimonials appear only with consent AND admin approval.
    expect(page?.testimonials.some((t) => t.quote.includes("Fantastic work"))).toBe(false);
    const [fb] = await rawSystem((tx) => tx`select id from project_feedback where client_id = ${ref.clientId}`);
    await RF.updateFeedback(admin, fb.id, { issue_status: "none", testimonial_approved: true });
    expect((await PUB.landing(ref.token))?.testimonials.some((t) => t.quote.includes("Fantastic work"))).toBe(true);
  });

  it("an enquiry creates an attributed CRM lead with an owner, a task and notifications", async () => {
    const e = enquiry();
    const r = await PUB.submitEnquiry(ref.token, e, { ip: "198.51.100.1" });
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const [l] = await leadByEmail(e.email);
    expect(l).toMatchObject({ source: "client_referral", stage: "enquiry_submitted", business_name: "Green Leaf Salon" });
    expect(l.verified_at).toBeTruthy();
    expect(l.owner_id).toBeTruthy();
    const [a] = await rawSystem((tx) => tx`select referrer_client_id, method, project_id from referral_attributions where lead_id = ${l.id}`);
    expect(a).toEqual({ referrer_client_id: ref.clientId, method: "link", project_id: ref.projectId });
    expect(await rawSystem((tx) => tx`select 1 from lead_tasks where lead_id = ${l.id} and status = 'open'`)).toHaveLength(1);
    expect(mails.some((m) => m.to === e.email && /Thanks for contacting/.test(m.subject))).toBe(true);
    // Attribution can't be changed afterwards.
    await expect(rawSystem((tx) => tx`update referral_attributions set referrer_client_id = ${ref.clientId} where lead_id = ${l.id}`)).rejects.toThrow();
    // The referrer sees only a privacy-safe label.
    const mine = await RF.myReferrals(ref.client);
    expect(mine.history[0]).toMatchObject({ label: "Enquiry submitted", name: "Enquiry via your link" });
    expect(JSON.stringify(mine)).not.toContain(e.email);
  });

  it("duplicates, self-referrals, existing clients, bots and floods are handled safely", async () => {
    const e = enquiry();
    await PUB.submitEnquiry(ref.token, e, { ip: "198.51.100.2" });
    const again = await PUB.submitEnquiry(ref.token, { ...e, problem: "Second message about the same need." }, { ip: "198.51.100.2" });
    expect(again.duplicate).toBe(true);
    expect(await leadByEmail(e.email)).toHaveLength(1);
    // Self-referral: no attribution, held for verification.
    await PUB.submitEnquiry(ref.token, enquiry({ email: ref.email }), { ip: "198.51.100.3" });
    const [self] = await leadByEmail(ref.email);
    expect(self.flags).toContain("self_referral");
    expect(self.stage).toBe("verification_pending");
    expect(await rawSystem((tx) => tx`select 1 from referral_attributions where lead_id = ${self.id}`)).toHaveLength(0);
    // Existing client: linked, not attributed.
    const existing = await makeClientWithProject(admin, "Existing");
    await PUB.submitEnquiry(ref.token, enquiry({ email: existing.email }), { ip: "198.51.100.4" });
    const [ex] = await leadByEmail(existing.email);
    expect(ex.flags).toContain("existing_client");
    expect(ex.client_id).toBe(existing.clientId);
    // Bots: honeypot filled or submitted instantly.
    await expect(PUB.submitEnquiry(ref.token, enquiry({ website: "spam.example" }), { ip: "198.51.100.5" })).rejects.toThrow(/Spam/);
    await expect(PUB.submitEnquiry(ref.token, enquiry({ started_at: Date.now() }), { ip: "198.51.100.5" })).rejects.toThrow(/moment/);
    await expect(PUB.submitEnquiry(ref.token, enquiry({ consent: false }), { ip: "198.51.100.5" })).rejects.toThrow(/agree/);
    // Rate limit per connection.
    const s = await RF.getReferralSettings();
    await RF.saveReferralSettings(admin, { ...s, max_enquiries_per_hour: 1 });
    await PUB.submitEnquiry(ref.token, enquiry(), { ip: "198.51.100.9" });
    await expect(PUB.submitEnquiry(ref.token, enquiry(), { ip: "198.51.100.9" })).rejects.toThrow(/Too many/);
    await RF.saveReferralSettings(admin, s);
    // Invalid token.
    await expect(PUB.submitEnquiry("nope", enquiry(), {})).rejects.toThrow(/isn't active/);
  });

  it("introductions keep contact details only with permission and never contact the prospect", async () => {
    const before = mails.length;
    const id = await RF.submitIntroduction(ref.client, { business_name: "Sunrise Bakery", challenge: "They take all orders by phone.", contact_email: "owner@sunrise.test", contact_permission: false });
    const l = await lead(id);
    expect(l).toMatchObject({ stage: "verification_pending", email: null, contact_permission: false });
    const id2 = await RF.submitIntroduction(ref.client, { business_name: "Moon Cafe", challenge: "Needs a website for catering.", contact_email: "hi@mooncafe.test", contact_permission: true });
    expect((await lead(id2)).email).toBe("hi@mooncafe.test");
    expect(mails.slice(before).some((m) => m.to.includes("sunrise") || m.to.includes("mooncafe"))).toBe(false);
    expect((await RF.myReferrals(ref.client)).history.map((h) => h.name)).toContain("Sunrise Bakery");
  });
});

describe("9–11. calls, proposal, verified conversion and analytics", () => {
  let ref: Awaited<ReturnType<typeof referrerWithLink>>;
  let leadId: string; let bookingToken: string; let prospectEmail: string;
  beforeAll(async () => {
    ref = await referrerWithLink("Chain");
    const e = enquiry({ business_name: "Spice Box", contact_name: "Arun Das" });
    prospectEmail = e.email;
    bookingToken = (await PUB.submitEnquiry(ref.token, e, { ip: "192.0.2.50" })).token;
    leadId = (await leadByEmail(e.email))[0].id;
  });

  it("offers only real slots and cannot be double-booked", async () => {
    const ctx = await BK.bookingContext(bookingToken);
    expect(ctx.lead.business_name).toBe("Spice Box");
    const slot = ctx.days[1].slots[2];
    await BK.bookByToken(bookingToken, { starts_at: slot, meeting_type: "video_call" });
    const l = await lead(leadId);
    expect(l.stage).toBe("call_scheduled");
    expect(mails.some((m) => m.to === prospectEmail && /Confirmed/.test(m.subject))).toBe(true);
    // The slot disappears and a second prospect can't take it.
    expect((await BK.availableSlots()).days.flatMap((d) => d.slots)).not.toContain(slot);
    const other = enquiry();
    const t2 = (await PUB.submitEnquiry(ref.token, other, { ip: "192.0.2.51" })).token;
    await expect(BK.bookByToken(t2, { starts_at: slot, meeting_type: "phone" })).rejects.toThrow(/no longer available/);
    await expect(BK.bookByToken(t2, { starts_at: "2020-01-01T10:00:00+05:30", meeting_type: "phone" })).rejects.toThrow(/no longer available/);
    // Database-level guarantee even if the availability check is bypassed.
    const [c] = await rawSystem((tx) => tx`select starts_at, ends_at from discovery_calls where lead_id = ${leadId} and status = 'scheduled'`);
    const otherLead = (await leadByEmail(other.email))[0].id;
    await expect(rawSystem((tx) => tx`insert into discovery_calls (lead_id, starts_at, ends_at, meeting_type) values (${otherLead}, ${c.starts_at}, ${c.ends_at}, 'phone')`)).rejects.toThrow(/duplicate key/);
    await expect(BK.scheduleCall(admin, otherLead, { starts_at: new Date(c.starts_at).toISOString(), meeting_type: "phone" })).rejects.toThrow(/overlaps/);
    // Reschedule keeps one active booking.
    const slot2 = ctx.days[1].slots[5];
    await BK.bookByToken(bookingToken, { starts_at: slot2, meeting_type: "phone" });
    expect(await rawSystem((tx) => tx`select 1 from discovery_calls where lead_id = ${leadId} and status = 'scheduled'`)).toHaveLength(1);
    // Cancel and book again.
    await BK.cancelByToken(bookingToken);
    expect((await lead(leadId)).stage).toBe("qualified");
    await BK.bookByToken(bookingToken, { starts_at: slot, meeting_type: "video_call" });
  });

  it("stage rules: won is never manual; outcome required before 'call completed'", async () => {
    await expect(RF.changeStage(admin, leadId, { stage: "won" })).rejects.toThrow(/automatically/);
    await expect(RF.changeStage(admin, leadId, { stage: "call_completed" })).rejects.toThrow(/outcome/);
    await expect(RF.changeStage(admin, leadId, { stage: "lost" })).rejects.toThrow(/reason/);
    await expect(BK.recordCallOutcome(admin, (await rawSystem((tx) => tx`select id from discovery_calls where lead_id = ${leadId} and status = 'scheduled'`))[0].id, { outcome: "qualified" }))
      .rejects.toThrow(/once the call has started/);
    // Simulate the call having happened.
    await rawSystem((tx) => tx`update discovery_calls set starts_at = now() - interval '1 hour', ends_at = now() - interval '30 minutes' where lead_id = ${leadId} and status = 'scheduled'`);
    const [c] = await rawSystem((tx) => tx`select id from discovery_calls where lead_id = ${leadId} and status = 'scheduled'`);
    await BK.recordCallOutcome(admin, c.id, { outcome: "proposal_requested", notes: "Wants a booking site" });
    const l = await lead(leadId);
    expect(l.stage).toBe("call_completed");
    expect(l.qualified_at).toBeTruthy();
    expect(await rawSystem((tx) => tx`select 1 from lead_tasks where lead_id = ${leadId} and dedupe_key like 'proposal:%'`)).toHaveLength(1);
  });

  it("proposal → acceptance → first confirmed payment converts the lead and tells the referrer; refunds reverse it", async () => {
    const clientId = await RF.convertLeadToClient(admin, leadId);
    expect(await RF.convertLeadToClient(admin, leadId)).toBe(clientId);
    const { proposalId } = await sendProjectProposal(admin, clientId, null);
    let l = await lead(leadId);
    expect(l.stage).toBe("proposal_sent");
    // The prospect joins the portal and accepts.
    const inv = await C.inviteClient(admin, clientId, { email: prospectEmail });
    const session = await C.acceptInvitation(inv.link.split("/invite/")[1], { name: "Arun Das", password: "SpiceBox2026x" });
    const prospect = (await actorFromToken(session.token))!;
    await acceptAsClient(prospect, proposalId);
    l = await lead(leadId);
    expect(l.proposal_accepted_at).toBeTruthy();
    expect(l.stage).toBe("negotiation");
    expect(l.converted_at).toBeNull(); // accepted ≠ paying client
    const projectId = await P.connectProject(admin, proposalId, {});
    const invoice = await B.createInvoiceFromTerm(admin, projectId, 0);
    await B.issueInvoice(admin, invoice);
    // A pending payment does not convert.
    const pending = await B.recordPayment(admin, projectId, { invoice_id: invoice, amount: 1000, method: "upi", paid_on: istToday(), status: "pending" });
    expect((await lead(leadId)).converted_at).toBeNull();
    await B.setPaymentStatus(admin, pending, "confirmed");
    l = await lead(leadId);
    expect(l.stage).toBe("won");
    expect(l.converted_at).toBeTruthy();
    expect((await RF.myReferrals(ref.client)).history.find((h) => h.name === "Enquiry via your link" && h.label === "Successful referral")).toBeTruthy();
    expect((await listNotifications(ref.client)).some((n) => n.type === "referral_success")).toBe(true);
    expect(mails.some((m) => m.to === ref.email && /Thank you for your referral/.test(m.subject))).toBe(true);
    // Analytics reflect the verified conversion and revenue.
    const from = addDays(istToday(), -1), to = istToday();
    const a = await AN.referralAnalytics(admin, { from, to, referrer: ref.clientId });
    expect(a.counts.converted).toBe(1);
    expect(a.counts.revenue).toBe(1000);
    expect(a.counts.verified).toBeGreaterThanOrEqual(1);
    expect(a.rates.conversion_rate).toBe(Math.round((1 / a.counts.verified) * 1000) / 10);
    expect(a.byReferrer[0]).toMatchObject({ client_id: ref.clientId, converted: 1, revenue: 1000 });
    // Reversed payment → no longer converted.
    await B.setPaymentStatus(admin, pending, "refunded");
    l = await lead(leadId);
    expect(l.converted_at).toBeNull();
    expect(l.stage).toBe("negotiation");
    expect((await AN.referralAnalytics(admin, { from, to, referrer: ref.clientId })).counts.converted).toBe(0);
  });
});

describe("12–13. isolation and reliability", () => {
  it("clients see only their own referral data; leads are staff-only", async () => {
    const a = await referrerWithLink("IsoA");
    const b = await makeClientWithProject(admin, "IsoB");
    await PUB.submitEnquiry(a.token, enquiry(), { ip: "192.0.2.90" });
    expect(await rawAs(b.client, (tx) => tx`select id from leads`)).toHaveLength(0);
    expect(await rawAs(a.client, (tx) => tx`select id from leads`)).toHaveLength(0);
    expect(await rawAs(b.client, (tx) => tx`select id from referral_links where client_id = ${a.clientId}`)).toHaveLength(0);
    expect(await rawAs(b.client, (tx) => tx`select id from project_feedback where client_id = ${a.clientId}`)).toHaveLength(0);
    expect(await rawAs(a.client, (tx) => tx`select token from referral_links`)).toHaveLength(1);
    await expect(RF.getFeedbackRequest(b.client, a.projectId)).rejects.toThrow(/not found/i);
    await expect(RF.submitFeedback(b.client, a.projectId, stars(5))).rejects.toThrow(/not found/i);
    await expect(RF.listLeads(a.client)).rejects.toThrow(/access/i);
    await expect(RF.manageLink(a.client, "disable", b.clientId)).resolves.toBeUndefined(); // acts on their own link only
    const [own] = await rawSystem((tx) => tx`select status from referral_links where client_id = ${a.clientId}`);
    expect(own.status).toBe("disabled");
    expect((await RF.myReferrals(b.client)).link).toBeNull();
    await expect(RF.submitIntroduction(b.client, { business_name: "X Co", challenge: "Needs an app" })).rejects.toThrow(/positive feedback/);
  });

  it("failed emails are retried without duplicates; reminders respect the opt-out", async () => {
    smtpFail = true;
    const r = await makeClientWithProject(admin, "Retry");
    await complete(r.projectId);
    const [d] = await rawSystem((tx) => tx`select id, status from message_deliveries where purpose = 'referral' and recipient = ${r.email}`);
    expect(d.status).toBe("failed");
    smtpFail = false;
    const res = await RF.retryReferralEmails(true);
    expect(res.sent).toBeGreaterThanOrEqual(1);
    expect((await rawSystem((tx) => tx`select status, attempts from message_deliveries where id = ${d.id}`))[0]).toEqual({ status: "sent", attempts: 2 });
    // Reminder after the delay, once; opted-out clients get the portal notice but no email.
    await RF.setEmailPreference(r.client, true);
    await rawSystem((tx) => tx`update referral_workflows set next_reminder_at = now() - interval '1 minute' where project_id = ${r.projectId}`);
    const before = mails.filter((m) => m.to === r.email).length;
    const job = await runReferralJob();
    expect(job.reminders).toBe(1);
    expect(mails.filter((m) => m.to === r.email).length).toBe(before);
    expect((await wf(r.projectId)).reminders_sent).toBe(1);
    await runReferralJob();
    expect((await wf(r.projectId)).reminders_sent).toBe(1); // next reminder isn't due yet
  });

  it("a failing event handler is recorded and retried safely", async () => {
    const orig = RF._handlers["referral.lead.qualified"];
    let fail = true;
    RF._handlers["referral.lead.qualified"] = async (p) => { if (fail) throw new Error("boom"); await orig!(p); };
    const id = await RF.createLead(admin, { business_name: "Retry Lead", email: `${uniq("rl")}@example.test` });
    await RF.changeStage(admin, id, { stage: "qualified" });
    const [e] = await rawSystem((tx) => tx`select id, status, error from referral_events where lead_id = ${id} and type = 'referral.lead.qualified'`);
    expect(e).toMatchObject({ status: "failed", error: "boom" });
    fail = false;
    await RF.retryFailedEvents(e.id);
    await RF.retryFailedEvents(e.id);
    expect((await rawSystem((tx) => tx`select status from referral_events where id = ${e.id}`))[0].status).toBe("processed");
    expect(await rawSystem((tx) => tx`select 1 from lead_tasks where lead_id = ${id}`)).toHaveLength(1);
    RF._handlers["referral.lead.qualified"] = orig;
  });
});
