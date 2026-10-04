import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { inflateSync } from "node:zlib";
import type { Actor } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawAs, rawSystem, uniq } from "./helpers";
import * as P from "@/server/proposals";
import * as Pricing from "@/server/pricing";
import * as B from "@/server/billing";
import * as C from "@/server/clients";
import { computeProposal, type PricingInput } from "@/lib/proposal-calc";
import { proposalPdf } from "@/server/pdf";
import { formatMoneyPlain } from "@/lib/money";

const future = (days = 15) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

let admin: Actor;
let websitePkg: { id: string; price: number };
let appPkg: { id: string; price: number };

function baseInput(clientId: string, over: Record<string, unknown> = {}): P.ProposalInput {
  return {
    client: { mode: "existing", client_id: clientId },
    contact: { name: "Priya Sharma", email: "priya@example.test", phone: "9876543210" },
    title: "Cafe website",
    project_type: "website",
    description: "Website for a cafe",
    requirements: "Menu, gallery, contact",
    target_launch_date: null,
    assigned_to: null,
    internal_notes: "Margin is thin — keep it lean",
    executive_summary: "A fast, modern cafe website.",
    recommended_solution: "Basic business website package.",
    pricing: { mode: "package", package_ids: [websitePkg.id], addons: [], custom: [] },
    scope_details: { platforms: [], pages: 5 },
    externals: [],
    maintenance: null,
    warranty: { days: 30, terms: "Bug fixes for delivered scope." },
    scope: { objectives: "Online presence", features: ["Menu page"], pages_screens: ["Home", "Menu"], design_requirements: null, deliverables: ["Live website"],
      client_responsibilities: ["Provide logo"], content_requirements: null, revisions: 2, milestones: [{ title: "Design", estimate: "1 week" }],
      timeline: "About 3 weeks", acceptance_criteria: null, exclusions: ["Hosting fees"], assumptions: [] },
    discount: { rule_id: null, type: "none", value: 0, max_amount: null },
    milestones: [{ label: "Initial advance", mode: "percent", value: 50, due: "On acceptance" }, { label: "Handover", mode: "percent", value: 50, due: "Before launch" }],
    valid_until: future(),
    terms: "Standard terms",
    ...over,
  } as P.ProposalInput;
}

const noTax = { enabled: false, label: "GST", rate: 18, apply_to_external: false };
function calc(over: Partial<PricingInput>) {
  return computeProposal({
    mode: "package", pkgs: [], addons: [], custom: [], externals: [], maintenance: null, discount: { type: "none", value: 0 },
    discount_applies_to_external: false, tax: noTax, milestones: [{ label: "All", mode: "percent", value: 100 }], ...over,
  });
}

beforeAll(async () => {
  admin = await makeAdmin();
  const cat = await Pricing.getCatalog(admin);
  const w = cat.packages.find((p) => p.kind === "website")!;
  const a = cat.packages.find((p) => p.kind === "app")!;
  websitePkg = { id: w.id, price: Number(w.price) };
  appPkg = { id: a.id, price: Number(a.price) };
});

afterEach(async () => {
  await Pricing.saveSetting(admin, "tax", { enabled: false, label: "GST", rate: 18, apply_to_external: false });
  delete process.env.SMTP_HOST; delete process.env.SMTP_FROM; delete process.env.SMTP_PORT;
});

