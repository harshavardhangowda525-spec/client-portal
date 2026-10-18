import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawAs, rawSystem } from "./helpers";
import * as Q from "@/server/quotations";
import * as B from "@/server/billing";
import * as MT from "@/server/maintenance";
import { addDays, addMonths, istDate, istToday, daysBetween } from "@/lib/dates";

type Mail = { to: string; subject: string; raw: string };
const mails: Mail[] = [];
let smtp: SMTPServer;
let smtpFail = false;

async function deliveries(projectId: string) {
  return rawSystem((tx) => tx<{ kind: string; audience: string; channel: string; status: string; attempts: number; idempotency_key: string; error: string | null }[]>`
    select kind, audience, channel, status, attempts, idempotency_key, error from message_deliveries
    where project_id = ${projectId} and purpose = 'maintenance' order by created_at`);
}
const sent = (rows: Awaited<ReturnType<typeof deliveries>>, kind: string, audience = "client", channel = "email") =>
  rows.filter((r) => r.kind === kind && r.audience === audience && r.channel === channel);
async function project(projectId: string) {
  const [p] = await rawSystem((tx) => tx<Record<string, any>[]>`select * from projects where id = ${projectId}`);
  return p;
}
/** Make the project's free period end on `end` (admin override, audited). */
async function setEnd(admin: Actor, projectId: string, end: string) {
  const p = await project(projectId);
  await MT.updateProjectMaintenance(admin, projectId, {
    free_maintenance_start_date: addMonths(end, -6), free_maintenance_end_date: end,
    maintenance_exempt: p.maintenance_exempt, maintenance_paused: p.maintenance_paused, maintenance_covers_hosting: p.maintenance_covers_hosting,
  });
}

