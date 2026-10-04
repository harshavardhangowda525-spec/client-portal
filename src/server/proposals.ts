import { z } from "zod";
import { withDb, SYSTEM, assertAdmin, audit, asSystem, nextNumber, type Actor, type Tx } from "./core";
import { parse, text, optText, optDate, date, uuid, email as emailSchema } from "./validate";
import { notifyAdmins, notifyClientUsers } from "./notify";
import { getProposalDefaults, getTaxConfig, getBusiness, type PackageRow } from "./pricing";
import { createProject } from "./clients";
import { sendEmail, escapeHtml, whatsappShareLink, type DeliveryResult } from "./delivery";
import { AppError, notFound } from "@/lib/errors";
import { computeProposal, type Computed, type PackageSnapshot, type PricingInput } from "@/lib/proposal-calc";
import { sha256, stableStringify } from "@/lib/crypto";
import { todayISO } from "@/lib/progress";
import { appUrl } from "@/lib/config";
import { formatMoney } from "@/lib/money";

// ---------------------------------------------------------------------------
// Types & validation
// ---------------------------------------------------------------------------
export const PROJECT_TYPES = ["website", "android_app", "ios_app", "cross_platform_app", "website_app", "custom_software"] as const;
export const PROPOSAL_STATUSES = ["draft", "ready", "sent", "viewed", "changes_requested", "accepted", "rejected", "expired", "cancelled", "superseded"] as const;

const optUuid = z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable());
const optNum = z.union([z.literal(""), z.null(), z.coerce.number()]).optional().transform((v) => (v === "" || v == null ? null : Number(v)));
const optPrice = optNum.pipe(z.number().min(0).max(999_999_999).nullable());
const qty = z.coerce.number().positive("must be more than zero").max(100000);
const list = (max: number) => z.array(z.string()).max(200).transform((a) => a.map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, max)));

const inputSchema = z.object({
  client: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), client_id: uuid }),
    z.object({ mode: z.literal("new"), business_name: text(200), owner_name: text(200), email: emailSchema, phone: optText(40), business_category: optText(100) }),
  ]),
  contact: z.object({ name: text(200), email: emailSchema, phone: optText(40) }),
  business_category: optText(100),
  title: text(200),
  project_type: z.enum(PROJECT_TYPES),
  description: optText(10000),
  requirements: optText(10000),
  target_launch_date: optDate,
  assigned_to: optUuid,
  internal_notes: optText(10000),
  executive_summary: optText(10000),
  recommended_solution: optText(10000),
  pricing: z.object({
    mode: z.enum(["package", "itemized"]),
    package_ids: z.array(uuid).max(2).default([]).refine((a) => new Set(a).size === a.length, "Select each package only once"),
    addons: z.array(z.object({
      service_id: optUuid, name: text(300), description: optText(2000), unit: optText(40), quantity: qty, unit_price: optPrice,
      range_min: optPrice, range_max: optPrice, open_ended: z.boolean().optional().default(false),
    })).max(100),
    custom: z.array(z.object({ name: text(300), description: optText(2000), quantity: qty, unit_price: optPrice })).max(100),
  }),
  scope_details: z.object({
    platforms: z.array(z.enum(["android", "ios", "web"])).max(3).default([]),
    pages: optNum, screens: optNum, integrations: optNum, roles: optNum,
    backend: z.union([z.enum(["simple", "moderate", "complex"]), z.literal(""), z.null()]).optional().transform((v) => v || null),
    authentication: optText(500), storage: optText(500), notes: optText(5000),
  }).default({ platforms: [] } as never),
  externals: z.array(z.object({
    catalog_id: optUuid, name: text(200), category: optText(40), billing: z.enum(["one_time", "recurring"]),
    period: z.union([z.enum(["monthly", "annual"]), z.literal(""), z.null()]).optional().transform((v) => v || null),
    provider_cost: optPrice, selling_price: optPrice, included_in_package: z.boolean(), payer: z.enum(["agency", "client"]), renewal_date: optDate,
  })).max(50),
  maintenance: z.object({
    plan_id: optUuid, name: text(100), kind: optText(20), billing: z.enum(["monthly", "annual"]), monthly_price: z.coerce.number().min(0).max(999_999_999),
    annual_price: optPrice, included_hours: optText(500), bug_fix_coverage: optText(500), update_frequency: optText(500),
    backup_monitoring: optText(500), support_channel: optText(500), response_time: optText(200), exclusions: optText(1000),
  }).nullable(),
  warranty: z.object({ days: z.coerce.number().int().min(0).max(3650), terms: optText(5000) }),
  scope: z.object({
    objectives: optText(5000), features: list(500), pages_screens: list(300), design_requirements: optText(5000), deliverables: list(500),
    client_responsibilities: list(500), content_requirements: optText(5000), revisions: z.coerce.number().int().min(0).max(50),
    milestones: z.array(z.object({ title: text(200), estimate: optText(200) })).max(30), timeline: optText(2000),
    acceptance_criteria: optText(5000), exclusions: list(500), assumptions: list(500),
  }),
  discount: z.object({
    rule_id: optUuid, type: z.enum(["none", "percent", "amount"]), value: z.coerce.number().min(0).max(999_999_999),
    max_amount: optPrice, name: optText(100),
  }),
  milestones: z.array(z.object({ label: text(100), mode: z.enum(["percent", "amount"]), value: z.coerce.number().min(0).max(999_999_999), due: optText(200) })).max(12),
  valid_until: date,
  terms: optText(20000),
});
export type ProposalInput = z.input<typeof inputSchema>;
type ParsedInput = z.output<typeof inputSchema>;

