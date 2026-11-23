import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawAs, rawSystem, uniq } from "./helpers";
import * as MK from "@/server/marketplace";
import * as RW from "@/server/rewards";
import * as AD from "@/server/advisor";
import * as MT from "@/server/meetings";
import * as SC from "@/server/showcase";
import * as PF from "@/server/preferences";
import * as GR from "@/server/growth";
import * as BK from "@/server/booking";
import * as B from "@/server/billing";
import * as C from "@/server/clients";
import * as CT from "@/server/content";
import { clientActivity } from "@/server/dashboards";
import { upiLink } from "@/lib/upi";
import { getPaymentDetails } from "@/server/maintenance";
import { listNotifications } from "@/server/content";

let admin: Actor;
const day = [["09:00", "21:00"]];

beforeAll(async () => {
  delete process.env.GROQ_API_KEY;
  admin = await makeAdmin();
  await BK.saveBookingSettings(admin, { slot_minutes: 30, min_notice_hours: 1, horizon_days: 14, weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
    blocked_dates: [], meeting_types: ["video_call", "phone"], default_meeting_link: "" });
});

describe("UPI scan-to-pay", () => {
  it("the migration fills in 9980801231@ybl only when no UPI ID was saved", async () => {
    const sql = readFileSync("db/migrations/010_growth_portal.sql", "utf8");
    const upsert = sql.slice(sql.indexOf("insert into app_settings (key, value) values ('payment_details'"), sql.indexOf("updated_at = now()\nwhere") + "updated_at = now()\nwhere coalesce(app_settings.value->>'upi_id', '') = '';".length);
    await rawSystem(async (tx) => {
      await tx`update app_settings set value = '{"upi_id": "", "payee_name": "", "account_number": "123456789012"}' where key = 'payment_details'`;
      await tx.unsafe(upsert);
    });
    let pd = await getPaymentDetails();
    expect(pd.upi_id).toBe("9980801231@ybl");
    expect(pd.payee_name).toBe("Infinity Web & Apps");
    expect(pd.account_number).toBe("123456789012"); // other saved details are kept
    await rawSystem(async (tx) => {
      await tx`update app_settings set value = value || '{"upi_id": "owner@okicici", "payee_name": "Owner"}' where key = 'payment_details'`;
      await tx.unsafe(upsert);
    });
    pd = await getPaymentDetails();
    expect(pd.upi_id).toBe("owner@okicici"); // a UPI ID the admin chose is never overwritten
  });

  it("builds an NPCI link with the amount and no transaction reference", () => {
    const q = new URLSearchParams(upiLink({ upi_id: "9980801231@ybl", payee_name: "Infinity Web & Apps" }, 36000, "INV-0051").split("?")[1]);
    expect(q.get("pa")).toBe("9980801231@ybl");
    expect(q.get("am")).toBe("36000.00");
    expect(q.get("cu")).toBe("INR");
    expect(q.has("tr")).toBe(false);
  });
});