describe("pricing catalog defaults", () => {
  it("website base package breakdown totals exactly ₹4,999", async () => {
    const cat = await Pricing.getCatalog(admin);
    const w = cat.packages.find((p) => p.kind === "website")!;
    expect(Number(w.price)).toBe(4999);
    expect(w.items.reduce((s, i) => s + Number(i.amount), 0)).toBe(4999);
    expect(w.items).toHaveLength(8);
  });

  it("mobile app base package breakdown totals exactly ₹55,000", async () => {
    const cat = await Pricing.getCatalog(admin);
    const a = cat.packages.find((p) => p.kind === "app")!;
    expect(Number(a.price)).toBe(55000);
    expect(a.items.reduce((s, i) => s + Number(i.amount), 0)).toBe(55000);
  });

  it("rejects a package whose breakdown does not match its price", async () => {
    await expect(Pricing.savePackage(admin, null, { kind: "website", name: "Bad", price: 5000, items: [{ name: "x", amount: 4000 }] }))
      .rejects.toThrow(/must match/);
  });

  it("range services have no auto-chosen price and unknown provider fees stay unset", async () => {
    const cat = await Pricing.getCatalog(admin);
    expect(cat.services.every((s) => s.default_price == null)).toBe(true);
    expect(cat.externals.every((e) => e.selling_price == null && e.provider_cost == null)).toBe(true);
  });
});

describe("calculation engine", () => {
  const pkg = { id: "p", kind: "website" as const, name: "Basic", price: 4999, scope_limits: { pages: 5 },
    items: [{ name: "Design", amount: 2000 }, { name: "Build", amount: 2999 }] };

  it("package inclusions are shown but not charged twice", () => {
    const r = calc({ pkgs: [pkg] });
    expect(r.total).toBe(4999);
    expect(r.lines.filter((l) => l.section === "inclusion").every((l) => !l.charged)).toBe(true);
  });

  it("add-ons multiply quantity × unit price and update the total", () => {
    const r = calc({ pkgs: [pkg], addons: [{ name: "Additional page", quantity: 3, unit_price: 750 }, { name: "CMS", quantity: 1, unit_price: 4000 }] });
    expect(r.addons).toBe(6250);
    expect(r.total).toBe(11249);
  });

  it("requires an explicit quoted price for range services (never picks one)", () => {
    const r = calc({ pkgs: [pkg], addons: [{ name: "Online ordering", quantity: 1, unit_price: null, range_min: 5000, range_max: 15000 }] });
    expect(r.errors.join(" ")).toMatch(/quoted price/);
    expect(r.total).toBe(4999);
  });

  it("percentage discounts respect the cap and fixed discounts never exceed the eligible subtotal", () => {
    expect(calc({ pkgs: [pkg], discount: { type: "percent", value: 10 } }).discountAmount).toBe(499.9);
    expect(calc({ pkgs: [pkg], discount: { type: "percent", value: 50, max_amount: 1000 } }).discountAmount).toBe(1000);
    expect(calc({ pkgs: [pkg], discount: { type: "amount", value: 999999 } }).discountAmount).toBe(4999);
    expect(calc({ pkgs: [pkg], discount: { type: "percent", value: 10 } }).discountPercent).toBe(10);
  });

  it("tax applies only when enabled, after discount, and to external fees only if configured", () => {
    const ext = [{ name: "Domain", billing: "one_time" as const, selling_price: 1000, included_in_package: false, payer: "agency" as const }];
    expect(calc({ pkgs: [pkg], externals: ext }).taxAmount).toBe(0);
    const on = calc({ pkgs: [pkg], externals: ext, discount: { type: "amount", value: 999 }, tax: { enabled: true, label: "GST", rate: 18, apply_to_external: false } });
    expect(on.taxAmount).toBe(720); // 18% of (4999 − 999)
    expect(on.total).toBe(4999 + 1000 - 999 + 720);
    const withExt = calc({ pkgs: [pkg], externals: ext, tax: { enabled: true, label: "GST", rate: 18, apply_to_external: true } });
    expect(withExt.taxAmount).toBe(Math.round((5999 * 18)) / 100);
  });

  it("recurring costs never enter the one-time total; client-paid, included and TBC fees are not charged", () => {
    const r = calc({ pkgs: [pkg],
      externals: [
        { name: "Hosting", billing: "recurring", period: "annual", selling_price: 3000, included_in_package: false, payer: "agency" },
        { name: "Cloud DB", billing: "recurring", period: "monthly", selling_price: 800, included_in_package: false, payer: "agency" },
        { name: "Apple dev", billing: "recurring", period: "annual", selling_price: 8000, included_in_package: false, payer: "client" },
        { name: "SSL", billing: "recurring", period: "annual", selling_price: 500, included_in_package: true, payer: "agency" },
        { name: "SMS", billing: "recurring", period: "monthly", selling_price: null, included_in_package: false, payer: "agency" },
      ],
      maintenance: { name: "Standard", billing: "monthly", monthly_price: 1000 } });
    expect(r.total).toBe(4999);
    expect(r.recurringMonthly).toBe(1800);
    expect(r.recurringAnnual).toBe(3000);
    expect(r.hasTbc).toBe(true);
  });

  it("milestones must add up; percentage rounding goes to the last milestone and is reported", () => {
    const r = calc({ pkgs: [{ ...pkg, price: 1000.01, items: [{ name: "x", amount: 1000.01 }] }],
      milestones: [{ label: "A", mode: "percent", value: 33.33 }, { label: "B", mode: "percent", value: 33.33 }, { label: "C", mode: "percent", value: 33.34 }] });
    expect(r.milestones.reduce((s, m) => s + m.amount, 0)).toBeCloseTo(1000.01, 2);
    expect(r.milestoneDiff).toBe(0);
    const bad = calc({ pkgs: [pkg], milestones: [{ label: "A", mode: "amount", value: 2000 }, { label: "B", mode: "percent", value: 50 }] });
    expect(bad.errors.join(" ")).toMatch(/add up/);
    const mixed = calc({ pkgs: [pkg], milestones: [{ label: "A", mode: "amount", value: 1999 }, { label: "B", mode: "amount", value: 3000 }] });
    expect(mixed.errors).toHaveLength(0);
    expect(mixed.initialPayable).toBe(1999);
  });

  it("Website + App: both packages are charged once and their breakdowns are inclusions", () => {
    const app = { id: "a", kind: "app" as const, name: "App", price: 55000, scope_limits: {}, items: [{ name: "x", amount: 55000 }] };
    const r = calc({ pkgs: [pkg, app] });
    expect(r.total).toBe(59999);
    expect(r.lines.filter((l) => l.section === "base")).toHaveLength(2);
    expect(r.lines.filter((l) => l.section === "inclusion").every((l) => !l.charged)).toBe(true);
  });

  it("warns when an app's requested scope exceeds the package", () => {
    const app = { id: "a", kind: "app" as const, name: "App", price: 55000, scope_limits: { screens: 10, integrations: 1, roles: 2, backend: "simple" }, items: [{ name: "x", amount: 55000 }] };
    const r = calc({ pkgs: [app], scope: { screens: 18, integrations: 3, backend: "complex", platforms: ["android", "ios"] } });
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
    expect(r.warnings.join(" ")).toMatch(/18 screens/);
  });
});