export type ProposalVersion = {
  id: string; proposal_id: string; client_id: string; version_no: number; status: string; currency: string;
  content: Omit<ParsedInput, "client" | "internal_notes"> & { externals: Omit<ParsedInput["externals"][number], "provider_cost">[] };
  pricing_mode: "package" | "itemized"; package_snapshot: PackageSnapshot[] | null;
  base_amount: number; addons_amount: number; custom_amount: number; external_amount: number; subtotal: number;
  discount_type: string; discount_value: number; discount_amount: number; discount_percent: number; taxable_amount: number;
  tax_label: string; tax_rate: number; tax_amount: number; total: number; recurring_monthly: number; recurring_annual: number;
  initial_payable: number; has_tbc_items: boolean; milestones: { label: string; mode: string; value: number; due: string | null; amount: number }[];
  valid_until: string; sent_at: Date | null; email_status: string | null; first_viewed_at: Date | null; view_count: number;
  responded_at: Date | null; client_response_note: string | null; accepted_at: Date | null; created_at: Date; updated_at: Date;
};
export type ProposalItem = {
  id: string; position: number; section: string; name: string; description: string | null; quantity: number; unit: string | null;
  unit_price: number | null; amount: number | null; billing: "one_time" | "recurring"; period: "monthly" | "annual" | null; charged: boolean;
  included_in_package: boolean; payer: "agency" | "client" | null; renewal_date: string | null; range_min: number | null; range_max: number | null;
  details: Record<string, unknown>;
};

export function effectiveProposalStatus(v: { status: string; valid_until: string }, today = todayISO()) {
  return (v.status === "sent" || v.status === "viewed") && v.valid_until < today ? "expired" : v.status;
}

export function proposalHash(number: string, v: Pick<ProposalVersion, "version_no" | "content" | "subtotal" | "discount_amount" | "tax_amount" | "total" | "recurring_monthly" | "recurring_annual" | "milestones" | "valid_until" | "currency">, items: Pick<ProposalItem, "section" | "name" | "quantity" | "unit_price" | "amount" | "billing" | "period" | "charged">[]) {
  return sha256(stableStringify({
    number, version: v.version_no, currency: v.currency, content: v.content, valid_until: v.valid_until,
    totals: [Number(v.subtotal), Number(v.discount_amount), Number(v.tax_amount), Number(v.total), Number(v.recurring_monthly), Number(v.recurring_annual)],
    milestones: v.milestones.map((m) => [m.label, Number(m.amount), m.due ?? null]),
    items: items.map((i) => [i.section, i.name, Number(i.quantity), i.unit_price == null ? null : Number(i.unit_price), i.amount == null ? null : Number(i.amount), i.billing, i.period, i.charged]),
  }));
}

async function logEvent(tx: Tx, actor: Actor | null, proposalId: string, versionId: string | null, type: string, data: Record<string, unknown> = {}) {
  const run = () => tx`insert into proposal_events (proposal_id, version_id, actor_id, actor_role, type, data)
    values (${proposalId}, ${versionId}, ${actor?.userId ?? null}, ${actor?.role ?? "system"}, ${type}, ${tx.json(data as never)})`;
  if (actor?.role === "client") await asSystem(tx, actor, run); else await run();
}

async function expireStale(tx: Tx) {
  await tx`update proposal_versions set status = 'expired' where status in ('sent', 'viewed') and valid_until < current_date`;
}

async function loadPackage(tx: Tx, id: string): Promise<PackageSnapshot> {
  const [p] = await tx<Omit<PackageRow, "items">[]>`select * from pricing_packages where id = ${id}`;
  if (!p) throw new AppError("The selected package no longer exists.");
  const items = await tx<{ name: string; description: string | null; amount: number }[]>`
    select name, description, amount from pricing_package_items where package_id = ${id} order by position`;
  return { id: p.id, kind: p.kind, name: p.name, price: Number(p.price), scope_limits: p.scope_limits as PackageSnapshot["scope_limits"], items: items.map((i) => ({ ...i, amount: Number(i.amount) })) };
}

/** Build the pricing input from trusted sources: package and discount rule come from the database, tax from settings. */
async function pricingFor(tx: Tx, d: ParsedInput) {
  const pkgs = d.pricing.mode === "package" ? await Promise.all(d.pricing.package_ids.map((id) => loadPackage(tx, id))) : [];
  if (new Set(pkgs.map((p) => p.kind)).size !== pkgs.length) throw new AppError("Select at most one website package and one app package.");
  let discount = { type: d.discount.type, value: d.discount.value, max_amount: d.discount.max_amount, name: d.discount.name };
  if (d.discount.rule_id) {
    const [r] = await tx<{ name: string; type: "percent" | "amount"; value: number; max_amount: number | null }[]>`
      select name, type, value, max_amount from discount_rules where id = ${d.discount.rule_id}`;
    if (!r) throw new AppError("The selected discount no longer exists.");
    discount = { type: r.type, value: Number(r.value), max_amount: r.max_amount == null ? null : Number(r.max_amount), name: r.name };
  }
  const defaults = await getProposalDefaults(tx);
  const input: PricingInput = {
    mode: d.pricing.mode, pkgs, addons: d.pricing.addons, custom: d.pricing.custom,
    externals: d.externals.map((e) => ({ ...e, period: e.billing === "recurring" ? e.period ?? "monthly" : null })),
    maintenance: d.maintenance, discount, discount_applies_to_external: defaults.discount_applies_to_external,
    tax: await getTaxConfig(tx), milestones: d.milestones,
    scope: { platforms: d.scope_details.platforms, screens: d.scope_details.screens, pages: d.scope_details.pages,
      integrations: d.scope_details.integrations, roles: d.scope_details.roles, backend: d.scope_details.backend },
  };
  return { input, pkgs, discount, computed: computeProposal(input) };
}

/** Live recalculation for the wizard panel (same engine, trusted inputs). */
export async function previewTotals(actor: Actor, raw: unknown): Promise<Computed> {
  assertAdmin(actor);
  const d = parse(inputSchema, raw);
  return withDb(actor, async (tx) => (await pricingFor(tx, d)).computed);
}