describe("Service marketplace", () => {
  it("recommends from the client's industry with a reason, and skips what they already have", async () => {
    const services = await MK.listServices(admin);
    const recs = MK.recommend(services, { category: "Physiotherapy clinic", owned: [], requested: [] });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.reason.includes("physiotherapy clinic"))).toBe(true);
    expect(recs.map((r) => r.service.slug)).toContain("crm");
    const skip = MK.recommend(services, { category: "Physiotherapy clinic", owned: ["crm"], requested: [] });
    expect(skip.map((r) => r.service.slug)).not.toContain("crm");
    expect(MK.recommend(services, { category: null, owned: [], requested: [] })).toEqual([]);
  });

  it("an upgrade request creates one inquiry, a pipeline opportunity and an admin notification — and charges nothing", async () => {
    const c = await makeClientWithProject(admin, "Physio");
    await rawSystem((tx) => tx`update client_profiles set business_category = 'Physiotherapy clinic' where id = ${c.clientId}`);
    const m = await MK.marketplace(c.client);
    expect(m.recommendations.length).toBeGreaterThan(0);
    const svc = m.services.find((s) => s.slug === "ai-receptionist")!;
    const invoicesBefore = (await B.getBilling(admin, c.projectId)).invoices.length;
    const r = await MK.requestUpgrade(c.client, { service_id: svc.id, note: "Answer calls during sessions" });
    expect(r.created).toBe(true);
    const again = await MK.requestUpgrade(c.client, { service_id: svc.id });
    expect(again.created).toBe(false); // idempotent while open
    const [lead] = await rawSystem((tx) => tx<{ source: string; stage: string; client_id: string; service: string }[]>`select source, stage, client_id, service from leads where id = ${r.leadId}`);
    expect(lead).toMatchObject({ source: "upgrade_request", stage: "enquiry_submitted", client_id: c.clientId, service: "AI receptionist" });
    expect((await B.getBilling(admin, c.projectId)).invoices.length).toBe(invoicesBefore);
    expect((await listNotifications(admin)).some((n) => n.title.includes("AI receptionist"))).toBe(true);
    // Status flows back to the client
    const inq = (await MK.listInquiries(admin)).find((i) => i.id === r.id)!;
    await MK.setInquiryStatus(admin, inq.id, "proposal_sent");
    expect((await MK.marketplace(c.client)).inquiries[0].status).toBe("proposal_sent");
  });

  it("clients can't see other clients' inquiries or write to the catalogue", async () => {
    const a = await makeClientWithProject(admin, "Gym");
    const b = await makeClientWithProject(admin, "Bakery");
    const svc = (await MK.listServices(a.client))[0];
    await MK.requestUpgrade(a.client, { service_id: svc.id });
    expect(await rawAs(b.client, (tx) => tx`select * from service_inquiries where client_id = ${a.clientId}`)).toHaveLength(0);
    await expect(MK.saveService(b.client, null, { name: "X", slug: "x-x", category: "apps", summary: "x", benefits: "", industries: "" })).rejects.toThrow();
    await expect(rawAs(b.client, (tx) => tx`insert into service_catalog (slug, name, category, summary) values ('hack', 'Hack', 'apps', 'x')`)).rejects.toThrow();
  });
});

describe("Referral rewards", () => {
  it("a converted referral becomes an eligible reward only while a campaign is active; admins approve and issue it", async () => {
    const referrer = await makeClientWithProject(admin, "Ref");
    const today = new Date().toISOString().slice(0, 10);
    const campaignId = await RW.saveCampaign(admin, null, { name: "Winter", reward_type: "renewal_credit", reward_value: 2000, reward_text: "₹2,000 off your next renewal", starts_on: today, is_active: true });
    // A referred lead with an attribution that converts
    const [l] = await rawSystem((tx) => tx<{ id: string }[]>`insert into leads (business_name, stage, converted_at) values (${uniq("Dental")}, 'won', now()) returning id`);
    await rawSystem((tx) => tx`insert into referral_attributions (lead_id, referrer_client_id, method) values (${l.id}, ${referrer.clientId}, 'link')`);
    const rewardId = await RW.onReferralConverted(l.id);
    expect(rewardId).toBeTruthy();
    expect(await RW.onReferralConverted(l.id)).toBeNull(); // one reward per lead
    const mine = await RW.myRewards(referrer.client);
    expect(mine.campaign?.id).toBe(campaignId);
    expect(mine.rewards[0]).toMatchObject({ status: "eligible", reward_text: "₹2,000 off your next renewal" });
    await expect(RW.decideReward(admin, rewardId!, { decision: "issued" })).rejects.toThrow(/can't be marked issued/);
    await expect(RW.decideReward(admin, rewardId!, { decision: "rejected" })).rejects.toThrow(/reason/);
    await expect(RW.decideReward(referrer.client, rewardId!, { decision: "approved" })).rejects.toThrow();
    await RW.decideReward(admin, rewardId!, { decision: "approved" });
    // A refund before issuing reverses it
    await RW.onConversionReversed(l.id);
    expect((await RW.myRewards(referrer.client)).rewards[0].status).toBe("reversed");
    // Campaign switched off: no new rewards
    await RW.saveCampaign(admin, campaignId, { name: "Winter", reward_type: "renewal_credit", reward_value: 2000, reward_text: "₹2,000 off your next renewal", starts_on: today, is_active: false });
    const [l2] = await rawSystem((tx) => tx<{ id: string }[]>`insert into leads (business_name, stage, converted_at) values (${uniq("Cafe")}, 'won', now()) returning id`);
    await rawSystem((tx) => tx`insert into referral_attributions (lead_id, referrer_client_id, method) values (${l2.id}, ${referrer.clientId}, 'link')`);
    expect(await RW.onReferralConverted(l2.id)).toBeNull();
  });
});

describe("AI service advisor", () => {
  it("works without AI using rules, recommends only catalogue services, and turns a consultation into opportunities", async () => {
    const c = await makeClientWithProject(admin, "Clinic");
    const r = await AD.ask(c.client, "I run a physiotherapy clinic and spend too much time answering appointment calls.");
    expect(r.services).toContain("ai-receptionist");
    expect(r.reply).not.toMatch(/₹\s?\d/);
    const a = await AD.getAdvisor(c.client);
    expect(a.aiOn).toBe(false);
    expect(a.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const out = await AD.requestConsultation(c.client);
    expect(out.services).toBeGreaterThan(0);
    const leads = await rawSystem((tx) => tx<{ source: string }[]>`select source from leads where client_id = ${c.clientId}`);
    expect(leads.every((l) => l.source === "ai_advisor")).toBe(true);
    await AD.deleteAdvisorHistory(c.client);
    expect((await AD.getAdvisor(c.client)).messages).toHaveLength(0);
  });

  it("with AI on, sends no personal data and replaces replies that invent prices or timelines", async () => {
    const c = await makeClientWithProject(admin, "Salon");
    process.env.GROQ_API_KEY = "test";
    const bodies: string[] = [];
    let reply = { reply: "An AI receptionist would help. It costs ₹4,999 and is ready in 3 days!", services: ["ai-receptionist", "not-a-service"] };
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: {} }), { status: 200 });
    }));
    try {
      const r = await AD.ask(c.client, "We miss calls while with customers");
      expect(r.services).toEqual(["ai-receptionist"]);
      expect(r.reply).not.toContain("4,999");
      expect(r.reply).not.toMatch(/3 days/);
      expect(bodies[0]).not.toContain(c.email);
      expect(bodies[0]).not.toContain("Salon Owner");
      reply = { reply: "An AI receptionist can answer common questions and book visits for you.", services: ["ai-receptionist"] };
      const ok = await AD.ask(c.client, "Tell me more");
      expect(ok.reply).toBe(reply.reply);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.GROQ_API_KEY;
    }
  });

  it("clients only see their own conversations", async () => {
    const a = await makeClientWithProject(admin, "AdvA");
    const b = await makeClientWithProject(admin, "AdvB");
    await AD.ask(a.client, "I need a website");
    expect(await rawAs(b.client, (tx) => tx`select * from advisor_messages`)).toHaveLength(0);
    expect(await rawAs(b.client, (tx) => tx`select * from advisor_conversations where client_id = ${a.clientId}`)).toHaveLength(0);
  });
});