describe("proposal lifecycle", () => {
  let client: Actor, clientId: string, proposalId: string, v1: string;

  beforeAll(async () => {
    ({ client, clientId } = await makeClientWithProject(admin, "Prop"));
  });

  it("server recalculates totals from trusted data and ignores totals sent by the browser", async () => {
    const r = await P.saveProposal(admin, null, { ...baseInput(clientId), total: 1, subtotal: 1, package_price: 1 } as never);
    proposalId = r.proposalId; v1 = r.versionId;
    const [v] = await rawSystem((tx) => tx`select total, base_amount, status from proposal_versions where id = ${v1}`);
    expect(Number(v.total)).toBe(4999);
    expect(Number(v.base_amount)).toBe(4999);
    expect(v.status).toBe("draft");
    expect(r.number).toMatch(/^IWA-P-\d{4}-\d{4}$/);
  });

  it("uses the configured discount rule values, not values posted by the browser", async () => {
    const rule = await Pricing.saveCatalogItem(admin, "discount", null, { name: "Launch 10%", type: "percent", value: 10, max_amount: 300, is_active: true });
    await P.saveProposal(admin, proposalId, baseInput(clientId, {
      pricing: { mode: "package", package_ids: [websitePkg.id], addons: [{ name: "Additional page", unit: "per_page", quantity: 2, unit_price: 1000, range_min: 500, range_max: 1500 }], custom: [] },
      discount: { rule_id: rule, type: "percent", value: 90, max_amount: null },
    }));
    const [v] = await rawSystem((tx) => tx`select subtotal, discount_amount, total from proposal_versions where id = ${v1}`);
    expect(Number(v.subtotal)).toBe(6999);
    expect(Number(v.discount_amount)).toBe(300); // 10% capped at 300, not 90%
    expect(Number(v.total)).toBe(6699);
  });

  it("drafts and internal data are invisible to the client", async () => {
    expect(await P.listClientProposals(client)).toHaveLength(0);
    await expect(P.getProposal(client, proposalId)).rejects.toThrow(/not found/i);
    const leaked = await rawAs(client, async (tx) => ({
      internal: (await tx`select * from proposal_version_internal`).length,
      events: (await tx`select * from proposal_events`).length,
      catalog: (await tx`select * from pricing_packages`).length,
      tax: (await tx`select * from app_settings where key = 'tax'`).length,
    }));
    expect(leaked).toEqual({ internal: 0, events: 0, catalog: 0, tax: 0 });
  });

  it("cannot be sent while milestones do not add up", async () => {
    await P.saveProposal(admin, proposalId, baseInput(clientId, { milestones: [{ label: "Advance", mode: "amount", value: 1000, due: null }] }));
    await expect(P.sendProposal(admin, proposalId)).rejects.toThrow(/add up/);
    await P.saveProposal(admin, proposalId, baseInput(clientId));
  });

  it("send publishes to the portal; the client views it and the view is tracked", async () => {
    await P.markReady(admin, proposalId);
    const r = await P.sendProposal(admin, proposalId);
    expect(r.portalUsers).toBe(1);
    expect(r.email).toBeNull();
    const list = await P.listClientProposals(client);
    expect(list.map((p) => p.status)).toEqual(["sent"]);
    const view = await P.getProposal(client, proposalId);
    expect(view.admin).toBeNull();
    await P.recordProposalView(client, view.version.id);
    expect((await P.getProposal(admin, proposalId)).version.status).toBe("viewed");
  });

  it("a failed email is reported as failed and never as sent", async () => {
    const r2 = await P.saveProposal(admin, null, baseInput(clientId, { title: "Email failure test" }));
    process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = "1"; process.env.SMTP_FROM = "test@example.test";
    const res = await P.sendProposal(admin, r2.proposalId, { sendEmail: true });
    expect(res.email?.status).toBe("failed");
    const [v] = await rawSystem((tx) => tx`select status, email_status from proposal_versions where id = ${r2.versionId}`);
    expect(v).toEqual({ status: "sent", email_status: "failed" });
    await P.cancelProposal(admin, r2.proposalId);
    expect((await P.getProposal(admin, r2.proposalId)).version.status).toBe("cancelled");
  });

  it("another client cannot see or respond to this proposal", async () => {
    const other = await makeClientWithProject(admin, "Rival");
    await expect(P.getProposal(other.client, proposalId)).rejects.toThrow(/not found/i);
    expect(await P.listClientProposals(other.client)).toHaveLength(0);
    const { version, hash } = await P.getProposal(admin, proposalId);
    await expect(P.acceptProposal(other.client, version.id, { signer_name: "Rival", confirm_scope: true, confirm_amount: true, confirm_recurring: true, content_hash: hash })).rejects.toThrow(/not found/i);
    await expect(P.addProposalComment(other.client, proposalId, { body: "hi" })).rejects.toThrow(/not found/i);
    const raw = await rawAs(other.client, (tx) => tx`select id from proposal_versions where proposal_id = ${proposalId}`);
    expect(raw).toHaveLength(0);
  });

  it("PDF and online view show the same prices", async () => {
    const r = await P.getProposal(client, proposalId);
    const bytes = await proposalPdf({ number: r.proposal.number, title: r.proposal.title, client: r.client }, r.version as never, r.items as never, null);
    const text = pdfText(Buffer.from(bytes));
    for (const amount of [r.version.total, r.version.subtotal, ...r.version.milestones.map((m) => m.amount)]) {
      expect(text).toContain(formatMoneyPlain(Number(amount)));
    }
    expect(text).toContain(r.proposal.number);
  });

  it("client questions reach the admin; acceptance requires every confirmation and the exact content", async () => {
    await P.addProposalComment(client, proposalId, { body: "Is hosting included?", kind: "question" });
    const { version, hash } = await P.getProposal(client, proposalId);
    await expect(P.acceptProposal(client, version.id, { signer_name: "Priya", confirm_scope: true, confirm_amount: true, confirm_recurring: false, content_hash: hash })).rejects.toThrow(/recurring/);
    await expect(P.acceptProposal(client, version.id, { signer_name: "Priya", confirm_scope: true, confirm_amount: true, confirm_recurring: true, content_hash: "0".repeat(64) })).rejects.toThrow(/changed/);
    await expect(P.acceptProposal(admin, version.id, { signer_name: "Admin", confirm_scope: true, confirm_amount: true, confirm_recurring: true, content_hash: hash })).rejects.toThrow(/Only the client/);
    await P.acceptProposal(client, version.id, { signer_name: "Priya Sharma", confirm_scope: true, confirm_amount: true, confirm_recurring: true, content_hash: hash }, { ip: "203.0.113.9" });
    const after = await P.getProposal(admin, proposalId);
    expect(after.version.status).toBe("accepted");
    expect(after.acceptance?.signer_name).toBe("Priya Sharma");
    const [acc] = await rawSystem((tx) => tx`select user_id, version_no, total, terms_snapshot from proposal_acceptances where version_id = ${version.id}`);
    expect(acc.user_id).toBe(client.userId);
    expect(acc.version_no).toBe(1);
    expect(Number(acc.total)).toBe(4999);
    expect(acc.terms_snapshot.items.length).toBeGreaterThan(0);
  });

  it("accepted versions are immutable; changes create a new version that needs fresh approval", async () => {
    await expect(P.saveProposal(admin, proposalId, baseInput(clientId))).rejects.toThrow(/locked/);
    await expect(rawSystem((tx) => tx`update proposal_versions set total = 1 where id = ${v1}`)).rejects.toThrow(/immutable/);
    await expect(rawSystem((tx) => tx`delete from proposal_items where version_id = ${v1}`)).rejects.toThrow();
    await expect(rawSystem((tx) => tx`delete from proposal_acceptances where version_id = ${v1}`)).rejects.toThrow(/append-only/);
    const v2 = await P.reviseProposal(admin, proposalId);
    await P.saveProposal(admin, proposalId, baseInput(clientId, { title: "Cafe website v2" }));
    const r = await P.getProposal(admin, proposalId, v1);
    expect(r.version.status).toBe("accepted");
    expect(Number(r.version.total)).toBe(4999);
    expect((await P.getProposal(admin, proposalId)).version.id).toBe(v2);
    // The new draft is invisible to the client until it is sent.
    expect((await P.getProposal(client, proposalId)).versions.map((v) => v.version_no)).toEqual([1]);
  });

  it("accepting does not create payments; linking a project makes the proposal the billing baseline", async () => {
    const projectId = await P.connectProject(admin, proposalId, {});
    const billing = await B.getBilling(admin, projectId);
    expect(billing.contractTotal).toBe(4999);
    expect(billing.paidTotal).toBe(0);
    expect(billing.payments).toHaveLength(0);
    expect(billing.terms.map((t) => t.amount)).toEqual([2499.5, 2499.5]);
    const inv = await B.createInvoiceFromTerm(admin, projectId, 0);
    await B.issueInvoice(admin, inv);
    expect((await B.getBilling(admin, projectId)).invoices[0].status).toBe("issued");
    await C.commenceProject(admin, projectId, {});
  });
});

