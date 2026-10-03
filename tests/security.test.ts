import { describe, it, expect, beforeAll } from "vitest";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawAs, rawSystem, uniq } from "./helpers";
import * as Q from "@/server/quotations";
import * as C from "@/server/clients";
import * as M from "@/server/milestones";
import * as X from "@/server/content";
import * as B from "@/server/billing";
import { projectOverview, clientProjects, adminDashboard } from "@/server/dashboards";
import { login, actorFromToken, logout } from "@/server/auth";

describe("client isolation", () => {
  let admin: Actor;
  let a: Awaited<ReturnType<typeof makeClientWithProject>>;
  let b: Awaited<ReturnType<typeof makeClientWithProject>>;
  let aVersion: string, aInvoice: string, aDoc: string, aMilestone: string, aPreview: string;

  beforeAll(async () => {
    admin = await makeAdmin();
    a = await makeClientWithProject(admin, "Alpha");
    b = await makeClientWithProject(admin, "Beta");
    const q = await Q.createQuotation(admin, a.projectId, {});
    aVersion = q.versionId;
    await Q.sendQuotation(admin, aVersion);
    const { hash } = await Q.getVersion(a.client, aVersion);
    await Q.acceptQuotation(a.client, aVersion, { signer_name: "Alpha Owner", confirm_scope: true, confirm_terms: true, content_hash: hash });
    aInvoice = await B.createInvoiceFromTerm(admin, a.projectId, 0);
    await B.issueInvoice(admin, aInvoice);
    await B.recordPayment(admin, a.projectId, { invoice_id: aInvoice, amount: 100, method: "cash", paid_on: "2026-10-01", status: "confirmed" });
    aDoc = await X.uploadDocument(admin, a.projectId, { name: "logo.png", type: "image/png", data: Buffer.from("png-bytes") }, { category: "screenshot" });
    aMilestone = (await M.listMilestones(admin, a.projectId))[0].id;
    aPreview = await X.publishPreview(admin, a.projectId, { url: "https://example.com/a" }, { detectEmbed: false });
  });

  it("client B cannot load client A's project through any service", async () => {
    await expect(projectOverview(b.client, a.projectId)).rejects.toThrow(/not found/i);
    await expect(M.listMilestones(b.client, a.projectId)).rejects.toThrow(/not found/i);
    await expect(Q.listProjectQuotations(b.client, a.projectId)).rejects.toThrow(/not found/i);
    await expect(Q.getVersion(b.client, aVersion)).rejects.toThrow(/not found/i);
    await expect(B.getBilling(b.client, a.projectId)).rejects.toThrow(/not found/i);
    await expect(B.getInvoice(b.client, aInvoice)).rejects.toThrow(/not found/i);
    await expect(X.readDocument(b.client, aDoc)).rejects.toThrow(/not found/i);
    await expect(X.listDocuments(b.client, a.projectId)).rejects.toThrow(/not found/i);
    await expect(X.listUpdates(b.client, a.projectId)).rejects.toThrow(/not found/i);
    await expect(X.listThread(b.client, a.projectId)).rejects.toThrow(/not found/i);
    await expect(X.listPreviews(b.client, a.projectId)).rejects.toThrow(/not found/i);
  });

  it("client B cannot write into client A's project", async () => {
    await expect(X.addComment(b.client, a.projectId, { target_type: "thread", body: "hi" })).rejects.toThrow(/not found/i);
    await expect(X.uploadDocument(b.client, a.projectId, { name: "x.pdf", type: "application/pdf", data: Buffer.from("x") }, { category: "brand_asset" })).rejects.toThrow(/not found/i);
    await expect(X.reviewPreview(b.client, aPreview, { decision: "approved" })).rejects.toThrow(/not found/i);
    await expect(Q.requestQuotationChanges(b.client, aVersion, { note: "x" })).rejects.toThrow(/not found/i);
  });

  it("forging the client id in the actor does not grant access (RLS uses membership)", async () => {
    const forged: Actor = { ...b.client, clientId: a.clientId };
    await expect(projectOverview(forged, a.projectId)).rejects.toThrow(/not found/i);
  });

  it("raw SQL under a client context only returns that client's rows", async () => {
    const counts = await rawAs(b.client, async (tx) => ({
      projects: (await tx`select id from projects where id = ${a.projectId}`).length,
      clients: (await tx`select id from client_profiles where id = ${a.clientId}`).length,
      versions: (await tx`select id from quotation_versions where project_id = ${a.projectId}`).length,
      items: (await tx`select i.id from quotation_items i where i.version_id = ${aVersion}`).length,
      acceptances: (await tx`select id from quotation_acceptances where project_id = ${a.projectId}`).length,
      invoices: (await tx`select id from invoices where project_id = ${a.projectId}`).length,
      payments: (await tx`select id from payments where project_id = ${a.projectId}`).length,
      documents: (await tx`select id from documents where id = ${aDoc}`).length,
      blobs: (await tx`select document_id from document_blobs where document_id = ${aDoc}`).length,
      milestones: (await tx`select id from milestones where id = ${aMilestone}`).length,
      users: (await tx`select id from users where client_id = ${a.clientId}`).length,
      sessions: (await tx`select id from sessions`).length,
      credentials: (await tx`select user_id from user_credentials`).length,
      invitations: (await tx`select id from client_invitations`).length,
      audit: (await tx`select id from audit_logs`).length,
      templates: (await tx`select id from quotation_templates`).length,
      notes: (await tx`select id from project_internal_notes`).length,
    }));
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it("clients cannot write directly to protected tables even with raw SQL", async () => {
    await expect(rawAs(a.client, (tx) => tx`update milestones set status = 'completed' where id = ${aMilestone}`)).resolves.toHaveProperty("count", 0);
    await expect(rawAs(a.client, (tx) => tx`insert into payments (project_id, amount, method, status) values (${a.projectId}, 1, 'cash', 'confirmed')`)).rejects.toThrow(/row-level security/);
    await expect(rawAs(a.client, (tx) => tx`update quotation_versions set total = 1 where id = ${aVersion}`)).resolves.toHaveProperty("count", 0);
    await expect(rawAs(a.client, (tx) => tx`insert into project_members (project_id, user_id) values (${b.projectId}, ${a.client.userId})`)).rejects.toThrow(/row-level security/);
    await expect(rawAs(a.client, (tx) => tx`insert into comments (project_id, target_type, author_id, body) values (${b.projectId}, 'thread', ${a.client.userId}, 'x')`)).rejects.toThrow(/row-level security/);
    await expect(rawAs(a.client, (tx) => tx`insert into comments (project_id, target_type, author_id, body) values (${a.projectId}, 'thread', ${b.client.userId}, 'spoof')`)).rejects.toThrow(/row-level security/);
  });

  it("a request with no context sees nothing", async () => {
    const { getSql } = await import("@/lib/db");
    const rows = await getSql().begin((tx) => tx`select id from projects`);
    expect(rows).toHaveLength(0);
  });

  it("clients cannot call admin services", async () => {
    await expect(C.listClients(a.client)).rejects.toThrow(/access/i);
    await expect(C.createProject(a.client, a.clientId, { name: "x", project_type: "website" })).rejects.toThrow(/access/i);
    await expect(Q.createQuotation(a.client, a.projectId, {})).rejects.toThrow(/access/i);
    await expect(X.publishPreview(a.client, a.projectId, { url: "https://x.com" }, { detectEmbed: false })).rejects.toThrow(/access/i);
    await expect(X.postUpdate(a.client, a.projectId, { title: "x", kind: "general", visibility: "client" })).rejects.toThrow(/access/i);
    await expect(B.issueInvoice(a.client, aInvoice)).rejects.toThrow(/access/i);
    await expect(adminDashboard(a.client)).rejects.toThrow(/access/i);
  });

  it("clients can only upload permitted categories and cannot see internal documents", async () => {
    await expect(X.uploadDocument(a.client, a.projectId, { name: "inv.pdf", type: "application/pdf", data: Buffer.from("x") }, { category: "invoice" })).rejects.toThrow(/brand assets/);
    await expect(X.uploadDocument(a.client, a.projectId, { name: "page.html", type: "text/html", data: Buffer.from("<script>") }, { category: "brand_asset" })).rejects.toThrow(/not supported/);
    await X.uploadDocument(a.client, a.projectId, { name: "menu.pdf", type: "application/pdf", data: Buffer.from("%PDF") }, { category: "brand_asset" });
    const internal = await X.uploadDocument(admin, a.projectId, { name: "costing.xlsx", type: "application/vnd.ms-excel", data: Buffer.from("x") }, { category: "other", visibility: "internal" });
    const docs = await X.listDocuments(a.client, a.projectId);
    expect(docs.map((d) => d.name)).toContain("menu.pdf");
    expect(docs.map((d) => d.name)).not.toContain("costing.xlsx");
    await expect(X.readDocument(a.client, internal)).rejects.toThrow(/not found/i);
    expect((await X.readDocument(a.client, aDoc)).data.toString()).toBe("png-bytes");
  });

  it("each client only lists their own projects", async () => {
    const list = await clientProjects(b.client);
    expect(list.map((p) => p.id)).toEqual([b.projectId]);
  });
});

describe("invitations and access", () => {
  let admin: Actor;
  beforeAll(async () => { admin = await makeAdmin(); });

  it("invitation tokens are single-use and stored only as hashes", async () => {
    const email = `${uniq("inv")}@example.test`;
    const clientId = await C.createClient(admin, { business_name: "Inv Cafe", owner_name: "Owner", email });
    const projectId = await C.createProject(admin, clientId, { name: "Site", project_type: "website" });
    const inv = await C.inviteClient(admin, clientId, { email, project_id: projectId });
    const token = inv.link.split("/invite/")[1];
    expect(token.length).toBeGreaterThanOrEqual(43);
    const stored = await rawSystem((tx) => tx`select token_hash from client_invitations where id = ${inv.invitationId}`);
    expect(stored[0].token_hash).not.toContain(token);
    expect((await C.inspectInvitation(token)).state).toBe("valid");
    await expect(C.acceptInvitation(token, { name: "Owner", password: "short" })).rejects.toThrow(/10 characters/);
    expect((await C.inspectInvitation(token)).state).toBe("valid"); // failed attempt does not consume it
    await C.acceptInvitation(token, { name: "Owner", password: "GoodPassword1" });
    expect((await C.inspectInvitation(token)).state).toBe("used");
    await expect(C.acceptInvitation(token, { name: "Owner", password: "GoodPassword1" })).rejects.toThrow(/invalid, expired/);
  });

  it("expired, revoked and resent invitations are rejected", async () => {
    const email = `${uniq("exp")}@example.test`;
    const clientId = await C.createClient(admin, { business_name: "Exp Cafe", owner_name: "Owner", email });
    const i1 = await C.inviteClient(admin, clientId, { email });
    await rawSystem((tx) => tx`update client_invitations set expires_at = now() - interval '1 minute' where id = ${i1.invitationId}`);
    expect((await C.inspectInvitation(i1.link.split("/invite/")[1])).state).toBe("expired");
    const i2 = await C.inviteClient(admin, clientId, { email });
    const i3 = await C.resendInvitation(admin, i2.invitationId);
    expect((await C.inspectInvitation(i2.link.split("/invite/")[1])).state).toBe("revoked");
    await C.revokeInvitation(admin, i3.invitationId);
    await expect(C.acceptInvitation(i3.link.split("/invite/")[1], { name: "x", password: "GoodPassword1" })).rejects.toThrow();
    expect((await C.inspectInvitation("not-a-real-token")).state).toBe("invalid");
  });

  it("an invitation cannot hijack an email used by another account", async () => {
    const other = await makeClientWithProject(admin, "Other");
    const clientId = await C.createClient(admin, { business_name: "Hijack", owner_name: "H", email: "h@example.test" });
    await expect(C.inviteClient(admin, clientId, { email: other.email })).rejects.toThrow(/already used/);
    await expect(C.inviteClient(admin, clientId, { email: admin.email })).rejects.toThrow(/already used/);
  });

  it("login, session lookup, logout and brute-force lockout", async () => {
    const c = await makeClientWithProject(admin, "Login");
    const s = await login(c.email, "ClientPass123");
    expect((await actorFromToken(s.token))?.userId).toBe(c.client.userId);
    await logout(s.token);
    expect(await actorFromToken(s.token)).toBeNull();
    expect(await actorFromToken("garbage")).toBeNull();
    for (let i = 0; i < 5; i++) await expect(login(c.email, "wrong-password-1")).rejects.toThrow(/Incorrect/);
    await expect(login(c.email, "ClientPass123")).rejects.toThrow(/Too many/);
  });

  it("revoking portal access ends sessions and blocks login; restoring re-enables", async () => {
    const c = await makeClientWithProject(admin, "Revoke");
    expect(await actorFromToken(c.sessionToken)).not.toBeNull();
    await C.setPortalAccess(admin, c.clientId, false);
    expect(await actorFromToken(c.sessionToken)).toBeNull();
    await expect(login(c.email, "ClientPass123")).rejects.toThrow(/disabled/);
    await expect(C.inviteClient(admin, c.clientId, { email: c.email })).rejects.toThrow(/revoked/);
    await C.setPortalAccess(admin, c.clientId, true);
    expect((await login(c.email, "ClientPass123")).role).toBe("client");
  });

  it("audit logs are append-only", async () => {
    await expect(rawSystem((tx) => tx`update audit_logs set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(rawSystem((tx) => tx`delete from audit_logs`)).rejects.toThrow(/append-only/);
  });
});
