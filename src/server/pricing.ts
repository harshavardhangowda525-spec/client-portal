import { z } from "zod";
import { withDb, SYSTEM, assertAdmin, audit, type Actor, type Tx } from "./core";
import { parse, text, optText } from "./validate";
import { AppError, notFound } from "@/lib/errors";
import { company } from "@/lib/config";
import { toPaise } from "@/lib/money";
import type { TaxConfig } from "@/lib/proposal-calc";

// ---------------------------------------------------------------------------
// Settings (business details, tax, proposal defaults)
// ---------------------------------------------------------------------------
export type Business = { name: string; tagline: string; email: string; phone: string; address: string; tax_id: string; website: string; hasLogo: boolean };
export type ProposalDefaults = {
  validity_days: number; revisions: number; warranty_days: number; warranty_terms: string; terms: string; discount_applies_to_external: boolean;
};

const businessSchema = z.object({
  name: text(200), tagline: optText(200), email: optText(320), phone: optText(60), address: optText(500), tax_id: optText(60), website: optText(300),
});
const taxSchema = z.object({
  enabled: z.coerce.boolean(), label: text(40), rate: z.coerce.number().min(0).max(100), apply_to_external: z.coerce.boolean(),
});
const defaultsSchema = z.object({
  validity_days: z.coerce.number().int().min(1).max(365), revisions: z.coerce.number().int().min(0).max(50),
  warranty_days: z.coerce.number().int().min(0).max(3650), warranty_terms: optText(5000), terms: optText(20000),
  discount_applies_to_external: z.coerce.boolean(),
});
const SCHEMAS = { business: businessSchema, tax: taxSchema, proposal_defaults: defaultsSchema } as const;

async function readSetting<T>(tx: Tx, key: string): Promise<T | null> {
  const [r] = await tx<{ value: T }[]>`select value from app_settings where key = ${key}`;
  return r?.value ?? null;
}

/** Business details shown on proposals, quotations and invoices. Database values override env defaults. */
export async function getBusiness(): Promise<Business> {
  return withDb(SYSTEM, async (tx) => {
    const b = (await readSetting<Partial<Business>>(tx, "business")) ?? {};
    const [logo] = await tx`select 1 from app_assets where key = 'logo'`;
    const env = company();
    return {
      name: b.name || env.name, tagline: b.tagline || "Websites. Mobile Apps. Digital Growth.", email: b.email || env.email,
      phone: b.phone || env.phone, address: b.address || env.address, tax_id: b.tax_id || env.taxId, website: b.website || "", hasLogo: !!logo,
    };
  });
}

export async function getTaxConfig(tx?: Tx): Promise<TaxConfig> {
  const run = async (t: Tx) => (await readSetting<TaxConfig>(t, "tax")) ?? { enabled: false, label: "GST", rate: 18, apply_to_external: false };
  return tx ? run(tx) : withDb(SYSTEM, run);
}

export async function getProposalDefaults(tx?: Tx): Promise<ProposalDefaults> {
  const run = async (t: Tx) => ({
    validity_days: 15, revisions: 2, warranty_days: 30, warranty_terms: "", terms: "", discount_applies_to_external: false,
    ...((await readSetting<ProposalDefaults>(t, "proposal_defaults")) ?? {}),
  });
  return tx ? run(tx) : withDb(SYSTEM, run);
}