describe("proposal statuses", () => {
  it("shows rejected, changes requested and expired correctly", async () => {
    const { client, clientId } = await makeClientWithProject(admin, "Stat");
    const a = await P.saveProposal(admin, null, baseInput(clientId));
    await P.sendProposal(admin, a.proposalId);
    await P.requestProposalChanges(client, a.versionId, { note: "Add online ordering" });
    expect((await P.getProposal(client, a.proposalId)).version.status).toBe("changes_requested");
    await P.rejectProposal(client, a.versionId, { reason: "Budget" });
    expect((await P.getProposal(client, a.proposalId)).version.status).toBe("rejected");
    await expect(P.rejectProposal(client, a.versionId, {})).rejects.toThrow(/no longer open/);

    const b = await P.saveProposal(admin, null, baseInput(clientId, { title: "Expiring" }));
    await P.sendProposal(admin, b.proposalId);
    await rawSystem(async (tx) => {
      await tx`select set_config('app.purge', 'on', true)`;
      await tx`update proposal_versions set valid_until = current_date - 1 where id = ${b.versionId}`;
    });
    expect((await P.listClientProposals(client)).find((p) => p.id === b.proposalId)?.status).toBe("expired");
    const { hash } = await P.getProposal(client, b.proposalId);
    await expect(P.acceptProposal(client, b.versionId, { signer_name: "Stat", confirm_scope: true, confirm_amount: true, confirm_recurring: true, content_hash: hash })).rejects.toThrow(/expired/);
    const list = await P.listProposals(admin, { client: clientId });
    expect(list.rows.map((r) => r.status).sort()).toEqual(["expired", "rejected"]);
    expect(list.stats.total).toBeGreaterThanOrEqual(2);
  });

  it("dashboard search, filters and pagination work", async () => {
    const r = await P.listProposals(admin, { search: "Expiring", pageSize: 1 });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].title).toBe("Expiring");
    const accepted = await P.listProposals(admin, { status: "accepted" });
    expect(accepted.rows.every((x) => x.status === "accepted")).toBe(true);
    expect(accepted.stats.accepted_value).toBeGreaterThanOrEqual(4999);
  });

  it("creates a new client from the wizard and the app package totals ₹55,000", async () => {
    const email = `${uniq("new")}@example.test`;
    const r = await P.saveProposal(admin, null, baseInput("00000000-0000-0000-0000-000000000000", {
      client: { mode: "new", business_name: "Spice Route", owner_name: "Arjun", email, phone: null, business_category: "Restaurant" },
      contact: { name: "Arjun", email, phone: null }, project_type: "cross_platform_app",
      pricing: { mode: "package", package_ids: [appPkg.id], addons: [], custom: [] }, scope_details: { platforms: ["android", "ios"], screens: 12 },
    }));
    expect(r.computed.total).toBe(55000);
    expect(r.computed.warnings.join(" ")).toMatch(/12 screens/);
    const [c] = await rawSystem((tx) => tx`select business_name from client_profiles where email = ${email}`);
    expect(c.business_name).toBe("Spice Route");
  });
});

/** Extract text drawn with standard fonts (hex strings inside Flate-compressed content streams). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    try {
      const data = inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
      for (const h of data.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(h[1], "hex").toString("latin1"));
    } catch { /* not a compressed content stream */ }
  }
  return out.join("\n");
}