// ---------------------------------------------------------------------------
// Admin: create / edit drafts
// ---------------------------------------------------------------------------
export async function saveProposal(actor: Actor, proposalId: string | null, raw: unknown) {
  assertAdmin(actor);
  const d = parse(inputSchema, raw);
  return withDb(actor, async (tx) => {
    let clientId: string;
    if (d.client.mode === "existing") {
      const [c] = await tx`select id from client_profiles where id = ${d.client.client_id}`;
      if (!c) throw new AppError("The selected client was not found.");
      clientId = d.client.client_id;
    } else {
      const c = d.client;
      [{ id: clientId }] = await tx<{ id: string }[]>`insert into client_profiles (business_name, owner_name, email, phone, business_category)
        values (${c.business_name}, ${c.owner_name}, ${c.email}, ${c.phone}, ${c.business_category}) returning id`;
      await audit(tx, actor, "client.created", "client", clientId, null, { business_name: c.business_name, via: "proposal" });
    }
    if (d.assigned_to) {
      const [u] = await tx`select 1 from users where id = ${d.assigned_to} and role = 'admin'`;
      if (!u) throw new AppError("The assigned team member was not found.");
    }
    const { pkgs, discount, computed } = await pricingFor(tx, d);

    let pid = proposalId;
    let versionId: string;
    let number: string;
    if (!pid) {
      number = await nextNumber(tx, "P");
      [{ id: pid }] = await tx<{ id: string }[]>`insert into proposals (number, client_id, title, project_type, assigned_to, created_by)
        values (${number}, ${clientId}, ${d.title}, ${d.project_type}, ${d.assigned_to}, ${actor.userId}) returning id`;
      versionId = "";
    } else {
      const [p] = await tx<{ number: string; client_id: string; cancelled_at: Date | null }[]>`select number, client_id, cancelled_at from proposals where id = ${pid}`;
      if (!p) throw notFound("Proposal not found.");
      if (p.cancelled_at) throw new AppError("This proposal was cancelled.");
      number = p.number;
      const [latest] = await tx<{ id: string; status: string; version_no: number }[]>`
        select id, status, version_no from proposal_versions where proposal_id = ${pid} order by version_no desc limit 1`;
      if (!latest || !["draft", "ready"].includes(latest.status)) throw new AppError("This version has been sent and is locked. Create a revised version to make changes.");
      if (p.client_id !== clientId) {
        const [sent] = await tx`select 1 from proposal_versions where proposal_id = ${pid} and status not in ('draft', 'ready')`;
        if (sent) throw new AppError("The client cannot be changed after a version has been sent.");
      }
      await tx`update proposals set client_id = ${clientId}, title = ${d.title}, project_type = ${d.project_type}, assigned_to = ${d.assigned_to} where id = ${pid}`;
      versionId = latest.id;
    }

    const { client: _c, internal_notes, ...rest } = d;
    const content = { ...rest, externals: d.externals.map(({ provider_cost: _pc, ...e }) => e), discount: { ...d.discount, ...discount } };
    const providerCosts: Record<string, number> = {};
    const row = {
      client_id: clientId, status: "draft", content: tx.json(content as never), pricing_mode: d.pricing.mode,
      package_snapshot: pkgs.length ? tx.json(pkgs as never) : null,
      base_amount: computed.base, addons_amount: computed.addons, custom_amount: computed.custom, external_amount: computed.external,
      subtotal: computed.subtotal, discount_type: discount.type, discount_value: discount.value, discount_amount: computed.discountAmount,
      discount_percent: computed.discountPercent, taxable_amount: computed.taxable, tax_label: (await getTaxConfig(tx)).label, tax_rate: computed.taxRate,
      tax_amount: computed.taxAmount, total: computed.total, recurring_monthly: computed.recurringMonthly, recurring_annual: computed.recurringAnnual,
      initial_payable: computed.initialPayable, has_tbc_items: computed.hasTbc, milestones: tx.json(computed.milestones as never), valid_until: d.valid_until,
    };
    if (!versionId) {
      [{ id: versionId }] = await tx<{ id: string }[]>`insert into proposal_versions ${tx({ ...row, proposal_id: pid, version_no: 1, created_by: actor.userId } as never)} returning id`;
      await logEvent(tx, actor, pid!, versionId, "created", { number });
    } else {
      await tx`delete from proposal_items where version_id = ${versionId}`;
      await tx`update proposal_versions set ${tx(row as never)} where id = ${versionId}`;
      await logEvent(tx, actor, pid!, versionId, "saved", { total: computed.total });
    }
    let extIdx = 0;
    const items = computed.lines.map((l, i) => {
      if (l.section === "external") {
        // External lines are emitted in the same order as the input rows.
        const ext = d.externals[extIdx++];
        if (ext?.provider_cost != null) providerCosts[String(i + 1)] = ext.provider_cost;
      }
      return {
        version_id: versionId, position: i + 1, section: l.section, name: l.name, description: l.description ?? null, quantity: l.quantity,
        unit: l.unit ?? null, unit_price: l.unit_price, amount: l.amount, billing: l.billing, period: l.period, charged: l.charged,
        included_in_package: l.included_in_package, payer: l.payer, renewal_date: l.renewal_date ?? null, range_min: l.range_min ?? null,
        range_max: l.range_max ?? null, details: tx.json((l.details ?? {}) as never),
      };
    });
    if (items.length) await tx`insert into proposal_items ${tx(items as never)}`;
    await tx`insert into proposal_version_internal (version_id, internal_notes, provider_costs)
             values (${versionId}, ${internal_notes}, ${tx.json(providerCosts)})
             on conflict (version_id) do update set internal_notes = excluded.internal_notes, provider_costs = excluded.provider_costs`;
    return { proposalId: pid!, versionId, number, clientId, computed };
  });
}

async function latestVersion(tx: Tx, proposalId: string) {
  const [v] = await tx<(ProposalVersion & { number: string; title: string; cancelled_at: Date | null })[]>`
    select v.*, p.number, p.title, p.cancelled_at from proposal_versions v join proposals p on p.id = v.proposal_id
    where v.proposal_id = ${proposalId} order by v.version_no desc limit 1`;
  if (!v) throw notFound("Proposal not found.");
  return v;
}

async function sendBlockers(tx: Tx, v: ProposalVersion): Promise<string[]> {
  const raw = { ...(v.content as object), client: { mode: "existing", client_id: v.client_id }, internal_notes: null };
  const { computed } = await pricingFor(tx, parse(inputSchema, raw));
  const errs = [...computed.errors];
  if (Math.abs(computed.total - Number(v.total)) > 0.001) errs.push("Prices changed since this draft was saved. Open the wizard and save again.");
  if (v.valid_until < todayISO()) errs.push("The validity date is in the past.");
  if (Number(v.total) <= 0 && Number(v.recurring_monthly) <= 0 && Number(v.recurring_annual) <= 0) errs.push("The proposal has no charges.");
  return errs;
}