describe("Client meetings", () => {
  it("books only real free slots, never double-books, and supports reschedule and cancel", async () => {
    const a = await makeClientWithProject(admin, "MeetA");
    const b = await makeClientWithProject(admin, "MeetB");
    const m = await MT.clientMeetings(a.client);
    const slot = m.days[1].slots[0];
    const id = await MT.bookMeeting(a.client, { purpose: "consultation", starts_at: slot, meeting_type: "phone", agenda: "Booking app" });
    await expect(MT.bookMeeting(b.client, { purpose: "project_checkin", starts_at: slot, meeting_type: "phone" })).rejects.toThrow(/taken|isn't available/);
    expect((await MT.clientMeetings(b.client)).days.flatMap((d) => d.slots)).not.toContain(slot);
    await expect(MT.bookMeeting(a.client, { purpose: "consultation", starts_at: "2020-01-01T10:00:00+05:30", meeting_type: "phone" })).rejects.toThrow();
    // B can't see or cancel A's meeting
    expect(await rawAs(b.client, (tx) => tx`select * from discovery_calls where id = ${id}`)).toHaveLength(0);
    await expect(MT.cancelMeeting(b.client, id)).rejects.toThrow();
    // Reschedule frees the old slot
    const next = m.days[2].slots[0];
    await MT.bookMeeting(a.client, { purpose: "consultation", starts_at: next, meeting_type: "phone", replaces: id });
    const after = await MT.clientMeetings(a.client);
    expect(after.upcoming).toHaveLength(1);
    expect(new Date(after.upcoming[0].starts_at).toISOString()).toBe(next);
    expect(after.days.flatMap((d) => d.slots)).toContain(slot);
    await MT.cancelMeeting(a.client, after.upcoming[0].id);
    expect((await MT.clientMeetings(a.client)).upcoming).toHaveLength(0);
    // Admin call list includes client meetings without breaking on a missing lead
    expect((await BK.listCalls(admin, "past")).some((c) => c.client_id === a.clientId)).toBe(true);
  });
});

describe("Showcase & testimonials", () => {
  it("nothing is public without permission; testimonials need consent and admin review", async () => {
    const c = await makeClientWithProject(admin, "Show");
    const slug = uniq("fitzone").toLowerCase();
    const id = await SC.saveShowcaseItem(admin, null, { title: "FitZone app", slug, client_label: "FitZone Gym", industry: "Fitness", service_type: "Mobile app",
      summary: "Member app", metrics: "Renewals: +20%", live_url: "", permission_confirmed: false });
    await expect(SC.setShowcaseStatus(admin, id, true)).rejects.toThrow(/permission/);
    expect(await SC.publishedItem(slug)).toBeNull();
    await SC.saveShowcaseItem(admin, id, { title: "FitZone app", slug, client_label: "FitZone Gym", industry: "Fitness", service_type: "Mobile app",
      summary: "Member app", metrics: "Renewals: +20%", live_url: "", permission_confirmed: true, permission_note: "Email 12 Nov" });
    await SC.setShowcaseStatus(admin, id, true);
    expect((await SC.publishedItem(slug))?.metrics).toEqual([{ label: "Renewals", value: "+20%" }]);
    await expect(SC.showcaseImage(id, "after", null)).rejects.toThrow();

    await expect(SC.submitTestimonial(c.client, { quote: "Great team, very responsive.", display_name: "Priya", consent: false })).rejects.toThrow(/publish/);
    const t = await SC.submitTestimonial(c.client, { quote: "Great team, very responsive.", display_name: "Priya", consent: true });
    expect((await SC.publishedShowcase()).testimonials.some((x) => x.id === t)).toBe(false);
    await SC.reviewTestimonial(admin, t, "published");
    expect((await SC.publishedShowcase()).testimonials.some((x) => x.id === t)).toBe(true);
    await SC.withdrawTestimonial(c.client, t);
    expect((await SC.publishedShowcase()).testimonials.some((x) => x.id === t)).toBe(false);
    await expect(SC.reviewTestimonial(admin, t, "published")).rejects.toThrow(/withdrew/);
  });
});

describe("Preferences, review studio and dashboards", () => {
  it("WhatsApp needs consent and a phone number; email preference is saved", async () => {
    const c = await makeClientWithProject(admin, "Pref");
    await expect(PF.savePreferences(c.client, { notify_email: true, notify_whatsapp: true, whatsapp_consent: false })).rejects.toThrow(/agree/);
    await PF.savePreferences(c.client, { notify_email: false, notify_whatsapp: true, whatsapp_consent: true });
    const p = await PF.getPreferences(c.client);
    expect(p).toMatchObject({ notify_email: false, notify_whatsapp: true });
    expect(p.whatsapp_consent_at).toBeTruthy();
    expect(p.whatsappAvailable).toBe(false);
  });

  it("a change request creates a revision task; approving answers the linked approval; activity and growth numbers load", async () => {
    const c = await makeClientWithProject(admin, "Studio");
    const v1 = await CT.publishPreview(admin, c.projectId, { url: "https://example.com", title: "Home" }, { detectEmbed: false });
    await CT.reviewPreview(c.client, v1, { decision: "changes_requested", note: "Use our clinic photo" });
    const tasks = await rawSystem((tx) => tx<{ description: string }[]>`select description from resolve_action_items where project_id = ${c.projectId}`);
    expect(tasks[0].description).toContain("Use our clinic photo");
    const v2 = await CT.publishPreview(admin, c.projectId, { url: "https://example.com/v2", title: "Home" }, { detectEmbed: false });
    await rawSystem((tx) => tx`insert into approval_requests (project_id, preview_id, title) values (${c.projectId}, ${v2}, 'Approve the homepage')`);
    await CT.reviewPreview(c.client, v2, { decision: "approved" });
    const [ar] = await rawSystem((tx) => tx<{ status: string; responded_by: string }[]>`select status, responded_by from approval_requests where preview_id = ${v2}`);
    expect(ar).toMatchObject({ status: "approved", responded_by: c.client.userId });
    const act = await clientActivity(c.client, c.projectId);
    expect(act.some((a) => a.title === "You approved version 2")).toBe(true);
    // Another client can't read this project's activity
    const other = await makeClientWithProject(admin, "Other");
    await expect(clientActivity(other.client, c.projectId)).rejects.toThrow();

    const g = await GR.growthDashboard(admin, 90);
    expect(g.kpis.activeClients).toBeGreaterThan(0);
    expect(g.months).toHaveLength(6);
    expect(g.pipeline.map((p) => p.label)).toEqual(["New lead", "Contacted", "Interested", "Demo scheduled", "Proposal sent", "Won", "Lost"]);
    await expect(GR.growthDashboard(c.client)).rejects.toThrow();
    void C;
  });
});
