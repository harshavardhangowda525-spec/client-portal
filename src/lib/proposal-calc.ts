/**
 * Proposal pricing engine. Pure and deterministic: the wizard uses it for the live
 * panel and the server re-runs it on every save, so stored totals never come from the browser.
 * All arithmetic is in integer paise.
 */
import { fromPaise, toPaise } from "./money";

export type Billing = "one_time" | "recurring";
export type Period = "monthly" | "annual";

export type PackageSnapshot = {
  id: string;
  kind: "website" | "app";
  name: string;
  price: number;
  scope_limits: { pages?: number; screens?: number; integrations?: number; roles?: number; backend?: string };
  items: { name: string; description?: string | null; amount: number }[];
};

export type AddonInput = { service_id?: string | null; name: string; description?: string | null; unit?: string | null; quantity: number; unit_price: number | null; range_min?: number | null; range_max?: number | null; open_ended?: boolean };
export type CustomInput = { name: string; description?: string | null; quantity: number; unit_price: number | null };
export type ExternalInput = {
  catalog_id?: string | null; name: string; category?: string | null; billing: Billing; period?: Period | null;
  provider_cost?: number | null; selling_price: number | null; included_in_package: boolean; payer: "agency" | "client"; renewal_date?: string | null;
};
export type MaintenanceInput = {
  plan_id?: string | null; name: string; kind?: string | null; billing: Period; monthly_price: number; annual_price?: number | null;
  included_hours?: string | null; bug_fix_coverage?: string | null; update_frequency?: string | null; backup_monitoring?: string | null;
  support_channel?: string | null; response_time?: string | null; exclusions?: string | null;
};
export type MilestoneInput = { label: string; mode: "percent" | "amount"; value: number; due?: string | null };
export type DiscountInput = { type: "none" | "percent" | "amount"; value: number; max_amount?: number | null; name?: string | null };
export type TaxConfig = { enabled: boolean; label: string; rate: number; apply_to_external: boolean };
export type AppScope = { platforms?: string[]; screens?: number | null; integrations?: number | null; roles?: number | null; backend?: "simple" | "moderate" | "complex" | null; pages?: number | null };

export type PricingInput = {
  mode: "package" | "itemized";
  pkgs: PackageSnapshot[];
  addons: AddonInput[];
  custom: CustomInput[];
  externals: ExternalInput[];
  maintenance: MaintenanceInput | null;
  discount: DiscountInput;
  discount_applies_to_external: boolean;
  tax: TaxConfig;
  milestones: MilestoneInput[];
  scope?: AppScope;
};

export type Line = {
  section: "base" | "inclusion" | "addon" | "custom" | "external" | "maintenance";
  name: string; description?: string | null; quantity: number; unit?: string | null;
  unit_price: number | null; amount: number | null; billing: Billing; period: Period | null;
  charged: boolean; included_in_package: boolean; payer: "agency" | "client" | null; renewal_date?: string | null;
  range_min?: number | null; range_max?: number | null; tbc: boolean; details?: Record<string, unknown>;
};

export type Computed = {
  lines: Line[];
  base: number; addons: number; custom: number; external: number;
  subtotal: number; eligible: number; discountAmount: number; discountPercent: number;
  taxable: number; taxRate: number; taxAmount: number; total: number;
  recurringMonthly: number; recurringAnnual: number;
  milestones: (MilestoneInput & { amount: number })[];
  milestoneDiff: number;       // total − sum(milestones); must be 0 to send
  roundingAdjustment: number;  // paise added to the last percentage milestone
  initialPayable: number;
  hasTbc: boolean;
  warnings: string[];
  errors: string[];
};

const lineAmount = (qty: number, unit: number | null) => (unit == null ? null : Math.round(toPaise(unit) * Number(qty)));