export async function markReady(actor: Actor, proposalId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const v = await latestVersion(tx, proposalId);
    if (v.status !== "draft") throw new AppError("Only drafts can be marked ready.");
    const errs = await sendBlockers(tx, v);
    if (errs.length) throw new AppError(errs[0]);
    await tx`update proposal_versions set status = 'ready' where id = ${v.id}`;
    await logEvent(tx, actor, proposalId, v.id, "ready");
  });
}

export function proposalLink(proposalId: string) {
  return `${appUrl()}/portal/proposals/${proposalId}`;
}

export function whatsappMessage(args: { contactName: string; number: string; title: string; total: number; monthly: number; annual: number; validUntil: string; link: string; businessName: string }) {
  const recurring = [args.monthly > 0 ? `${formatMoney(args.monthly)}/month` : null, args.annual > 0 ? `${formatMoney(args.annual)}/year` : null].filter(Boolean).join(" + ");
  return [
    `Hi ${args.contactName},`,
    ``,
    `Your proposal ${args.number} from ${args.businessName} for "${args.title}" is ready.`,
    `One-time total: ${formatMoney(args.total)}${recurring ? `\nRecurring (optional/ongoing): ${recurring}` : ""}`,
    `Valid until: ${new Date(`${args.validUntil}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
    ``,
    `Review it securely in your client portal: ${args.link}`,
  ].join("\n");
}

/**
 * Publish the latest version to the client's portal (status "sent") and optionally email it.
 * Email delivery is reported separately and only marked sent when the provider accepts it.
 */
export async function sendProposal(actor: Actor, proposalId: string, opts: { sendEmail?: boolean } = {}) {
  assertAdmin(actor);
  const info = await withDb(actor, async (tx) => {
    const v = await latestVersion(tx, proposalId);
    if (v.cancelled_at) throw new AppError("This proposal was cancelled.");
    if (!["draft", "ready"].includes(v.status)) throw new AppError("This version has already been sent.");
    const errs = await sendBlockers(tx, v);
    if (errs.length) throw new AppError(errs[0]);
    await tx`update proposal_versions set status = 'superseded'
             where proposal_id = ${proposalId} and id <> ${v.id} and status in ('sent', 'viewed', 'changes_requested', 'expired')`;
    await tx`update proposal_versions set status = 'sent', sent_at = now(), email_status = null where id = ${v.id}`;
    await logEvent(tx, actor, proposalId, v.id, "sent", { version: v.version_no, total: v.total });
    await audit(tx, actor, "proposal.sent", "proposal_version", v.id, null, { number: v.number, version: v.version_no, total: v.total });
    await notifyClientUsers(tx, actor, v.client_id, {
      type: "proposal_received", title: `New proposal ${v.number}${v.version_no > 1 ? ` (version ${v.version_no})` : ""}: ${v.title}`,
      link: `/portal/proposals/${proposalId}`,
    });
    const [{ users }] = await tx<{ users: number }[]>`select count(*)::int as users from users where client_id = ${v.client_id} and disabled_at is null`;
    return { v, users };
  });
  let email: DeliveryResult | null = null;
  if (opts.sendEmail) {
    const biz = await getBusiness();
    const c = info.v.content.contact;
    const link = proposalLink(proposalId);
    email = await sendEmail({
      to: c.email, purpose: "proposal_sent",
      subject: `Proposal ${info.v.number}: ${info.v.title} — ${biz.name}`,
      text: `Hi ${c.name},\n\nYour proposal ${info.v.number} for "${info.v.title}" is ready.\nOne-time total: ${formatMoney(Number(info.v.total))}\nValid until: ${info.v.valid_until}\n\nReview it securely here: ${link}\n\n${biz.name}`,
      html: `<p>Hi ${escapeHtml(c.name)},</p><p>Your proposal <strong>${escapeHtml(info.v.number)}</strong> for “${escapeHtml(info.v.title)}” is ready.</p>
             <p>One-time total: <strong>${escapeHtml(formatMoney(Number(info.v.total)))}</strong><br/>Valid until: ${escapeHtml(info.v.valid_until)}</p>
             <p><a href="${escapeHtml(link)}">Review your proposal</a></p><p>${escapeHtml(biz.name)}</p>`,
    });
    await withDb(SYSTEM, async (tx) => {
      await tx`update proposal_versions set email_status = ${email!.status} where id = ${info.v.id}`;
      await logEvent(tx, actor, proposalId, info.v.id, "email", { status: email!.status, error: email!.error ?? null });
    });
  }
  return { portalUsers: info.users, email };
}

export async function reviseProposal(actor: Actor, proposalId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const v = await latestVersion(tx, proposalId);
    if (v.cancelled_at) throw new AppError("This proposal was cancelled.");
    if (["draft", "ready"].includes(v.status)) return v.id;
    const defaults = await getProposalDefaults(tx);
    const validUntil = new Date(Date.now() + defaults.validity_days * 86400_000).toISOString().slice(0, 10);
    const content = { ...v.content, valid_until: validUntil };
    const cols = ["client_id", "currency", "pricing_mode", "base_amount", "addons_amount", "custom_amount", "external_amount", "subtotal",
      "discount_type", "discount_value", "discount_amount", "discount_percent", "taxable_amount", "tax_label", "tax_rate", "tax_amount", "total",
      "recurring_monthly", "recurring_annual", "initial_payable", "has_tbc_items"] as const;
    const row: Record<string, unknown> = Object.fromEntries(cols.map((c) => [c, (v as Record<string, unknown>)[c]]));
    const [nv] = await tx<{ id: string }[]>`insert into proposal_versions ${tx({
      ...row, proposal_id: proposalId, version_no: v.version_no + 1, status: "draft", content: tx.json(content as never),
      package_snapshot: v.package_snapshot ? tx.json(v.package_snapshot as never) : null, milestones: tx.json(v.milestones as never),
      valid_until: validUntil, created_by: actor.userId,
    } as never)} returning id`;
    await tx`insert into proposal_items (version_id, position, section, name, description, quantity, unit, unit_price, amount, billing, period, charged,
               included_in_package, payer, renewal_date, range_min, range_max, details)
             select ${nv.id}, position, section, name, description, quantity, unit, unit_price, amount, billing, period, charged,
               included_in_package, payer, renewal_date, range_min, range_max, details from proposal_items where version_id = ${v.id}`;
    await tx`insert into proposal_version_internal (version_id, internal_notes, provider_costs)
             select ${nv.id}, internal_notes, provider_costs from proposal_version_internal where version_id = ${v.id}`;
    await logEvent(tx, actor, proposalId, nv.id, "revised", { from: v.version_no, to: v.version_no + 1, previous_status: v.status });
    return nv.id;
  });
}

