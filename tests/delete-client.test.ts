import { describe, it, expect, beforeAll } from "vitest";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawSystem } from "./helpers";
import * as C from "@/server/clients";
import * as Q from "@/server/quotations";
import * as B from "@/server/billing";
import * as X from "@/server/content";
import * as P from "@/server/proposals";
import * as Pricing from "@/server/pricing";
import { actorFromToken, login } from "@/server/auth";

let admin: Actor;
beforeAll(async () => { admin = await makeAdmin(); });

const count = async (sqlText: TemplateStringsArray, ...v: unknown[]) =>
  Number((await rawSystem((tx) => tx(sqlText, ...(v as never[]))))[0].n);

async function sentProposal(clientId: string) {
  const cat = await Pricing.getCatalog(admin);
  const pkg = cat.packages.find((p) => p.kind === "website")!;
  const r = await P.saveProposal(admin, null, {
    client: { mode: "existing", client_id: clientId }, contact: { name: "Owner", email: "owner@example.test", phone: null },
    title: "Website", project_type: "website", pricing: { mode: "package", package_ids: [pkg.id], addons: [], custom: [] },
    externals: [], maintenance: null, warranty: { days: 30, terms: null },
    scope: { features: [], pages_screens: [], deliverables: [], client_responsibilities: [], revisions: 2, milestones: [], exclusions: [], assumptions: [] },
    discount: { rule_id: null, type: "none", value: 0, max_amount: null }, milestones: [{ label: "All", mode: "percent", value: 100, due: null }],
    valid_until: new Date(Date.now() + 864e6).toISOString().slice(0, 10),
  } as never);
  await P.sendProposal(admin, r.proposalId);
  return r;
}

