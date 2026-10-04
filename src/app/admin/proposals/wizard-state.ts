import type { PackageRow, ServiceRow, ExternalRow, PlanRow, DiscountRow, TemplateRow, ProposalDefaults } from "@/server/pricing";
import type { TaxConfig } from "@/lib/proposal-calc";

// ---------------------------------------------------------------------------
// State shape (mirrors the server's proposal input schema)
// ---------------------------------------------------------------------------
export type Addon = { service_id: string | null; name: string; description: string | null; unit: string | null; quantity: number; unit_price: number | null; range_min: number | null; range_max: number | null; open_ended: boolean };
export type Custom = { name: string; description: string | null; quantity: number; unit_price: number | null };
export type External = { catalog_id: string | null; name: string; category: string | null; billing: "one_time" | "recurring"; period: "monthly" | "annual" | null;
  provider_cost: number | null; selling_price: number | null; included_in_package: boolean; payer: "agency" | "client"; renewal_date: string | null };
export type Maint = { plan_id: string | null; name: string; kind: string | null; billing: "monthly" | "annual"; monthly_price: number; annual_price: number | null;
  included_hours: string | null; bug_fix_coverage: string | null; update_frequency: string | null; backup_monitoring: string | null;
  support_channel: string | null; response_time: string | null; exclusions: string | null };
export type Milestone = { label: string; mode: "percent" | "amount"; value: number; due: string | null };
export type WizardState = {
  client: { mode: "existing"; client_id: string } | { mode: "new"; business_name: string; owner_name: string; email: string; phone: string | null; business_category: string | null };
  contact: { name: string; email: string; phone: string | null };
  business_category: string | null;
  title: string; project_type: string; description: string | null; requirements: string | null; target_launch_date: string | null;
  assigned_to: string | null; internal_notes: string | null; executive_summary: string | null; recommended_solution: string | null;
  pricing: { mode: "package" | "itemized"; package_ids: string[]; addons: Addon[]; custom: Custom[] };
  scope_details: { platforms: string[]; pages: number | null; screens: number | null; integrations: number | null; roles: number | null; backend: string | null;
    authentication: string | null; storage: string | null; notes: string | null };
  externals: External[];
  maintenance: Maint | null;
  warranty: { days: number; terms: string | null };
  scope: { objectives: string | null; features: string[]; pages_screens: string[]; design_requirements: string | null; deliverables: string[];
    client_responsibilities: string[]; content_requirements: string | null; revisions: number; milestones: { title: string; estimate: string | null }[];
    timeline: string | null; acceptance_criteria: string | null; exclusions: string[]; assumptions: string[] };
  discount: { rule_id: string | null; type: "none" | "percent" | "amount"; value: number; max_amount: number | null };
  milestones: Milestone[];
  valid_until: string;
  terms: string | null;
};

export type Catalog = { packages: PackageRow[]; services: ServiceRow[]; externals: ExternalRow[]; plans: PlanRow[]; discounts: DiscountRow[];
  templates: TemplateRow[]; tax: TaxConfig; defaults: ProposalDefaults };
export type ClientOpt = { id: string; business_name: string; owner_name: string; email: string; phone: string | null; business_category: string | null };


export function newWizardState(catalog: Catalog, me: string): WizardState {
  const web = catalog.packages.find((p) => p.kind === "website" && p.is_active);
  return {
    client: { mode: "existing", client_id: "" }, contact: { name: "", email: "", phone: null }, business_category: null,
    title: "", project_type: "website", description: null, requirements: null, target_launch_date: null, assigned_to: me, internal_notes: null,
    executive_summary: null, recommended_solution: null,
    pricing: { mode: "package", package_ids: web ? [web.id] : [], addons: [], custom: [] },
    scope_details: { platforms: [], pages: null, screens: null, integrations: null, roles: null, backend: null, authentication: null, storage: null, notes: null },
    externals: [], maintenance: null,
    warranty: { days: catalog.defaults.warranty_days, terms: catalog.defaults.warranty_terms },
    scope: { objectives: null, features: [], pages_screens: [], design_requirements: null, deliverables: [], client_responsibilities: [], content_requirements: null,
      revisions: catalog.defaults.revisions, milestones: [], timeline: null, acceptance_criteria: null, exclusions: [], assumptions: [] },
    discount: { rule_id: null, type: "none", value: 0, max_amount: null },
    milestones: [],
    valid_until: new Date(Date.now() + catalog.defaults.validity_days * 86400_000).toISOString().slice(0, 10),
    terms: catalog.defaults.terms,
  };
}