export async function cancelProposal(actor: Actor, proposalId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const v = await latestVersion(tx, proposalId);
    if (v.status === "accepted") throw new AppError("An accepted proposal cannot be cancelled. Create a revised version if the agreement changes.");
    if (v.cancelled_at) return;
    await tx`update proposals set cancelled_at = now() where id = ${proposalId}`;
    await tx`update proposal_versions set status = 'cancelled' where proposal_id = ${proposalId} and status in ('draft', 'ready', 'sent', 'viewed', 'changes_requested')`;
    await logEvent(tx, actor, proposalId, v.id, "cancelled");
    await audit(tx, actor, "proposal.cancelled", "proposal", proposalId, null, { number: v.number });
  });
}

/** Delete a proposal that has never been sent. */
export async function deleteDraftProposal(actor: Actor, proposalId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [sent] = await tx`select 1 from proposal_versions where proposal_id = ${proposalId} and status not in ('draft', 'ready')`;
    if (sent) throw new AppError("Only proposals that were never sent can be deleted. Cancel it instead.");
    const r = await tx`delete from proposals where id = ${proposalId} returning number`;
    if (r.count === 0) throw notFound();
    await audit(tx, actor, "proposal.deleted", "proposal", proposalId, null, { number: r[0].number });
  });
}

// ---------------------------------------------------------------------------
// Listing & dashboard
// ---------------------------------------------------------------------------
export type ProposalListRow = {
  id: string; number: string; title: string; project_type: string; created_at: Date; business_name: string; client_id: string; project_id: string | null;
  version_id: string; version_no: number; status: string; total: number; recurring_monthly: number; recurring_annual: number; discount_amount: number;
  valid_until: string; sent_at: Date | null; first_viewed_at: Date | null; accepted_at: Date | null;
};

const SORTS = {
  newest: "p.created_at desc", oldest: "p.created_at asc", total_desc: "l.total desc", total_asc: "l.total asc",
  expiry: "l.valid_until asc", number: "p.number desc",
} as const;