describe("deleting clients", () => {
  it("permanently deletes a client with no signed or financial records, including sent quotations and proposals", async () => {
    const a = await makeClientWithProject(admin, "Gone");
    const other = await makeClientWithProject(admin, "Stays");
    const { versionId } = await Q.createQuotation(admin, a.projectId, {});
    await Q.sendQuotation(admin, versionId); // sent but not accepted — normally undeletable
    await sentProposal(a.clientId);
    await X.uploadDocument(admin, a.projectId, { name: "logo.png", type: "image/png", data: Buffer.from("x") }, { category: "brand_asset" });
    await X.addComment(a.client, a.projectId, { target_type: "thread", body: "hello" });
    const inv = await B.createInvoice(admin, a.projectId, { title: "Draft", amount: 100 });
    await B.recordPayment(admin, a.projectId, { amount: 50, method: "upi", paid_on: "2026-10-01", status: "pending" });

    const im = await C.clientDeletionImpact(admin, a.clientId);
    expect(im.protectedRecords).toEqual([]);
    expect(im.counts).toMatchObject({ projects: 1, proposals: 1, quotations: 1, invoices: 1, documents: 1, users: 1 });

    const r = await C.deleteClient(admin, a.clientId, "  gone bistro ");
    expect(r.result).toBe("deleted");
    expect(await count`select count(*) as n from client_profiles where id = ${a.clientId}`).toBe(0);
    expect(await count`select count(*) as n from projects where id = ${a.projectId}`).toBe(0);
    expect(await count`select count(*) as n from users where client_id = ${a.clientId} or id = ${a.client.userId}`).toBe(0);
    expect(await count`select count(*) as n from proposals where client_id = ${a.clientId}`).toBe(0);
    expect(await count`select count(*) as n from invoices where id = ${inv}`).toBe(0);
    expect(await actorFromToken(a.sessionToken)).toBeNull();
    await expect(login(a.email, "ClientPass123")).rejects.toThrow(/Incorrect/);
    expect(await count`select count(*) as n from audit_logs where action = 'client.deleted' and entity_id = ${a.clientId}`).toBe(1);
    // Other clients are untouched.
    expect(await count`select count(*) as n from projects where id = ${other.projectId}`).toBe(1);
    expect(await actorFromToken(other.sessionToken)).not.toBeNull();
  });

  it("requires the exact business name and is admin-only", async () => {
    const a = await makeClientWithProject(admin, "Guard");
    await expect(C.deleteClient(admin, a.clientId, "Wrong name")).rejects.toThrow(/Type the business name/);
    await expect(C.deleteClient(admin, a.clientId, "")).rejects.toThrow(/Type the business name/);
    await expect(C.deleteClient(a.client, a.clientId, "Guard Bistro")).rejects.toThrow(/access/i);
    await expect(C.clientDeletionImpact(a.client, a.clientId)).rejects.toThrow(/access/i);
    expect(await count`select count(*) as n from client_profiles where id = ${a.clientId}`).toBe(1);
  });

  it("archives (never deletes) a client with an accepted quotation, keeping every record", async () => {
    const a = await makeClientWithProject(admin, "Signed");
    const { versionId } = await Q.createQuotation(admin, a.projectId, {});
    await Q.sendQuotation(admin, versionId);
    const { hash } = await Q.getVersion(a.client, versionId);
    await Q.acceptQuotation(a.client, versionId, { signer_name: "Signed Owner", confirm_scope: true, confirm_terms: true, content_hash: hash });

    const im = await C.clientDeletionImpact(admin, a.clientId);
    expect(im.protectedRecords).toEqual(["1 accepted quotation"]);
    const r = await C.deleteClient(admin, a.clientId, "Signed Bistro");
    expect(r.result).toBe("archived");
    expect(await count`select count(*) as n from quotation_acceptances where version_id = ${versionId}`).toBe(1);
    expect(await count`select count(*) as n from projects where id = ${a.projectId}`).toBe(1);
    expect(await actorFromToken(a.sessionToken)).toBeNull();
    await expect(login(a.email, "ClientPass123")).rejects.toThrow(/disabled/);
    expect((await C.listClients(admin)).some((c) => c.id === a.clientId)).toBe(false);
    expect((await C.listClients(admin, { archived: true })).some((c) => c.id === a.clientId)).toBe(true);

    await C.unarchiveClient(admin, a.clientId);
    expect((await C.listClients(admin)).some((c) => c.id === a.clientId)).toBe(true);
    // Portal access stays revoked until the admin restores it explicitly.
    await expect(login(a.email, "ClientPass123")).rejects.toThrow(/disabled/);
  });

  it("archives clients with an accepted proposal, an issued invoice, or a confirmed payment", async () => {
    const p = await makeClientWithProject(admin, "Prop");
    const prop = await sentProposal(p.clientId);
    const view = await P.getProposal(p.client, prop.proposalId);
    await P.acceptProposal(p.client, view.version.id, { signer_name: "Prop Owner", confirm_scope: true, confirm_amount: true, confirm_recurring: true, content_hash: view.hash });
    expect((await C.deleteClient(admin, p.clientId, "Prop Bistro")).result).toBe("archived");

    const i = await makeClientWithProject(admin, "Inv");
    const inv = await B.createInvoice(admin, i.projectId, { title: "Advance", amount: 1000 });
    await B.issueInvoice(admin, inv);
    expect((await C.clientDeletionImpact(admin, i.clientId)).protectedRecords).toEqual(["1 issued invoice"]);
    expect((await C.deleteClient(admin, i.clientId, "Inv Bistro")).result).toBe("archived");

    const m = await makeClientWithProject(admin, "Pay");
    await B.recordPayment(admin, m.projectId, { amount: 500, method: "cash", paid_on: "2026-10-01", status: "confirmed" });
    expect((await C.clientDeletionImpact(admin, m.clientId)).protectedRecords).toEqual(["1 confirmed or refunded payment"]);
    expect((await C.deleteClient(admin, m.clientId, "Pay Bistro")).result).toBe("archived");
  });
});