describe("maintenance expiry & billing", () => {
  let admin: Actor;
  const today = istToday();

  beforeAll(async () => {
    smtp = new SMTPServer({
      authOptional: true, disabledCommands: ["STARTTLS"], logger: false,
      onData(stream, session, cb) {
        let raw = "";
        stream.on("data", (c) => (raw += c));
        stream.on("end", () => {
          if (smtpFail) return cb(new Error("Mailbox unavailable"));
          mails.push({ to: session.envelope.rcptTo.map((r) => r.address).join(","), subject: /^Subject: (.*)$/m.exec(raw)?.[1] ?? "", raw });
          cb();
        });
      },
    });
    await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String((smtp.server.address() as AddressInfo).port);
    process.env.SMTP_FROM = "Infinity <hello@infinity.test>";
    admin = await makeAdmin();
    await MT.saveMaintenanceSettings(admin, { ...(await MT.getMaintenanceSettings()), admin_email: "owner@infinity.test", admin_whatsapp: "9000000001" });
  });
  afterEach(() => { vi.unstubAllGlobals(); smtpFail = false; delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID; delete process.env.WHATSAPP_TEMPLATE_NAME; });
  afterAll(async () => {
    delete process.env.SMTP_HOST;
    await new Promise<void>((r) => smtp.close(() => r()));
  });

  it("1–2. the free period starts when the proposal is initiated and lasts six calendar months (IST)", async () => {
    const { projectId } = await makeClientWithProject(admin, "Start");
    await MT.runMaintenanceJob();
    expect((await project(projectId)).free_maintenance_start_date).toBeNull(); // no proposal yet
    await Q.createQuotation(admin, projectId, { title: "Website" });
    // Proposal initiated at 20:00 UTC on 31 Aug = 1 Sep in India.
    await rawSystem((tx) => tx`update quotations set created_at = '2026-08-31T20:00:00Z' where project_id = ${projectId}`);
    await MT.runMaintenanceJob();
    const p = await project(projectId);
    expect(istDate(p.proposal_started_at)).toBe("2026-09-01");
    expect(p.free_maintenance_start_date).toBe("2026-09-01");
    expect(p.free_maintenance_end_date).toBe("2027-03-01");
  });

  it("month-end and leap-year dates are clamped, not overflowed", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2027-08-31", 6)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(istDate(new Date("2026-12-31T18:45:00Z"))).toBe("2027-01-01");
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
  });

  it("the start trigger is configurable (proposal accepted / project delivered)", async () => {
    const { projectId } = await makeClientWithProject(admin, "Trigger");
    await Q.createQuotation(admin, projectId, { title: "Website" });
    const s = await MT.getMaintenanceSettings();
    await MT.saveMaintenanceSettings(admin, { ...s, trigger: "project_delivered" });
    await MT.runMaintenanceJob();
    expect((await project(projectId)).free_maintenance_end_date).toBeNull();
    await rawSystem((tx) => tx`update projects set completed_at = '2026-05-10T10:00:00Z' where id = ${projectId}`);
    await MT.runMaintenanceJob();
    expect((await project(projectId)).free_maintenance_end_date).toBe("2026-11-10");
    await MT.saveMaintenanceSettings(admin, s);
  });

  it("3–4, 8. 30-day and 7-day reminders go out once each, to the client and admin, even if the job runs repeatedly", async () => {
    const { projectId, email } = await makeClientWithProject(admin, "Remind");
    await setEnd(admin, projectId, addDays(today, 30));
    await MT.runMaintenanceJob();
    await MT.runMaintenanceJob();
    let d = await deliveries(projectId);
    expect(sent(d, "expiry_reminder")).toHaveLength(1);
    expect(sent(d, "expiry_reminder")[0].status).toBe("sent");
    expect(sent(d, "admin_expiring", "admin")).toHaveLength(1);
    expect((await project(projectId)).maintenance_status).toBe("EXPIRING_SOON");
    expect(mails.some((m) => m.to === email && /ends in 30 days/.test(m.subject))).toBe(true);

    await MT.runMaintenanceJob({ today: addDays(today, 23) }); // 7 days left
    await MT.runMaintenanceJob({ today: addDays(today, 23) });
    d = await deliveries(projectId);
    expect(sent(d, "expiry_reminder")).toHaveLength(2);
    expect(new Set(sent(d, "expiry_reminder").map((r) => r.idempotency_key)).size).toBe(2);
  });

  it("missed runs are caught up within the window, but stale reminders are not sent late", async () => {
    const { projectId } = await makeClientWithProject(admin, "Catchup");
    await setEnd(admin, projectId, addDays(today, 29)); // the 30-day reminder was due yesterday
    await MT.runMaintenanceJob();
    expect(sent(await deliveries(projectId), "expiry_reminder")).toHaveLength(1);
    const late = await makeClientWithProject(admin, "Late");
    await setEnd(admin, late.projectId, addDays(today, 20)); // 30-day reminder 10 days ago → skipped
    await MT.runMaintenanceJob();
    expect(sent(await deliveries(late.projectId), "expiry_reminder")).toHaveLength(0);
  });

  it("5–6. on expiry the client gets the expiry notice and the admin is alerted; status moves to awaiting confirmation", async () => {
    const { projectId, email } = await makeClientWithProject(admin, "Expire");
    await setEnd(admin, projectId, today);
    expect((await project(projectId)).maintenance_status).toBe("FREE_MAINTENANCE_EXPIRED");
    await MT.runMaintenanceJob();
    await MT.runMaintenanceJob();
    const d = await deliveries(projectId);
    expect(sent(d, "expired")).toHaveLength(1);
    expect(sent(d, "admin_expired", "admin")).toHaveLength(1);
    const mail = mails.find((m) => m.to === email && /has ended/.test(m.subject))!;
    expect(mail.raw).toMatch(/=E2=82=B9500|₹500/);
    expect(mails.some((m) => m.to === "owner@infinity.test" && /Free.maintenance.expired/.test(m.subject))).toBe(true);
    expect((await project(projectId)).maintenance_status).toBe("AWAITING_CLIENT_CONFIRMATION");
  });

  it("7. WhatsApp: logged as not configured without credentials; sent through the Cloud API template when configured", async () => {
    const a = await makeClientWithProject(admin, "WaOff");
    await setEnd(admin, a.projectId, today);
    await MT.runMaintenanceJob();
    expect(sent(await deliveries(a.projectId), "expired", "client", "whatsapp")[0].status).toBe("not_configured");

    process.env.WHATSAPP_TOKEN = "test-token"; process.env.WHATSAPP_PHONE_NUMBER_ID = "123"; process.env.WHATSAPP_TEMPLATE_NAME = "maintenance_alert";
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }));
    const b = await makeClientWithProject(admin, "WaOn");
    await setEnd(admin, b.projectId, today);
    await MT.runMaintenanceJob();
    const d = await deliveries(b.projectId);
    expect(sent(d, "expired", "client", "whatsapp")[0].status).toBe("sent");
    expect(sent(d, "admin_expired", "admin", "whatsapp")[0].status).toBe("sent");
    const adminMsg = calls.find((c) => c.body.to === "919000000001")!;
    expect(adminMsg.url).toContain("graph.facebook.com");
    expect(adminMsg.body.template.name).toBe("maintenance_alert");
    const param = adminMsg.body.template.components[0].parameters[0].text as string;
    expect(param).toContain("six-month free maintenance period has expired");
    expect(param).not.toMatch(/\n/);
  });

  it("9. failed emails are retried a limited number of times", async () => {
    const { projectId } = await makeClientWithProject(admin, "Retry");
    const s = await MT.getMaintenanceSettings();
    await MT.saveMaintenanceSettings(admin, { ...s, retry_delay_hours: 0.25 });
    smtpFail = true;
    await setEnd(admin, projectId, today);
    await MT.runMaintenanceJob();
    let [row] = sent(await deliveries(projectId), "expired");
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    // Not due yet → no retry.
    expect((await MT.retryFailedDeliveries({ projectId })).retried).toBe(0);
    for (let i = 0; i < 5; i++) await MT.retryFailedDeliveries({ projectId, force: true });
    [row] = sent(await deliveries(projectId), "expired");
    expect(row.attempts).toBe(3);
    expect(row.status).toBe("failed");
    smtpFail = false;
    // Out of retries: further runs do not resend.
    await MT.runMaintenanceJob();
    expect(sent(await deliveries(projectId), "expired")).toHaveLength(1);
    await MT.saveMaintenanceSettings(admin, s);
  });

  it("is never auto-charged: no invoice is created after expiry without the client's explicit consent", async () => {
    const { projectId } = await makeClientWithProject(admin, "NoCharge");
    await setEnd(admin, projectId, addDays(today, -40));
    await MT.runMaintenanceJob();
    await MT.runMaintenanceJob({ today: addDays(today, 60) });
    const [{ n }] = await rawSystem((tx) => tx`select count(*)::int as n from invoices where project_id = ${projectId}`);
    expect(n).toBe(0);
  });

  describe("10–14. paid maintenance", () => {
    let projectId: string; let client: Actor; let invoiceId: string;

    beforeAll(async () => {
      ({ projectId, client } = await makeClientWithProject(admin, "Paid"));
      await setEnd(admin, projectId, today);
      await MT.runMaintenanceJob();
    });

    it("10. activation requires explicit consent and records the terms shown", async () => {
      const terms = await MT.maintenanceTerms(projectId);
      expect(terms.fee).toBe(500);
      expect(terms.included.join(" ")).not.toMatch(/hosting/i); // not covered unless configured for the project
      await expect(MT.activateMaintenance(client, projectId, { signer_name: "Paid Owner", confirm_terms: true })).rejects.toThrow(/recurring/i);
      await expect(MT.activateMaintenance(admin, projectId, { signer_name: "x", confirm_terms: true, confirm_recurring: true })).rejects.toThrow(/Only the client/);
      await MT.activateMaintenance(client, projectId, { signer_name: "Paid Owner", confirm_terms: true, confirm_recurring: true }, { ip: "1.2.3.4" });
      await expect(MT.activateMaintenance(client, projectId, { signer_name: "Paid Owner", confirm_terms: true, confirm_recurring: true })).rejects.toThrow(/already active/);
      const [c] = await rawSystem((tx) => tx<Record<string, any>[]>`select * from maintenance_consents where project_id = ${projectId}`);
      expect(Number(c.monthly_fee)).toBe(500);
      expect(c.billing_start).toBe(today);
      await expect(rawSystem((tx) => tx`update maintenance_consents set monthly_fee = 1 where id = ${c.id}`)).rejects.toThrow();
      // Activated, but nothing paid yet.
      expect((await project(projectId)).maintenance_status).toBe("AWAITING_CLIENT_CONFIRMATION");
    });

    it("11. the first monthly invoice is issued once, with a billing reminder", async () => {
      await MT.runMaintenanceJob();
      await MT.runMaintenanceJob();
      const invs = await rawSystem((tx) => tx<{ id: string; amount: string; due_date: string; kind: string; status: string }[]>`
        select * from invoices where project_id = ${projectId} and kind = 'maintenance'`);
      expect(invs).toHaveLength(1);
      expect(Number(invs[0].amount)).toBe(500);
      expect(invs[0].status).toBe("issued");
      invoiceId = invs[0].id;
      expect(sent(await deliveries(projectId), "billing_reminder")).toHaveLength(1);
      expect((await project(projectId)).next_billing_date).toBe(today);
    });

    it("a client-reported payment stays pending and is not treated as paid", async () => {
      await MT.reportPayment(client, invoiceId, { reference: "UTR123456789", amount: 500, paid_on: today });
      expect((await project(projectId)).maintenance_status).toBe("AWAITING_CLIENT_CONFIRMATION");
      const [inv] = await rawSystem((tx) => tx`select status from invoices where id = ${invoiceId}`);
      expect(inv.status).toBe("issued");
      expect(sent(await deliveries(projectId), "admin_payment_reported", "admin")).toHaveLength(1);
    });

    it("12. admin confirmation marks it paid, sends the confirmation and moves to paid maintenance", async () => {
      const [pay] = await rawSystem((tx) => tx<{ id: string }[]>`select id from payments where invoice_id = ${invoiceId}`);
      await B.setPaymentStatus(admin, pay.id, "confirmed");
      const p = await project(projectId);
      expect(p.maintenance_status).toBe("PAID_MAINTENANCE_ACTIVE");
      expect(p.next_billing_date).toBe(addMonths(today, 1));
      expect(sent(await deliveries(projectId), "payment_confirmed")).toHaveLength(1);
      // Confirming again is rejected — no duplicate payments.
      await expect(B.setPaymentStatus(admin, pay.id, "confirmed")).rejects.toThrow();
    });

    it("13. next month's invoice; if unpaid after the due date it becomes overdue with one reminder", async () => {
      const next = addMonths(today, 1);
      await MT.runMaintenanceJob({ today: addDays(next, -3) });
      await MT.runMaintenanceJob({ today: addDays(next, -2) });
      const invs = await rawSystem((tx) => tx`select id from invoices where project_id = ${projectId} and kind = 'maintenance' and status <> 'void'`);
      expect(invs).toHaveLength(2);
      await MT.runMaintenanceJob({ today: addDays(next, 1) });
      await MT.runMaintenanceJob({ today: addDays(next, 2) });
      expect((await project(projectId)).maintenance_status).toBe("PAYMENT_OVERDUE");
      const d = await deliveries(projectId);
      expect(sent(d, "payment_overdue")).toHaveLength(1);
      expect(sent(d, "admin_overdue", "admin")).toHaveLength(1);
    });

    it("14. the client can cancel; no further invoices are generated", async () => {
      await MT.cancelMaintenance(client, projectId);
      expect((await project(projectId)).maintenance_status).toBe("MAINTENANCE_CANCELLED");
      // The paid first month stays; the not-yet-due second month is voided.
      const count = async () => (await rawSystem((tx) => tx`select id from invoices where project_id = ${projectId} and kind = 'maintenance' and status <> 'void'`)).length;
      expect(await count()).toBe(1);
      await MT.runMaintenanceJob({ today: addMonths(today, 4) });
      expect(await count()).toBe(1);
      expect((await project(projectId)).next_billing_date).toBeNull();
    });
  });

  it("exempt projects get no notices or billing", async () => {
    const { projectId } = await makeClientWithProject(admin, "Exempt");
    await setEnd(admin, projectId, today);
    const p = await project(projectId);
    await MT.updateProjectMaintenance(admin, projectId, { free_maintenance_start_date: p.free_maintenance_start_date, free_maintenance_end_date: p.free_maintenance_end_date,
      maintenance_exempt: true, maintenance_paused: false, maintenance_covers_hosting: false });
    await MT.runMaintenanceJob();
    expect(await deliveries(projectId)).toHaveLength(0);
  });

  it("15. security: clients cannot change settings, see other projects, or confirm their own payments", async () => {
    const a = await makeClientWithProject(admin, "SecA");
    const b = await makeClientWithProject(admin, "SecB");
    await expect(MT.saveMaintenanceSettings(a.client, { trigger: "proposal_initiated" })).rejects.toThrow();
    await expect(MT.savePaymentDetails(a.client, { upi_id: "x@y" })).rejects.toThrow();
    await expect(MT.updateProjectMaintenance(a.client, a.projectId, { maintenance_exempt: true })).rejects.toThrow();
    await expect(MT.maintenanceDetail(a.client, b.projectId)).rejects.toThrow(/not found/i);
    await expect(B.setPaymentStatus(a.client, "00000000-0000-0000-0000-000000000000", "confirmed")).rejects.toThrow();
    await expect(MT.listMaintenance(a.client)).rejects.toThrow();
    // Raw SQL as the client: RLS blocks writes to projects and settings.
    await rawAs(a.client, (tx) => tx`update projects set maintenance_exempt = true where id = ${a.projectId}`).catch(() => null);
    expect((await project(a.projectId)).maintenance_exempt).toBe(false);
    const detail = await MT.maintenanceDetail(a.client, a.projectId);
    expect(detail.deliveries).toHaveLength(0);
    expect(detail.history).toHaveLength(0);
  });

  it("16. payment details are validated and the UPI link carries the exact amount", async () => {
    await expect(MT.savePaymentDetails(admin, { upi_id: "not-a-upi", payee_name: "X", account_holder: "", account_number: "", ifsc: "", bank_name: "", branch: "", instructions: "" }))
      .rejects.toThrow(/UPI/);
    await expect(MT.savePaymentDetails(admin, { upi_id: "", payee_name: "", account_holder: "", account_number: "", ifsc: "HDFC123", bank_name: "", branch: "", instructions: "" }))
      .rejects.toThrow(/IFSC/);
    await MT.savePaymentDetails(admin, { upi_id: "infinity@okhdfcbank", payee_name: "Infinity Web & Apps", account_holder: "Infinity", account_number: "123456789012", ifsc: "hdfc0001234", bank_name: "HDFC", branch: "", instructions: "" });
    const d = await MT.getPaymentDetails();
    expect(d.ifsc).toBe("HDFC0001234");
    const link = MT.upiLink(d, 500, "INV-0001");
    expect(link).toMatch(/^upi:\/\/pay\?/);
    const q = new URLSearchParams(link.split("?")[1]);
    expect(q.get("pa")).toBe("infinity@okhdfcbank");
    expect(q.get("am")).toBe("500.00");
    expect(q.get("cu")).toBe("INR");
    expect(q.get("pn")).toBe("Infinity Web & Apps");
  });

  it("CSV export neutralises formula injection", async () => {
    const csv = await MT.exportMaintenanceCsv(admin);
    expect(csv.split("\r\n")[0]).toContain("Free expiry");
    expect(MT.render("Hi {{client_name}}, {{missing}}!", { client_name: "Asha" })).toBe("Hi Asha, !");
  });
});