export async function listProposals(actor: Actor, q: { search?: string; status?: string; type?: string; client?: string; sort?: string; page?: number; pageSize?: number } = {}) {
  assertAdmin(actor);
  const pageSize = Math.min(Math.max(q.pageSize ?? 15, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const sort = SORTS[(q.sort ?? "newest") as keyof typeof SORTS] ?? SORTS.newest;
  return withDb(actor, async (tx) => {
    await expireStale(tx);
    const search = q.search?.trim() ? `%${q.search.trim().replace(/[%_]/g, "\\$&")}%` : null;
    const status = q.status && (PROPOSAL_STATUSES as readonly string[]).concat(["awaiting"]).includes(q.status) ? q.status : null;
    const type = q.type && (PROJECT_TYPES as readonly string[]).includes(q.type) ? q.type : null;
    const where = tx`
      ${search ? tx`and (p.number ilike ${search} or p.title ilike ${search} or c.business_name ilike ${search} or c.owner_name ilike ${search})` : tx``}
      ${status === "awaiting" ? tx`and l.status in ('sent', 'viewed')` : status ? tx`and l.status = ${status}` : tx``}
      ${type ? tx`and p.project_type = ${type}` : tx``}
      ${q.client ? tx`and p.client_id = ${q.client}` : tx``}`;
    const latest = tx`(select distinct on (proposal_id) * from proposal_versions order by proposal_id, version_no desc)`;
    const rows = await tx<ProposalListRow[]>`
      select p.id, p.number, p.title, p.project_type, p.created_at, p.client_id, p.project_id, c.business_name,
             l.id as version_id, l.version_no, l.status, l.total, l.recurring_monthly, l.recurring_annual, l.discount_amount,
             l.valid_until, l.sent_at, l.first_viewed_at, l.accepted_at
      from proposals p join ${latest} l on l.proposal_id = p.id join client_profiles c on c.id = p.client_id
      where true ${where}
      order by ${tx.unsafe(sort)}, p.id
      limit ${pageSize} offset ${(page - 1) * pageSize}`;
    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from proposals p join ${latest} l on l.proposal_id = p.id join client_profiles c on c.id = p.client_id where true ${where}`;
    const [stats] = await tx<Record<string, number>[]>`
      with l as ${latest},
      acc as (select distinct on (proposal_id) proposal_id, total from proposal_versions where status = 'accepted' order by proposal_id, version_no desc)
      select count(*)::int as total,
        count(*) filter (where l.status = 'draft')::int as draft,
        count(*) filter (where l.status = 'ready')::int as ready,
        count(*) filter (where l.status = 'sent')::int as sent,
        count(*) filter (where l.status = 'viewed')::int as viewed,
        count(*) filter (where l.status = 'changes_requested')::int as changes_requested,
        count(*) filter (where l.status = 'accepted')::int as accepted,
        count(*) filter (where l.status = 'rejected')::int as rejected,
        count(*) filter (where l.status = 'expired')::int as expired,
        count(*) filter (where l.status = 'cancelled')::int as cancelled,
        count(*) filter (where l.status in ('sent', 'viewed'))::int as awaiting,
        coalesce(sum(l.total) filter (where l.status not in ('draft', 'ready', 'cancelled')), 0) as proposed_value,
        coalesce((select sum(total) from acc), 0) as accepted_value,
        coalesce(sum(l.discount_amount) filter (where l.status not in ('draft', 'ready', 'cancelled')), 0) as discounts
      from l`;
    return { rows, total: n, page, pageSize, pages: Math.max(1, Math.ceil(n / pageSize)), stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Number(v)])) };
  });
}

// ---------------------------------------------------------------------------
// Detail (admin and client)
// ---------------------------------------------------------------------------
export async function getProposal(actor: Actor, proposalId: string, versionId?: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) throw notFound("Proposal not found.");
  return withDb(actor, async (tx) => {
    if (actor.role === "admin") await expireStale(tx);
    const [p] = await tx<{ id: string; number: string; title: string; project_type: string; client_id: string; project_id: string | null;
      assigned_to: string | null; cancelled_at: Date | null; created_at: Date }[]>`select * from proposals where id = ${proposalId}`;
    if (!p) throw notFound("Proposal not found.");
    if (actor.role === "client" && p.client_id !== actor.clientId) throw notFound("Proposal not found.");
    const versions = await tx<ProposalVersion[]>`select * from proposal_versions where proposal_id = ${proposalId} order by version_no desc`;
    if (versions.length === 0) throw notFound("Proposal not found.");
    for (const v of versions) v.status = effectiveProposalStatus(v);
    const selected = versions.find((v) => v.id === versionId) ?? versions[0];
    const items = await tx<ProposalItem[]>`select * from proposal_items where version_id = ${selected.id} order by position`;
    const [acceptance] = await tx<{ signer_name: string; accepted_at: Date; content_hash: string; version_no: number; ip: string | null; user_name: string; user_email: string }[]>`
      select a.signer_name, a.accepted_at, a.content_hash, a.version_no, a.ip, u.name as user_name, u.email as user_email
      from proposal_acceptances a join users u on u.id = a.user_id where a.version_id = ${selected.id}`;
    const comments = await tx<{ id: string; kind: string; body: string; created_at: Date; version_id: string | null; author_name: string | null; author_role: string | null }[]>`
      select c.id, c.kind, c.body, c.created_at, c.version_id, u.name as author_name, u.role as author_role
      from proposal_comments c left join users u on u.id = c.author_id where c.proposal_id = ${proposalId} order by c.created_at`;
    const [client] = await tx<{ id: string; business_name: string; owner_name: string; email: string; phone: string | null }[]>`
      select id, business_name, owner_name, email, phone from client_profiles where id = ${p.client_id}`;
    const base = { proposal: p, versions, version: selected, items, acceptance: acceptance ?? null, comments, client,
      hash: proposalHash(p.number, selected, items), isLatest: selected.id === versions[0].id };
    if (actor.role !== "admin") return { ...base, admin: null };
    const [internal] = await tx<{ internal_notes: string | null; provider_costs: Record<string, number> }[]>`
      select internal_notes, provider_costs from proposal_version_internal where version_id = ${selected.id}`;
    const events = await tx<{ id: number; type: string; data: Record<string, unknown>; created_at: Date; actor_name: string | null; actor_role: string | null; version_id: string | null }[]>`
      select e.id, e.type, e.data, e.created_at, u.name as actor_name, e.actor_role, e.version_id
      from proposal_events e left join users u on u.id = e.actor_id where e.proposal_id = ${proposalId} order by e.created_at desc limit 200`;
    const [{ users }] = await tx<{ users: number }[]>`select count(*)::int as users from users where client_id = ${p.client_id} and disabled_at is null`;
    const [invite] = await tx<{ id: string }[]>`select id from client_invitations where client_id = ${p.client_id} and accepted_at is null and revoked_at is null and expires_at > now() limit 1`;
    const projects = await tx<{ id: string; name: string; status: string }[]>`select id, name, status from projects where client_id = ${p.client_id} order by created_at desc`;
    const blockers = ["draft", "ready"].includes(selected.status) ? await sendBlockers(tx, selected) : [];
    return { ...base, admin: { internal: internal ?? null, events, portalUsers: users, pendingInvite: !!invite, projects, blockers } };
  });
}

/** Wizard state for editing the latest draft. */
export async function getWizardState(actor: Actor, proposalId: string) {
  assertAdmin(actor);
  const r = await getProposal(actor, proposalId);
  const v = r.versions[0];
  const ext = (v.content.externals ?? []) as ParsedInput["externals"];
  const costs = r.version.id === v.id ? r.admin?.internal?.provider_costs ?? {} : {};
  const items = r.version.id === v.id ? r.items : [];
  // Map stored provider costs (keyed by item position) back onto the external rows by order.
  const extItems = items.filter((i) => i.section === "external");
  const externals = ext.map((e, idx) => ({ ...e, provider_cost: extItems[idx] ? costs[String(extItems[idx].position)] ?? null : null }));
  return {
    proposalId, number: r.proposal.number, versionNo: v.version_no, status: v.status, locked: !["draft", "ready"].includes(v.status),
    input: { ...v.content, externals, client: { mode: "existing" as const, client_id: r.proposal.client_id }, internal_notes: r.admin?.internal?.internal_notes ?? null },
  };
}

// ---------------------------------------------------------------------------
// Client: list, view, respond
// ---------------------------------------------------------------------------
export async function listClientProposals(actor: Actor) {
  return withDb(actor, async (tx) => {
    // RLS: only this client's proposals, and never drafts.
    const rows = await tx<{ id: string; number: string; title: string; project_type: string; version_id: string; version_no: number; status: string;
      total: number; recurring_monthly: number; recurring_annual: number; valid_until: string; sent_at: Date | null; accepted_at: Date | null }[]>`
      select p.id, p.number, p.title, p.project_type, l.id as version_id, l.version_no, l.status, l.total, l.recurring_monthly, l.recurring_annual,
             l.valid_until, l.sent_at, l.accepted_at
      from proposals p join (select distinct on (proposal_id) * from proposal_versions order by proposal_id, version_no desc) l on l.proposal_id = p.id
      order by coalesce(l.sent_at, p.created_at) desc`;
    return rows.map((r) => ({ ...r, status: effectiveProposalStatus(r) }));
  });
}

export async function recordProposalView(actor: Actor, versionId: string) {
  if (actor.role !== "client") return;
  await withDb(actor, async (tx) => {
    const [v] = await tx<{ id: string; status: string; proposal_id: string }[]>`select id, status, proposal_id from proposal_versions where id = ${versionId}`;
    if (!v) return;
    await asSystem(tx, actor, () => tx`
      update proposal_versions set view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, now()),
             status = case when status = 'sent' then 'viewed' else status end
      where id = ${versionId} and accepted_at is null`);
    if (v.status === "sent") await logEvent(tx, actor, v.proposal_id, v.id, "viewed");
  });
}

async function loadForResponse(tx: Tx, actor: Actor, versionId: string) {
  if (actor.role !== "client") throw new AppError("Only the client can respond to a proposal.");
  const [v] = await tx<(ProposalVersion & { number: string; title: string; cancelled_at: Date | null; project_id: string | null })[]>`
    select v.*, p.number, p.title, p.cancelled_at, p.project_id from proposal_versions v join proposals p on p.id = v.proposal_id where v.id = ${versionId}`;
  if (!v || v.client_id !== actor.clientId) throw notFound("Proposal not found.");
  if (v.cancelled_at) throw new AppError("This proposal has been withdrawn.");
  const [newer] = await tx`select 1 from proposal_versions where proposal_id = ${v.proposal_id} and version_no > ${v.version_no}`;
  if (newer) throw new AppError("A newer version of this proposal exists. Please review the latest version.");
  if (effectiveProposalStatus(v) === "expired") {
    await asSystem(tx, actor, () => tx`update proposal_versions set status = 'expired' where id = ${versionId} and status in ('sent', 'viewed')`);
    throw new AppError("This proposal has expired. Please ask Infinity Web & Apps for an updated proposal.");
  }
  if (!["sent", "viewed", "changes_requested"].includes(v.status)) throw new AppError("This proposal is no longer open for a response.");
  return v;
}

const acceptSchema = z.object({
  signer_name: text(200, 2),
  confirm_scope: z.literal(true, { error: "Please confirm the scope and deliverables" }),
  confirm_amount: z.literal(true, { error: "Please confirm the amount and payment schedule" }),
  confirm_recurring: z.literal(true, { error: "Please confirm the recurring costs" }),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Electronic acceptance: records identity, time, version and exact terms. It is not a verified digital signature. */
export async function acceptProposal(actor: Actor, versionId: string, raw: unknown, meta: { ip?: string | null; ua?: string | null } = {}) {
  const d = parse(acceptSchema, raw);
  return withDb(actor, async (tx) => {
    const v = await loadForResponse(tx, actor, versionId);
    const items = await tx<ProposalItem[]>`select * from proposal_items where version_id = ${versionId} order by position`;
    const hash = proposalHash(v.number, v, items);
    if (hash !== d.content_hash) throw new AppError("This proposal changed while you were reviewing it. Please reload and review it again.");
    const snapshot = { number: v.number, title: v.title, version_no: v.version_no, content: v.content, items, milestones: v.milestones,
      totals: { subtotal: v.subtotal, discount: v.discount_amount, taxable: v.taxable_amount, tax_label: v.tax_label, tax_rate: v.tax_rate, tax: v.tax_amount,
        total: v.total, recurring_monthly: v.recurring_monthly, recurring_annual: v.recurring_annual }, valid_until: v.valid_until };
    await asSystem(tx, actor, async () => {
      await tx`insert into proposal_acceptances (version_id, proposal_id, client_id, user_id, version_no, signer_name, total, recurring_monthly,
                 recurring_annual, currency, content_hash, terms_snapshot, ip, user_agent)
               values (${versionId}, ${v.proposal_id}, ${v.client_id}, ${actor.userId}, ${v.version_no}, ${d.signer_name}, ${v.total}, ${v.recurring_monthly},
                 ${v.recurring_annual}, ${v.currency}, ${hash}, ${tx.json(snapshot as never)}, ${meta.ip ?? null}, ${meta.ua?.slice(0, 300) ?? null})`;
      await tx`update proposal_versions set status = 'accepted', accepted_at = now(), responded_at = now(), responded_by = ${actor.userId} where id = ${versionId}`;
      if (v.project_id) {
        await tx`update projects set status = 'quotation_accepted', current_stage = 'Proposal accepted — awaiting project commencement'
                 where id = ${v.project_id} and status in ('proposal', 'on_hold')`;
      }
    });
    await logEvent(tx, actor, v.proposal_id, versionId, "accepted", { signer: d.signer_name, total: v.total });
    await audit(tx, actor, "proposal.accepted", "proposal_version", versionId, v.project_id,
      { number: v.number, version: v.version_no, total: v.total, recurring_monthly: v.recurring_monthly, recurring_annual: v.recurring_annual, hash }, meta.ip);
    await notifyAdmins(tx, actor, { type: "proposal_accepted", link: `/admin/proposals/${v.proposal_id}`, title: `${actor.name} accepted proposal ${v.number} (v${v.version_no})` });
    return { hash };
  });
}

export async function requestProposalChanges(actor: Actor, versionId: string, raw: unknown) {
  const d = parse(z.object({ note: text(5000) }), raw);
  return withDb(actor, async (tx) => {
    const v = await loadForResponse(tx, actor, versionId);
    await asSystem(tx, actor, async () => {
      await tx`update proposal_versions set status = 'changes_requested', client_response_note = ${d.note}, responded_at = now(), responded_by = ${actor.userId} where id = ${versionId}`;
      await tx`insert into proposal_comments (proposal_id, version_id, client_id, author_id, kind, body) values (${v.proposal_id}, ${versionId}, ${v.client_id}, ${actor.userId}, 'change_request', ${d.note})`;
    });
    await logEvent(tx, actor, v.proposal_id, versionId, "changes_requested");
    await notifyAdmins(tx, actor, { type: "proposal_changes", link: `/admin/proposals/${v.proposal_id}`, title: `${actor.name} requested changes to ${v.number}`, body: d.note });
  });
}

export async function rejectProposal(actor: Actor, versionId: string, raw: unknown) {
  const d = parse(z.object({ reason: optText(5000) }), raw);
  return withDb(actor, async (tx) => {
    const v = await loadForResponse(tx, actor, versionId);
    await asSystem(tx, actor, async () => {
      await tx`update proposal_versions set status = 'rejected', client_response_note = ${d.reason}, responded_at = now(), responded_by = ${actor.userId} where id = ${versionId}`;
      if (d.reason) await tx`insert into proposal_comments (proposal_id, version_id, client_id, author_id, kind, body) values (${v.proposal_id}, ${versionId}, ${v.client_id}, ${actor.userId}, 'rejection', ${d.reason})`;
    });
    await logEvent(tx, actor, v.proposal_id, versionId, "rejected");
    await audit(tx, actor, "proposal.rejected", "proposal_version", versionId, v.project_id, { number: v.number, reason: d.reason });
    await notifyAdmins(tx, actor, { type: "proposal_rejected", link: `/admin/proposals/${v.proposal_id}`, title: `${actor.name} declined proposal ${v.number}`, body: d.reason });
  });
}

export async function addProposalComment(actor: Actor, proposalId: string, raw: unknown) {
  const d = parse(z.object({ body: text(10000), kind: z.enum(["comment", "question"]).default("comment") }), raw);
  return withDb(actor, async (tx) => {
    const [p] = await tx<{ id: string; client_id: string; number: string }[]>`select id, client_id, number from proposals where id = ${proposalId}`;
    if (!p || (actor.role === "client" && p.client_id !== actor.clientId)) throw notFound("Proposal not found.");
    const [v] = await tx<{ id: string }[]>`select id from proposal_versions where proposal_id = ${proposalId} order by version_no desc limit 1`;
    await tx`insert into proposal_comments (proposal_id, version_id, client_id, author_id, kind, body)
             values (${proposalId}, ${v?.id ?? null}, ${p.client_id}, ${actor.userId}, ${d.kind}, ${d.body})`;
    await logEvent(tx, actor, proposalId, v?.id ?? null, "comment", { kind: d.kind });
    const snippet = d.body.length > 140 ? `${d.body.slice(0, 140)}…` : d.body;
    if (actor.role === "client") {
      await notifyAdmins(tx, actor, { type: "proposal_comment", link: `/admin/proposals/${proposalId}`, title: `${actor.name} ${d.kind === "question" ? "asked a question about" : "commented on"} ${p.number}`, body: snippet });
    } else {
      await notifyClientUsers(tx, actor, p.client_id, { type: "proposal_comment", link: `/portal/proposals/${proposalId}`, title: `New reply on proposal ${p.number}`, body: snippet });
    }
  });
}

// ---------------------------------------------------------------------------
// After acceptance: connect to a project (nothing is marked paid)
// ---------------------------------------------------------------------------
const TYPE_MAP: Record<string, { project_type: string; plan: "website" | "app" }> = {
  website: { project_type: "website", plan: "website" },
  android_app: { project_type: "mobile_app", plan: "app" },
  ios_app: { project_type: "mobile_app", plan: "app" },
  cross_platform_app: { project_type: "mobile_app", plan: "app" },
  website_app: { project_type: "web_app", plan: "app" },
  custom_software: { project_type: "web_app", plan: "app" },
};

export async function connectProject(actor: Actor, proposalId: string, opts: { projectId?: string | null }) {
  assertAdmin(actor);
  const p = await withDb(actor, async (tx) => {
    const [p] = await tx<{ id: string; client_id: string; title: string; project_type: string; project_id: string | null; number: string }[]>`
      select * from proposals where id = ${proposalId}`;
    if (!p) throw notFound("Proposal not found.");
    if (p.project_id) throw new AppError("This proposal is already linked to a project.");
    const [acc] = await tx<{ id: string; content: ProposalVersion["content"] }[]>`
      select id, content from proposal_versions where proposal_id = ${proposalId} and status = 'accepted' order by version_no desc limit 1`;
    if (!acc) throw new AppError("The client has not accepted this proposal yet.");
    if (opts.projectId) {
      const [proj] = await tx`select 1 from projects where id = ${opts.projectId} and client_id = ${p.client_id}`;
      if (!proj) throw new AppError("That project does not belong to this client.");
    }
    return { ...p, accepted: acc };
  });
  let projectId = opts.projectId ?? null;
  if (!projectId) {
    const map = TYPE_MAP[p.project_type] ?? TYPE_MAP.custom_software;
    projectId = await createProject(actor, p.client_id, {
      name: p.title, project_type: map.project_type, description: p.accepted.content.description ?? null,
      target_delivery_date: p.accepted.content.target_launch_date ?? null, project_manager_id: p.accepted.content.assigned_to ?? actor.userId,
    }, { defaultMilestones: true, milestonePlan: map.plan });
  }
  await withDb(actor, async (tx) => {
    await tx`update proposals set project_id = ${projectId} where id = ${proposalId}`;
    await tx`update projects set status = 'quotation_accepted', current_stage = 'Proposal accepted — awaiting project commencement'
             where id = ${projectId} and status in ('proposal', 'on_hold')`;
    await logEvent(tx, actor, proposalId, p.accepted.id, "project_linked", { project_id: projectId, created: !opts.projectId });
    await audit(tx, actor, "proposal.project_linked", "proposal", proposalId, projectId, { number: p.number });
  });
  return projectId;
}

/** The accepted proposal for a project, used by billing as the commercial baseline. */
export async function acceptedProposalForProject(tx: Tx, projectId: string) {
  const [v] = await tx<(ProposalVersion & { number: string })[]>`
    select v.*, p.number from proposal_versions v join proposals p on p.id = v.proposal_id
    where p.project_id = ${projectId} and v.status = 'accepted' order by v.accepted_at desc limit 1`;
  return v ?? null;
}

export async function proposalShareInfo(actor: Actor, proposalId: string) {
  assertAdmin(actor);
  const r = await getProposal(actor, proposalId);
  const biz = await getBusiness();
  const v = r.versions.find((x) => !["draft", "ready"].includes(x.status)) ?? r.versions[0];
  const link = proposalLink(proposalId);
  const text = whatsappMessage({ contactName: v.content.contact.name, number: r.proposal.number, title: r.proposal.title, total: Number(v.total),
    monthly: Number(v.recurring_monthly), annual: Number(v.recurring_annual), validUntil: v.valid_until, link, businessName: biz.name });
  return { link, text, whatsapp: whatsappShareLink(v.content.contact.phone ?? r.client.phone, text), portalUsers: r.admin!.portalUsers, pendingInvite: r.admin!.pendingInvite };
}