export async function saveSetting(actor: Actor, key: keyof typeof SCHEMAS, input: unknown) {
  assertAdmin(actor);
  const value = parse(SCHEMAS[key], input);
  return withDb(actor, async (tx) => {
    await tx`insert into app_settings (key, value) values (${key}, ${tx.json(value as never)})
             on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await audit(tx, actor, "settings.updated", "settings", key, null, { key });
  });
}

export async function getLogo() {
  return withDb(SYSTEM, async (tx) => {
    const [l] = await tx<{ mime_type: string; data: Buffer; updated_at: Date }[]>`select mime_type, data, updated_at from app_assets where key = 'logo'`;
    return l ?? null;
  });
}

export async function saveLogo(actor: Actor, file: { type: string; data: Buffer } | null) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    if (!file) { await tx`delete from app_assets where key = 'logo'`; return; }
    if (!["image/png", "image/jpeg"].includes(file.type)) throw new AppError("The logo must be a PNG or JPEG image.");
    if (file.data.length > 1024 * 1024) throw new AppError("The logo must be 1 MB or smaller.");
    await tx`insert into app_assets (key, mime_type, data) values ('logo', ${file.type}, ${file.data})
             on conflict (key) do update set mime_type = excluded.mime_type, data = excluded.data, updated_at = now()`;
    await audit(tx, actor, "settings.logo_updated", "settings", "logo", null);
  });
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
export type PackageRow = { id: string; kind: "website" | "app"; name: string; description: string | null; price: number;
  scope_limits: Record<string, number | string>; is_active: boolean; items: { id: string; name: string; description: string | null; amount: number }[] };
export type ServiceRow = { id: string; category: string; name: string; description: string | null; unit: string; min_price: number | null; max_price: number | null;
  open_ended: boolean; default_price: number | null; is_active: boolean };
export type ExternalRow = { id: string; name: string; category: string; billing: "one_time" | "recurring"; period: "monthly" | "annual" | null;
  provider_cost: number | null; selling_price: number | null; notes: string | null; is_active: boolean };
export type PlanRow = { id: string; kind: "website" | "app"; name: string; monthly_price: number; annual_price: number | null; included_hours: string | null;
  bug_fix_coverage: string | null; update_frequency: string | null; backup_monitoring: string | null; support_channel: string | null;
  response_time: string | null; exclusions: string | null; is_active: boolean };
export type DiscountRow = { id: string; name: string; type: "percent" | "amount"; value: number; max_amount: number | null; is_active: boolean };
export type TemplateRow = { id: string; name: string; items: { label: string; mode: "percent" | "amount"; value: number; due: string | null }[] };

export async function getCatalog(actor: Actor, opts: { activeOnly?: boolean } = {}) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const active = opts.activeOnly ? tx`where is_active` : tx``;
    const packages = await tx<Omit<PackageRow, "items">[]>`select * from pricing_packages ${active} order by position, name`;
    const items = await tx<{ id: string; package_id: string; name: string; description: string | null; amount: number }[]>`
      select * from pricing_package_items order by position`;
    return {
      packages: packages.map((p) => ({ ...p, items: items.filter((i) => i.package_id === p.id) })) as PackageRow[],
      services: await tx<ServiceRow[]>`select * from pricing_services ${active} order by position, name`,
      externals: await tx<ExternalRow[]>`select * from external_cost_catalog ${active} order by position, name`,
      plans: await tx<PlanRow[]>`select * from maintenance_plans ${active} order by kind, position`,
      discounts: await tx<DiscountRow[]>`select * from discount_rules ${active} order by name`,
      templates: await tx<TemplateRow[]>`select * from milestone_templates order by name`,
      tax: await getTaxConfig(tx),
      defaults: await getProposalDefaults(tx),
    };
  });
}

const money = z.coerce.number().min(0).max(999_999_999);
const optMoney = z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(999_999_999)]).optional()
  .transform((v) => (v === "" || v == null ? null : Number(v)));
const active = z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false")]).optional().transform((v) => v === true || v === "on" || v === "true");

const packageSchema = z.object({
  kind: z.enum(["website", "app"]), name: text(200), description: optText(2000), price: money, is_active: active,
  scope_limits: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
  items: z.array(z.object({ name: text(200), description: optText(1000), amount: money })).min(1, "needs at least one breakdown item").max(50),
});

/** Package breakdown items must add up exactly to the package price. */
export async function savePackage(actor: Actor, id: string | null, input: unknown) {
  assertAdmin(actor);
  const d = parse(packageSchema, input);
  const sum = d.items.reduce((s, i) => s + toPaise(i.amount), 0);
  if (sum !== toPaise(d.price)) {
    throw new AppError(`The breakdown adds up to ₹${(sum / 100).toLocaleString("en-IN")} but the package price is ₹${d.price.toLocaleString("en-IN")}. They must match.`);
  }
  return withDb(actor, async (tx) => {
    const row = { kind: d.kind, name: d.name, description: d.description, price: d.price, is_active: d.is_active, scope_limits: tx.json(d.scope_limits as never) };
    let pid = id;
    if (pid) {
      const r = await tx`update pricing_packages set ${tx(row as never)} where id = ${pid}`;
      if (r.count === 0) throw notFound();
      await tx`delete from pricing_package_items where package_id = ${pid}`;
    } else {
      [{ id: pid }] = await tx<{ id: string }[]>`insert into pricing_packages ${tx(row as never)} returning id`;
    }
    await tx`insert into pricing_package_items ${tx(d.items.map((i, idx) => ({ package_id: pid, position: idx + 1, ...i })))}`;
    await audit(tx, actor, "pricing.package_saved", "pricing_package", pid!, null, { name: d.name, price: d.price });
    return pid!;
  });
}

const serviceSchema = z.object({
  category: z.enum(["website", "app", "both"]), name: text(200), description: optText(2000), unit: z.enum(["fixed", "per_page", "per_screen", "per_item"]),
  min_price: optMoney, max_price: optMoney, open_ended: active, default_price: optMoney, is_active: active,
}).refine((s) => s.min_price == null || s.max_price == null || s.max_price >= s.min_price, "Maximum price must be at least the minimum price");

const externalSchema = z.object({
  name: text(200), category: z.enum(["domain", "hosting", "cloud", "email", "ssl", "app_store", "messaging", "api", "payment_fees", "other"]),
  billing: z.enum(["one_time", "recurring"]), period: z.union([z.enum(["monthly", "annual"]), z.literal(""), z.null()]).optional().transform((v) => v || null),
  provider_cost: optMoney, selling_price: optMoney, notes: optText(2000), is_active: active,
}).transform((e) => ({ ...e, period: e.billing === "recurring" ? (e.period ?? "annual") : null }));

const planSchema = z.object({
  kind: z.enum(["website", "app"]), name: text(100), monthly_price: money, annual_price: optMoney, included_hours: optText(500),
  bug_fix_coverage: optText(500), update_frequency: optText(500), backup_monitoring: optText(500), support_channel: optText(500),
  response_time: optText(200), exclusions: optText(1000), is_active: active,
});

const discountSchema = z.object({
  name: text(100), type: z.enum(["percent", "amount"]), value: money, max_amount: optMoney, is_active: active,
}).refine((d) => d.type !== "percent" || d.value <= 100, "A percentage discount cannot exceed 100");

const templateSchema = z.object({
  name: text(100),
  items: z.array(z.object({ label: text(100), mode: z.enum(["percent", "amount"]), value: money, due: optText(200) })).min(1).max(12),
}).refine((t) => !t.items.every((i) => i.mode === "percent") || Math.abs(t.items.reduce((s, i) => s + i.value, 0) - 100) < 1e-6,
  "Percentage milestones must add up to 100%");

const TABLES = {
  service: { table: "pricing_services", schema: serviceSchema },
  external: { table: "external_cost_catalog", schema: externalSchema },
  plan: { table: "maintenance_plans", schema: planSchema },
  discount: { table: "discount_rules", schema: discountSchema },
  template: { table: "milestone_templates", schema: templateSchema },
} as const;
export type CatalogKind = keyof typeof TABLES;

export async function saveCatalogItem(actor: Actor, kind: CatalogKind, id: string | null, input: unknown) {
  assertAdmin(actor);
  const { table, schema } = TABLES[kind];
  const d = parse(schema as z.ZodTypeAny, input) as Record<string, unknown>;
  return withDb(actor, async (tx) => {
    const row = kind === "template" ? { name: d.name, items: tx.json(d.items as never) } : d;
    let rid = id;
    if (rid) {
      const r = await tx`update ${tx(table)} set ${tx(row as never)} where id = ${rid}`;
      if (r.count === 0) throw notFound();
    } else {
      [{ id: rid }] = await tx<{ id: string }[]>`insert into ${tx(table)} ${tx(row as never)} returning id`;
    }
    await audit(tx, actor, `pricing.${kind}_saved`, kind, rid!, null, { name: d.name });
    return rid!;
  });
}

export async function deleteCatalogItem(actor: Actor, kind: CatalogKind | "package", id: string) {
  assertAdmin(actor);
  const table = kind === "package" ? "pricing_packages" : TABLES[kind].table;
  return withDb(actor, async (tx) => {
    // Proposals keep their own snapshots, so catalog rows can be removed safely.
    const r = await tx`delete from ${tx(table)} where id = ${id}`;
    if (r.count === 0) throw notFound();
    await audit(tx, actor, `pricing.${kind}_deleted`, kind, id, null);
  });
}


/** Business details + logo for PDF documents. */
export async function pdfBrand() {
  const [b, logo] = await Promise.all([getBusiness(), getLogo()]);
  return { name: b.name, tagline: b.tagline, email: b.email, phone: b.phone, address: b.address, tax_id: b.tax_id, logo };
}