export function computeProposal(input: PricingInput): Computed {
  const lines: Line[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let base = 0, addons = 0, custom = 0, external = 0, monthly = 0, annual = 0;
  let hasTbc = false;

  // 1. Base package(s) — e.g. website + app. Breakdown rows are shown as inclusions and never charged again.
  if (input.mode === "package") {
    if (input.pkgs.length === 0) errors.push("Select a base package or switch to itemized pricing.");
    for (const pkg of input.pkgs) {
      const price = toPaise(pkg.price);
      base += price;
      lines.push({ section: "base", name: pkg.name, quantity: 1, unit_price: pkg.price, amount: pkg.price, billing: "one_time",
        period: null, charged: true, included_in_package: false, payer: null, tbc: false, details: { kind: pkg.kind } });
      const itemsSum = pkg.items.reduce((s, i) => s + toPaise(i.amount), 0);
      if (itemsSum !== price) warnings.push(`The "${pkg.name}" breakdown adds up to ₹${fromPaise(itemsSum).toLocaleString("en-IN")}, not the package price. Update it in Pricing configuration.`);
      for (const i of pkg.items) {
        lines.push({ section: "inclusion", name: i.name, description: i.description ?? null, quantity: 1, unit_price: i.amount, amount: i.amount, billing: "one_time",
          period: null, charged: false, included_in_package: true, payer: null, tbc: false, details: { package: pkg.name } });
      }
    }
  }

  // 2. Optional add-ons. Range services must carry an explicit quoted price.
  for (const a of input.addons) {
    const amt = lineAmount(a.quantity, a.unit_price);
    if (amt == null) { errors.push(`Enter the quoted price for "${a.name}".`); hasTbc = true; }
    else {
      addons += amt;
      if (a.range_min != null && a.unit_price! < Number(a.range_min)) warnings.push(`"${a.name}" is priced below its usual range.`);
      if (a.range_max != null && !a.open_ended && a.unit_price! > Number(a.range_max)) warnings.push(`"${a.name}" is priced above its usual range.`);
    }
    lines.push({ section: "addon", name: a.name, description: a.description ?? null, quantity: a.quantity, unit: a.unit ?? null, unit_price: a.unit_price,
      amount: amt == null ? null : fromPaise(amt), billing: "one_time", period: null, charged: amt != null, included_in_package: false, payer: null,
      range_min: a.range_min ?? null, range_max: a.range_max ?? null, tbc: amt == null });
  }

  // 3. Itemized / custom development lines.
  for (const c of input.custom) {
    const amt = lineAmount(c.quantity, c.unit_price);
    if (amt == null) errors.push(`Enter a price for "${c.name}".`);
    else custom += amt;
    lines.push({ section: "custom", name: c.name, description: c.description ?? null, quantity: c.quantity, unit_price: c.unit_price,
      amount: amt == null ? null : fromPaise(amt), billing: "one_time", period: null, charged: amt != null, included_in_package: false, payer: null, tbc: amt == null });
  }
  if (input.mode === "itemized" && input.custom.length === 0 && input.addons.length === 0) errors.push("Add at least one line item.");

  // 4. External / third-party costs. Only fees we bill (payer = agency), not already included,
  //    and with a known price are charged. Recurring fees never enter the one-time total.
  for (const e of input.externals) {
    const known = e.selling_price != null;
    const charged = known && !e.included_in_package && e.payer === "agency";
    if (!known && !e.included_in_package) hasTbc = true;
    const amt = known ? toPaise(e.selling_price!) : null;
    if (charged) {
      if (e.billing === "one_time") external += amt!;
      else if (e.period === "annual") annual += amt!;
      else monthly += amt!;
    }
    lines.push({ section: "external", name: e.name, quantity: 1, unit_price: e.selling_price, amount: known ? e.selling_price : null, billing: e.billing,
      period: e.billing === "recurring" ? (e.period ?? "monthly") : null, charged, included_in_package: e.included_in_package, payer: e.payer,
      renewal_date: e.renewal_date ?? null, tbc: !known && !e.included_in_package, details: { category: e.category ?? null } });
  }

  // 5. Maintenance (always recurring).
  if (input.maintenance) {
    const m = input.maintenance;
    const annualBilling = m.billing === "annual";
    const price = annualBilling ? (m.annual_price ?? m.monthly_price * 12) : m.monthly_price;
    if (annualBilling) annual += toPaise(price); else monthly += toPaise(price);
    lines.push({ section: "maintenance", name: `${m.name} maintenance plan`, quantity: 1, unit_price: price, amount: price, billing: "recurring",
      period: m.billing, charged: true, included_in_package: false, payer: "agency", tbc: false,
      details: { included_hours: m.included_hours, bug_fix_coverage: m.bug_fix_coverage, update_frequency: m.update_frequency, backup_monitoring: m.backup_monitoring,
        support_channel: m.support_channel, response_time: m.response_time, exclusions: m.exclusions } });
  }

  // 6. Discount on the eligible subtotal, with an optional cap.
  const subtotal = base + addons + custom + external;
  const eligible = base + addons + custom + (input.discount_applies_to_external ? external : 0);
  let discount = 0;
  const d = input.discount;
  if (d.type === "percent") {
    if (d.value > 100) errors.push("A percentage discount cannot exceed 100%.");
    discount = Math.round((eligible * Math.min(d.value, 100)) / 100);
  } else if (d.type === "amount") {
    discount = Math.min(toPaise(d.value), eligible);
  }
  if (d.type !== "none" && d.max_amount != null && discount > toPaise(d.max_amount)) discount = toPaise(d.max_amount);

  // 7. Tax per configuration. The discount reduces development charges first; any remainder
  //    (only possible when discounts apply to external fees) reduces the external fees.
  //    External pass-through fees are taxed only when the tax settings say so.
  const dev = base + addons + custom;
  const discountDev = Math.min(discount, dev);
  const discountExt = discount - discountDev;
  const taxableBase = input.tax.enabled ? dev - discountDev + (input.tax.apply_to_external ? external - discountExt : 0) : 0;
  const taxAmount = input.tax.enabled ? Math.round((taxableBase * input.tax.rate) / 100) : 0;
  const total = subtotal - discount + taxAmount;

  // 8. Payment milestones must add up exactly to the final one-time total.
  let allocated = 0;
  let roundingAdjustment = 0;
  const lastPercentIdx = input.milestones.map((m) => m.mode).lastIndexOf("percent");
  const allPercent = input.milestones.length > 0 && input.milestones.every((m) => m.mode === "percent");
  const pctSum = input.milestones.filter((m) => m.mode === "percent").reduce((s, m) => s + Number(m.value), 0);
  const ms = input.milestones.map((m, i) => {
    let amt = m.mode === "amount" ? toPaise(m.value) : Math.round((total * Number(m.value)) / 100);
    if (allPercent && i === lastPercentIdx && Math.abs(pctSum - 100) < 1e-9) {
      const remainder = total - allocated - amt;
      roundingAdjustment = remainder;
      amt += remainder;
    }
    allocated += amt;
    return { ...m, amount: fromPaise(amt) };
  });
  const milestoneDiff = total - allocated;
  if (input.milestones.length === 0) errors.push("Add at least one payment milestone.");
  else if (milestoneDiff !== 0) errors.push(`Payment milestones add up to ₹${fromPaise(allocated).toLocaleString("en-IN")} but the total is ₹${fromPaise(total).toLocaleString("en-IN")}.`);

  // 9. Scope warnings for packages.
  const limits: PackageSnapshot["scope_limits"] = input.mode === "package" ? Object.assign({}, ...input.pkgs.map((p) => p.scope_limits)) : {};
  const appPkg = input.mode === "package" ? input.pkgs.find((p) => p.kind === "app") : undefined;
  const s = input.scope ?? {};
  if (limits.screens != null && s.screens != null && s.screens > limits.screens) warnings.push(`${s.screens} screens requested; the package covers up to ${limits.screens}. Add extra screens or prepare a custom quote.`);
  if (limits.pages != null && s.pages != null && s.pages > limits.pages) warnings.push(`${s.pages} pages requested; the package covers up to ${limits.pages}. Add extra pages or prepare a custom quote.`);
  if (limits.integrations != null && s.integrations != null && s.integrations > limits.integrations) warnings.push(`${s.integrations} integrations requested; the package covers ${limits.integrations}.`);
  if (limits.roles != null && s.roles != null && s.roles > limits.roles) warnings.push(`${s.roles} user roles requested; the package covers ${limits.roles}.`);
  if (input.mode === "package" && limits.backend === "simple" && s.backend && s.backend !== "simple") warnings.push(`A ${s.backend} backend is beyond the package scope — consider itemized custom pricing.`);
  if (appPkg && (s.platforms ?? []).filter((x) => x !== "web").length > 1) warnings.push("Android and iOS were both requested — confirm the package covers both platforms or add the extra effort.");
  if (hasTbc) warnings.push("Some external costs are marked “To be confirmed” and are not included in the totals.");

  return {
    lines, base: fromPaise(base), addons: fromPaise(addons), custom: fromPaise(custom), external: fromPaise(external),
    subtotal: fromPaise(subtotal), eligible: fromPaise(eligible), discountAmount: fromPaise(discount),
    discountPercent: eligible > 0 ? Math.round((discount / eligible) * 100000) / 1000 : 0,
    taxable: fromPaise(input.tax.enabled ? taxableBase : subtotal - discount), taxRate: input.tax.enabled ? input.tax.rate : 0, taxAmount: fromPaise(taxAmount),
    total: fromPaise(total), recurringMonthly: fromPaise(monthly), recurringAnnual: fromPaise(annual),
    milestones: ms, milestoneDiff: fromPaise(milestoneDiff), roundingAdjustment: fromPaise(roundingAdjustment),
    initialPayable: ms[0]?.amount ?? 0, hasTbc, warnings, errors,
  };
}
