import { describe, it, expect, beforeAll } from "vitest";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawSystem } from "./helpers";
import * as Q from "@/server/quotations";
import * as C from "@/server/clients";
import * as M from "@/server/milestones";
import * as X from "@/server/content";
import * as B from "@/server/billing";
import { projectOverview, adminDashboard } from "@/server/dashboards";
import { listNotifications } from "@/server/content";

describe("end-to-end workflow: client → quotation → acceptance → delivery → handover", () => {
  let admin: Actor;
  let client: Actor;
  let projectId: string;
  let quotationId: string;
  let v1: string;

  beforeAll(async () => {
    admin = await makeAdmin();
    ({ client, projectId } = await makeClientWithProject(admin));
  });

  it("creates the project with default weighted milestones at 0% progress", async () => {
    const o = await projectOverview(client, projectId);
    expect(o.total).toBe(14);
    expect(o.progress).toBe(0);
    expect(o.project.status).toBe("proposal");
  });

  it("admin drafts a quotation from the template; the draft is invisible to the client", async () => {
    const r = await Q.createQuotation(admin, projectId, { title: "Cafe website" });
    quotationId = r.quotationId; v1 = r.versionId;
    const { version, items } = await Q.getVersion(admin, v1);
    expect(version.status).toBe("draft");
    expect(items.length).toBeGreaterThan(0);
    expect(await Q.listProjectQuotations(client, projectId)).toHaveLength(0);
    await expect(Q.getVersion(client, v1)).rejects.toThrow(/not found/i);
  });

  it("admin edits the draft with discount and tax; totals are recomputed server-side", async () => {
    const { version } = await Q.getVersion(admin, v1);
    const totals = await Q.saveDraft(admin, v1, {
      project_description: "Cafe website", valid_until: version.valid_until, discount_type: "amount", discount_value: 1000,
      tax_label: "GST", tax_rate: 18,
      items: [{ description: "Design", details: null, quantity: 1, unit_price: 20000 }, { description: "Build", details: "5 pages", quantity: 1, unit_price: 21000 }],
      payment_terms: [{ label: "Advance payment", percent: 50, due: "On acceptance" }, { label: "Final payment", percent: 50, due: "Before launch" }],
      included_features: ["Responsive"], exclusions: ["Hosting fees"], revisions_included: 2,
      maintenance_terms: "30 days", domain_hosting_terms: "Client owns domain", delivery_timeline: "4 weeks", terms_conditions: "Standard terms", admin_note: "internal: margin ok",
    });
    expect(totals.subtotal).toBe(41000);
    expect(totals.total).toBe(47200);
  });

  it("rejects payment terms that do not sum to 100% when sending", async () => {
    const { version, items } = await Q.getVersion(admin, v1);
    await Q.saveDraft(admin, v1, { ...version, items, payment_terms: [{ label: "Advance", percent: 40, due: "x" }], included_features: [], exclusions: [], admin_note: null });
    await expect(Q.sendQuotation(admin, v1)).rejects.toThrow(/100%/);
    await Q.saveDraft(admin, v1, { ...version, items, payment_terms: [{ label: "Advance payment", percent: 50, due: "On acceptance" }, { label: "Final payment", percent: 50, due: "Before launch" }], admin_note: "internal: margin ok" });
  });

  it("sends the quotation; client sees it (without admin notes) and viewing is tracked", async () => {
    await Q.sendQuotation(admin, v1);
    const list = await Q.listProjectQuotations(client, projectId);
    expect(list[0].versions[0].status).toBe("sent");
    const view = await Q.getVersion(client, v1);
    expect((view.version as Record<string, unknown>).admin_note).toBeUndefined();
    await Q.recordQuotationView(client, v1);
    expect((await Q.getVersion(admin, v1)).version.status).toBe("viewed");
    const notes = await listNotifications(client);
    expect(notes.some((n) => n.type === "quotation_received")).toBe(true);
  });

  it("sent quotation content is locked; the admin must revise", async () => {
    await expect(Q.saveDraft(admin, v1, {})).rejects.toThrow();
    await expect(rawSystem((tx) => tx`update quotation_versions set total = 1 where id = ${v1}`)).rejects.toThrow(/revised version/);
  });

  it("client requests changes; admin revises into v2 and v1 is superseded", async () => {
    await Q.requestQuotationChanges(client, v1, { note: "Please add an online menu QR code." });
    const v2 = await Q.reviseQuotation(admin, quotationId);
    const { version, items } = await Q.getVersion(admin, v2);
    expect(version.version_no).toBe(2);
    await Q.saveDraft(admin, v2, { ...version, items: [...items, { description: "Menu QR code", details: null, quantity: 1, unit_price: 1000 }], admin_note: null });
    await Q.sendQuotation(admin, v2);
    expect((await Q.getVersion(admin, v1)).version.status).toBe("superseded");
    await expect(Q.acceptQuotation(client, v1, { signer_name: "Cafe Owner", confirm_scope: true, confirm_terms: true, content_hash: "0".repeat(64) }))
      .rejects.toThrow(/newer version/);
    v1 = v2;
  });

  it("acceptance requires explicit confirmation and the exact reviewed content", async () => {
    const { hash } = await Q.getVersion(client, v1);
    await expect(Q.acceptQuotation(client, v1, { signer_name: "Cafe Owner", confirm_scope: false, confirm_terms: true, content_hash: hash })).rejects.toThrow(/scope/);
    await expect(Q.acceptQuotation(client, v1, { signer_name: "Cafe Owner", confirm_scope: true, confirm_terms: true, content_hash: "a".repeat(64) })).rejects.toThrow(/changed/);
    await expect(Q.acceptQuotation(admin, v1, { signer_name: "Admin", confirm_scope: true, confirm_terms: true, content_hash: hash })).rejects.toThrow(/Only the client/);
  });

  it("client accepts; acceptance records user, version, hash and terms; project awaits commencement", async () => {
    const { hash } = await Q.getVersion(client, v1);
    await Q.acceptQuotation(client, v1, { signer_name: "Cafe Owner", confirm_scope: true, confirm_terms: true, content_hash: hash }, { ip: "203.0.113.5", ua: "vitest" });
    const r = await Q.getVersion(admin, v1);
    expect(r.version.status).toBe("accepted");
    expect(r.acceptance?.signer_name).toBe("Cafe Owner");
    expect(r.acceptance?.content_hash).toBe(hash);
    expect(r.acceptance?.version_no).toBe(2);
    const [acc] = await rawSystem((tx) => tx`select user_id, terms_snapshot from quotation_acceptances where version_id = ${v1}`);
    expect(acc.user_id).toBe(client.userId);
    expect(acc.terms_snapshot.total).toBe(48380);
    const o = await projectOverview(admin, projectId);
    expect(o.project.status).toBe("quotation_accepted");
    // No milestone was auto-completed and no payment was created by acceptance.
    expect(o.completedCount).toBe(0);
    const billing = await B.getBilling(admin, projectId);
    expect(billing.paidTotal).toBe(0);
    expect(billing.payments).toHaveLength(0);
    const adminNotes = await listNotifications(admin);
    expect(adminNotes.some((n) => n.type === "quotation_accepted")).toBe(true);
    const audit = await rawSystem((tx) => tx`select 1 from audit_logs where action = 'quotation.accepted' and entity_id = ${v1}`);
    expect(audit).toHaveLength(1);
  });

  it("accepted versions are immutable at the database level", async () => {
    await expect(rawSystem((tx) => tx`update quotation_versions set status = 'sent' where id = ${v1}`)).rejects.toThrow(/immutable/);
    await expect(rawSystem((tx) => tx`delete from quotation_acceptances where version_id = ${v1}`)).rejects.toThrow(/append-only/);
    await expect(rawSystem((tx) => tx`delete from quotation_items where version_id = ${v1}`)).rejects.toThrow();
    // Revising after acceptance creates a new version and leaves the accepted one intact.
    const v3 = await Q.reviseQuotation(admin, quotationId);
    expect(v3).not.toBe(v1);
    expect((await Q.getVersion(admin, v1)).version.status).toBe("accepted");
    await Q.deleteDraft(admin, v3);
  });

  it("admin commences the project (no payment or deployment implied)", async () => {
    await C.commenceProject(admin, projectId, { start_date: "2026-10-05" });
    const o = await projectOverview(client, projectId);
    expect(o.project.status).toBe("active");
  });

  it("only admins change milestone status; progress follows weights", async () => {
    const ms = await M.listMilestones(admin, projectId);
    await expect(M.updateMilestone(client, ms[0].id, { ...ms[0], status: "completed" })).rejects.toThrow(/access/i);
    for (const m of ms.slice(0, 4)) await M.updateMilestone(admin, m.id, { ...m, status: "completed", note: "done" });
    await M.updateMilestone(admin, ms[4].id, { ...ms[4], status: "in_progress" });
    const o = await projectOverview(client, projectId);
    expect(o.progress).toBe(12); // weights 2+5+2+3 of 100
    expect(o.current?.title).toBe("Design and layout");
    expect(o.project.current_stage).toBe("Design and layout");
    const hist = (await M.listMilestones(client, projectId))[0].history;
    expect(hist[0].changes.status).toEqual(["not_started", "completed"]);
  });

  it("admin can add, reorder and delete milestones", async () => {
    const id = await M.createMilestone(admin, projectId, { title: "Photo shoot", weight: 4, description: null, start_date: null, due_date: "2026-10-20" });
    await M.moveMilestone(admin, id, "up");
    let ms = await M.listMilestones(admin, projectId);
    expect(ms[13].title).toBe("Photo shoot");
    await M.deleteMilestone(admin, id);
    ms = await M.listMilestones(admin, projectId);
    expect(ms).toHaveLength(14);
    expect(ms.map((m) => m.position)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it("blocked milestones require a reason", async () => {
    const [m] = (await M.listMilestones(admin, projectId)).slice(5);
    await expect(M.updateMilestone(admin, m.id, { ...m, status: "blocked" })).rejects.toThrow(/blocked/);
  });

  it("preview: publish, client feedback and approval, version history", async () => {
    const p1 = await X.publishPreview(admin, projectId, { url: "https://example.com/preview-1", title: "Homepage", notes: "First look" }, { detectEmbed: false });
    let previews = await X.listPreviews(client, projectId);
    expect(previews[0].status).toBe("ready_for_review");
    await expect(X.reviewPreview(client, p1, { decision: "changes_requested" })).rejects.toThrow(/describe/);
    await X.reviewPreview(client, p1, { decision: "changes_requested", note: "Make the logo bigger" });
    const p2 = await X.publishPreview(admin, projectId, { url: "https://example.com/preview-2", notes: "Logo enlarged" }, { detectEmbed: false });
    await X.reviewPreview(client, p2, { decision: "approved" });
    previews = await X.listPreviews(client, projectId);
    expect(previews.map((p) => [p.version_no, p.status])).toEqual([[2, "approved"], [1, "changes_requested"]]);
    expect(previews[1].comments[0].body).toBe("Make the logo bigger");
    await expect(X.publishPreview(admin, projectId, { url: "javascript:alert(1)" }, { detectEmbed: false })).rejects.toThrow();
  });

  it("updates, feedback requests and messages flow both ways; internal notes stay internal", async () => {
    await X.postUpdate(admin, projectId, { title: "Menu section completed", body: "All 42 items added", kind: "milestone", visibility: "client", requests_feedback: true });
    await X.postUpdate(admin, projectId, { title: "Internal: chase photos", body: "Owner slow to send", kind: "general", visibility: "internal" });
    const clientUpdates = await X.listUpdates(client, projectId);
    expect(clientUpdates.some((u) => u.title.startsWith("Internal"))).toBe(false);
    expect((await X.listUpdates(admin, projectId)).some((u) => u.title.startsWith("Internal"))).toBe(true);
    const o = await projectOverview(client, projectId);
    const fb = o.pendingActions.find((a) => a.kind === "approval")!;
    expect(fb.title).toBe("Menu section completed");
    await M.respondToApproval(client, fb.id, { decision: "answered", response: "Looks great" });
    await expect(M.respondToApproval(client, fb.id, { decision: "answered", response: "again" })).rejects.toThrow(/already/);

    const internal = (await X.listUpdates(admin, projectId)).find((u) => u.title.startsWith("Internal"))!;
    await expect(X.addComment(client, projectId, { target_type: "update", target_id: internal.id, body: "peek" })).rejects.toThrow(/not found/);

    await X.addComment(client, projectId, { target_type: "thread", body: "When will the gallery be ready?" });
    expect(await X.unreadMessageCount(admin, projectId)).toBe(1);
    await X.markThreadRead(admin, projectId);
    expect(await X.unreadMessageCount(admin, projectId)).toBe(0);
    await X.addComment(admin, projectId, { target_type: "thread", body: "By Friday." });
    expect(await X.unreadMessageCount(client, projectId)).toBe(1);
  });

  it("invoices and manual payments: balances, receipts and no automatic 'paid'", async () => {
    let billing = await B.getBilling(client, projectId);
    expect(billing.contractTotal).toBe(48380);
    expect(billing.advanceRequired).toBe(24190);
    const inv = await B.createInvoiceFromTerm(admin, projectId, 0, "2026-10-10");
    expect((await B.getBilling(client, projectId)).invoices).toHaveLength(0); // draft hidden
    await B.issueInvoice(admin, inv);
    // A pending (unconfirmed) payment is invisible to the client and does not reduce the balance.
    const pending = await B.recordPayment(admin, projectId, { invoice_id: inv, amount: 24190, method: "upi", paid_on: "2026-10-03", reference: "UPI-1", status: "pending" });
    billing = await B.getBilling(client, projectId);
    expect(billing.payments).toHaveLength(0);
    expect(billing.paidTotal).toBe(0);
    expect(billing.invoices[0].status).toBe("issued");
    await B.setPaymentStatus(admin, pending, "confirmed");
    billing = await B.getBilling(client, projectId);
    expect(billing.paidTotal).toBe(24190);
    expect(billing.remaining).toBe(24190);
    expect(billing.invoices[0].status).toBe("paid");
    expect(billing.payments[0].receipt_number).toMatch(/^IWA-RCPT-/);
    await expect(B.createInvoiceFromTerm(admin, projectId, 0)).rejects.toThrow(/already exists/);
    await expect(B.voidInvoice(admin, inv)).rejects.toThrow(/confirmed payments/);
    await expect(B.recordPayment(client as Actor, projectId, { amount: 1, method: "cash", paid_on: "2026-10-01", status: "confirmed" })).rejects.toThrow(/access/i);
  });

  it("online payments cannot be confirmed without provider verification", async () => {
    await expect(rawSystem((tx) => tx`insert into payments (project_id, amount, method, status, source) values (${projectId}, 10, 'razorpay', 'confirmed', 'razorpay')`))
      .rejects.toThrow(/check/);
  });

  it("overdue invoices are flagged but never marked paid", async () => {
    const inv = await B.createInvoiceFromTerm(admin, projectId, 1, "2026-01-01");
    await B.issueInvoice(admin, inv);
    const billing = await B.getBilling(admin, projectId);
    const i = billing.invoices.find((x) => x.id === inv)!;
    expect(i.overdue).toBe(true);
    expect(i.status).toBe("issued");
    const d = await adminDashboard(admin);
    expect(d.overdueInvoices.some((x) => x.id === inv)).toBe(true);
    await B.recordPayment(admin, projectId, { invoice_id: inv, amount: 24190, method: "bank_transfer", paid_on: "2026-10-03", reference: "NEFT-9", status: "confirmed" });
  });

  it("handover: all milestones complete gives 100% and the project can be completed", async () => {
    const ms = await M.listMilestones(admin, projectId);
    for (const m of ms) if (m.status !== "completed") await M.updateMilestone(admin, m.id, { ...m, status: "completed", blocked_reason: null });
    await C.setProjectStatus(admin, projectId, "completed");
    const o = await projectOverview(client, projectId);
    expect(o.progress).toBe(100);
    expect(o.project.status).toBe("completed");
    const billing = await B.getBilling(client, projectId);
    expect(billing.remaining).toBe(0);
  });
});

describe("workflow edge cases", () => {
  it("declined offers and cancellations follow allowed transitions", async () => {
    const admin = await makeAdmin();
    const { client, projectId } = await makeClientWithProject(admin, "Bakery");
    const { versionId } = await Q.createQuotation(admin, projectId, {});
    await Q.sendQuotation(admin, versionId);
    await Q.rejectQuotation(client, versionId, { reason: "Budget" });
    expect((await Q.getVersion(admin, versionId)).version.status).toBe("rejected");
    await expect(C.commenceProject(admin, projectId, {})).rejects.toThrow(/accept a quotation/);
    await C.setProjectStatus(admin, projectId, "declined", "Budget");
    await expect(C.setProjectStatus(admin, projectId, "completed")).rejects.toThrow(/cannot move/);
    await C.setProjectStatus(admin, projectId, "proposal");
  });

  it("expired quotations cannot be accepted", async () => {
    const admin = await makeAdmin();
    const { client, projectId } = await makeClientWithProject(admin, "Juice");
    const { versionId } = await Q.createQuotation(admin, projectId, {});
    await Q.sendQuotation(admin, versionId);
    await rawSystem((tx) => tx`update quotation_versions set status = 'sent' where id = ${versionId}`);
    // valid_until is protected once sent, so simulate time passing via a draft-era edit on a fresh quote instead
    const { versionId: v2 } = await Q.createQuotation(admin, projectId, {});
    await rawSystem((tx) => tx`update quotation_versions set valid_until = current_date - 1 where id = ${v2}`);
    await expect(Q.sendQuotation(admin, v2)).rejects.toThrow(/past/);
    await rawSystem(async (tx) => {
      await tx`update quotation_versions set status = 'sent' where id = ${v2}`;
    });
    const { hash } = await Q.getVersion(client, v2);
    await expect(Q.acceptQuotation(client, v2, { signer_name: "Juice Owner", confirm_scope: true, confirm_terms: true, content_hash: hash })).rejects.toThrow(/expired/);
    expect((await Q.getVersion(admin, v2)).version.status).toBe("expired");
  });
});
