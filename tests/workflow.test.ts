import { describe, it, expect, beforeAll } from "vitest";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawSystem, proposalInput, sendProjectProposal, acceptAsClient } from "./helpers";
import * as P from "@/server/proposals";
import * as C from "@/server/clients";
import * as M from "@/server/milestones";
import * as X from "@/server/content";
import * as B from "@/server/billing";
import { projectOverview, adminDashboard } from "@/server/dashboards";
import { listNotifications } from "@/server/content";

describe("end-to-end workflow: client → proposal → acceptance → delivery → handover", () => {
  let admin: Actor;
  let client: Actor;
  let projectId: string;
  let clientId: string;
  let proposalId: string;
  let v1: string;
  let total: number;

  beforeAll(async () => {
    admin = await makeAdmin();
    ({ client, projectId, clientId } = await makeClientWithProject(admin));
  });

  it("creates the project with default weighted milestones at 0% progress", async () => {
    const o = await projectOverview(client, projectId);
    expect(o.total).toBe(14);
    expect(o.progress).toBe(0);
    expect(o.project.status).toBe("proposal");
  });

  it("admin drafts a proposal for the project; the draft is invisible to the client", async () => {
    const r = await P.saveProposal(admin, null, await proposalInput(admin, clientId, {
      project_id: projectId, title: "Cafe website",
      pricing: { mode: "itemized", package_ids: [], addons: [], custom: [{ name: "Design", description: null, quantity: 1, unit_price: 20000 }, { name: "Build", description: "5 pages", quantity: 1, unit_price: 21000 }] },
    }));
    proposalId = r.proposalId; v1 = r.versionId; total = r.computed.total;
    expect(total).toBe(41000);
    expect(await P.listProjectProposals(client, projectId)).toEqual([]);
    await expect(P.getProposal(client, proposalId)).rejects.toThrow(/not found/i);
    expect((await B.getBilling(admin, projectId)).contractTotal).toBeNull();
  });

  it("sends the proposal; it shows in the client's project as needing attention", async () => {
    await P.sendProposal(admin, proposalId);
    const o = await projectOverview(client, projectId);
    expect(o.pendingActions.some((a) => a.kind === "proposal" && a.href === `/portal/proposals/${proposalId}`)).toBe(true);
    expect((await P.listProjectProposals(client, projectId))[0].versions[0].status).toBe("sent");
    // Admin internal notes never reach the client.
    const view = await P.getProposal(client, proposalId);
    expect(JSON.stringify(view)).not.toContain("internal only");
  });

  it("client accepts; the proposal becomes the project's price and payment schedule", async () => {
    v1 = await acceptAsClient(client, proposalId, "Cafe Owner");
    const o = await projectOverview(admin, projectId);
    expect(o.project.status).toBe("quotation_accepted"); // shown as "Proposal accepted"
    // No milestone was auto-completed and no payment was created by acceptance.
    expect(o.completedCount).toBe(0);
    const billing = await B.getBilling(client, projectId);
    expect(billing.proposal?.proposal_id).toBe(proposalId);
    expect(billing.contractTotal).toBe(41000);
    expect(billing.paidTotal).toBe(0);
    expect(billing.remaining).toBe(41000);
    expect(billing.terms.map((t) => [t.label, t.amount])).toEqual([["Initial advance", 20500], ["Handover", 20500]]);
    expect(billing.payments).toHaveLength(0);
    const [acc] = await rawSystem((tx) => tx`select user_id from proposal_acceptances where version_id = ${v1}`);
    expect(acc.user_id).toBe(client.userId);
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
    expect(billing.contractTotal).toBe(total);
    expect(billing.advanceRequired).toBe(20500);
    const inv = await B.createInvoiceFromTerm(admin, projectId, 0, "2026-10-10");
    expect((await B.getBilling(client, projectId)).invoices).toHaveLength(0); // draft hidden
    await B.issueInvoice(admin, inv);
    // A pending (unconfirmed) payment is invisible to the client and does not reduce the balance.
    const pending = await B.recordPayment(admin, projectId, { invoice_id: inv, amount: 20500, method: "upi", paid_on: "2026-10-03", reference: "UPI-1", status: "pending" });
    billing = await B.getBilling(client, projectId);
    expect(billing.payments).toHaveLength(0);
    expect(billing.paidTotal).toBe(0);
    expect(billing.invoices[0].status).toBe("issued");
    await B.setPaymentStatus(admin, pending, "confirmed");
    billing = await B.getBilling(client, projectId);
    expect(billing.paidTotal).toBe(20500);
    expect(billing.remaining).toBe(20500);
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
    await B.recordPayment(admin, projectId, { invoice_id: inv, amount: 20500, method: "bank_transfer", paid_on: "2026-10-03", reference: "NEFT-9", status: "confirmed" });
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
    const { client, projectId, clientId } = await makeClientWithProject(admin, "Bakery");
    const { proposalId } = await sendProjectProposal(admin, clientId, projectId);
    const { version } = await P.getProposal(client, proposalId);
    await P.rejectProposal(client, version.id, { reason: "Budget" });
    expect((await P.getProposal(admin, proposalId)).version.status).toBe("rejected");
    await expect(C.commenceProject(admin, projectId, {})).rejects.toThrow(/accept a proposal/);
    await C.setProjectStatus(admin, projectId, "declined", "Budget");
    await expect(C.setProjectStatus(admin, projectId, "completed")).rejects.toThrow(/cannot move/);
    await C.setProjectStatus(admin, projectId, "proposal");
  });

  it("a proposal can only be linked to a project of the same client", async () => {
    const admin = await makeAdmin();
    const a = await makeClientWithProject(admin, "Juice");
    const b = await makeClientWithProject(admin, "Soda");
    await expect(P.saveProposal(admin, null, await proposalInput(admin, a.clientId, { project_id: b.projectId }))).rejects.toThrow(/does not belong/);
  });
});
