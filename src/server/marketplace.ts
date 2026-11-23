import { z } from "zod";
import { withDb, SYSTEM, assertAdmin, audit, asSystem, type Actor, type Tx } from "./core";
import { parse, optText } from "./validate";
import { notifyAdmins, notifyClientUsers } from "./notify";
import { emit, getReferralSettings } from "./referrals";
import { AppError, forbidden, notFound } from "@/lib/errors";

/**
 * Service marketplace: an admin-managed catalogue, explainable recommendations, and "Request upgrade", which records
 * an inquiry, opens an opportunity in the sales pipeline (leads) and notifies the team. It never charges anyone.
 */
export type Service = {
  id: string; slug: string; name: string; category: ServiceCategory; icon: string; summary: string; details: string | null;
  benefits: string[]; price_label: string | null; industries: string[]; position: number; is_active: boolean;
};
export type ServiceCategory = "websites" | "apps" | "software" | "ai_automation" | "care";
export const SERVICE_CATEGORIES: Record<ServiceCategory, string> = {
  websites: "Websites", apps: "Apps", software: "Software", ai_automation: "AI & automation", care: "Care & maintenance",
};
export const INQUIRY_STATUSES = { received: "Received", in_review: "Being reviewed", proposal_sent: "Proposal sent", closed: "Closed" } as const;
export type Inquiry = { id: string; service_id: string; service_name: string; status: keyof typeof INQUIRY_STATUSES; note: string | null; source: string; created_at: Date;
  lead_id: string | null; client_id: string; business_name?: string };

async function getGrowthSettings(tx?: Tx) {
  const run = async (t: Tx) => {
    const [r] = await t<{ value: Record<string, unknown> }[]>`select value from app_settings where key = 'growth'`;
    return { advisor_enabled: true, advisor_retention_days: 90, recommendations_enabled: true, showcase_enabled: true, ...(r?.value ?? {}) } as
      { advisor_enabled: boolean; advisor_retention_days: number; recommendations_enabled: boolean; showcase_enabled: boolean };
  };
  return tx ? run(tx) : withDb(SYSTEM, run);
}
export { getGrowthSettings };

export async function listServices(actor: Actor, opts: { includeInactive?: boolean } = {}) {
  return withDb(actor, (tx) => tx<Service[]>`
    select * from service_catalog ${opts.includeInactive && actor.role === "admin" ? tx`` : tx`where is_active`} order by position, name`);
}

/** Words in a business category that suggest a service (in addition to each service's own keyword list). */
const WORDS = (s: string | null | undefined) => (s ?? "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);

/**
 * Explainable recommendations: match the client's business category against each service's industry keywords,
 * skipping what they already have or already asked for. Every suggestion carries a plain-language reason.
 */
export function recommend(services: Service[], ctx: { category: string | null; owned: string[]; requested: string[] }, limit = 3) {
  const words = WORDS(ctx.category);
  if (!words.length) return [];
  const label = ctx.category!.trim();
  return services
    .filter((s) => !ctx.owned.includes(s.slug) && !ctx.requested.includes(s.id))
    .map((s) => ({ s, hit: s.industries.find((i) => i !== "all" && words.some((w) => i.includes(w) || w.includes(i))) }))
    .filter((x) => x.hit)
    .slice(0, limit)
    .map(({ s }) => ({ service: s, reason: `Often chosen by ${label.toLowerCase()} businesses like yours.` }));
}

async function clientContext(tx: Tx, clientId: string) {
  const [c] = await tx<{ business_category: string | null; hide_recommendations: boolean }[]>`select business_category, hide_recommendations from client_profiles where id = ${clientId}`;
  const types = await tx<{ project_type: string }[]>`select distinct project_type from projects where client_id = ${clientId} and status <> 'cancelled'`;
  const owned = new Set<string>();
  for (const t of types) {
    if (t.project_type === "website" || t.project_type === "web_app") owned.add("business-website");
    if (t.project_type === "ecommerce") owned.add("ecommerce");
    if (t.project_type === "mobile_app") owned.add("mobile-app");
    if (t.project_type === "maintenance") owned.add("website-maintenance");
  }
  const [m] = await tx<{ n: number }[]>`select count(*)::int as n from maintenance_consents where project_id in (select id from projects where client_id = ${clientId})`;
  if (m?.n) owned.add("website-maintenance");
  return { category: c?.business_category ?? null, hide: !!c?.hide_recommendations, owned: [...owned] };
}

/** Everything the client's Services page needs. */
export async function marketplace(actor: Actor) {
  if (actor.role !== "client" || !actor.clientId) throw forbidden();
  const settings = await getGrowthSettings();
  return withDb(actor, async (tx) => {
    const services = await tx<Service[]>`select * from service_catalog where is_active order by position, name`;
    const inquiries = await tx<Inquiry[]>`
      select i.*, s.name as service_name from service_inquiries i join service_catalog s on s.id = i.service_id
      where i.client_id = ${actor.clientId!} order by i.created_at desc`;
    const ctx = await asSystem(tx, actor, () => clientContext(tx, actor.clientId!));
    const open = inquiries.filter((i) => i.status === "received" || i.status === "in_review").map((i) => i.service_id);
    const recs = settings.recommendations_enabled && !ctx.hide ? recommend(services, { category: ctx.category, owned: ctx.owned, requested: open }) : [];
    return { services, inquiries, recommendations: recs, owned: ctx.owned, hidden: ctx.hide, category: ctx.category };
  });
}

/** A single recommendation for the dashboard card (or null). */
export async function topRecommendation(actor: Actor) {
  try {
    const m = await marketplace(actor);
    return m.recommendations[0] ?? null;
  } catch { return null; }
}

const inquirySchema = z.object({ service_id: z.string().uuid(), note: optText(2000), project_id: z.string().uuid().nullable().optional(),
  source: z.enum(["marketplace", "ai_advisor", "recommendation"]).default("marketplace") });

/** Client "Request upgrade": inquiry + pipeline opportunity + admin notification. Idempotent while a request is open. */
export async function requestUpgrade(actor: Actor, input: unknown) {
  if (actor.role !== "client" || !actor.clientId) throw forbidden();
  const d = parse(inquirySchema, input);
  const r = await withDb(actor, async (tx) => {
    const [svc] = await tx<{ id: string; name: string }[]>`select id, name from service_catalog where id = ${d.service_id} and is_active`;
    if (!svc) throw notFound("That service isn't available.");
    if (d.project_id) {
      const [p] = await tx`select 1 from projects where id = ${d.project_id}`;
      if (!p) throw notFound();
    }
    return asSystem(tx, actor, async () => {
      const [existing] = await tx<{ id: string }[]>`select id from service_inquiries where client_id = ${actor.clientId!} and service_id = ${svc.id} and status in ('received', 'in_review')`;
      if (existing) return { id: existing.id, created: false, service: svc.name, leadId: null as string | null };
      const [c] = await tx<{ business_name: string; owner_name: string; email: string; phone: string | null; business_category: string | null }[]>`
        select business_name, owner_name, email, phone, business_category from client_profiles where id = ${actor.clientId!}`;
      const rs = await getReferralSettings(tx);
      const source = d.source === "ai_advisor" ? "ai_advisor" : "upgrade_request";
      const [lead] = await tx<{ id: string }[]>`
        insert into leads (source, stage, business_name, contact_name, email, phone, business_category, service, problem, client_id, contact_consent_at, verified_at, owner_id)
        values (${source}, 'enquiry_submitted', ${c.business_name}, ${c.owner_name}, ${c.email}, ${c.phone}, ${c.business_category}, ${svc.name.slice(0, 100)},
                ${d.note ?? null}, ${actor.clientId!}, now(), now(), ${rs.default_owner_id || null}) returning id`;
      await tx`insert into lead_activities (lead_id, actor_id, kind, body) values (${lead.id}, ${actor.userId}, 'created',
               ${`Existing client asked about ${svc.name}${d.source === "ai_advisor" ? " (from the AI advisor)" : ""}`})`;
      const [inq] = await tx<{ id: string }[]>`
        insert into service_inquiries (client_id, service_id, project_id, note, source, lead_id, created_by)
        values (${actor.clientId!}, ${svc.id}, ${d.project_id ?? null}, ${d.note ?? null}, ${d.source}, ${lead.id}, ${actor.userId}) returning id`;
      await audit(tx, actor, "service.inquiry_created", "service_inquiry", inq.id, d.project_id ?? null, { service: svc.name });
      await notifyAdmins(tx, actor, { type: "service_inquiry", title: `${c.business_name} asked about ${svc.name}`, link: `/admin/referrals/leads/${lead.id}` });
      return { id: inq.id, created: true, service: svc.name, leadId: lead.id };
    });
  });
  if (r.created) await emit("service.inquiry.created", `service.inquiry.created:${r.id}`, { client_id: actor.clientId, lead_id: r.leadId }, { service: r.service });
  return r;
}

export async function setRecommendationsHidden(actor: Actor, hidden: boolean) {
  if (actor.role !== "client" || !actor.clientId) throw forbidden();
  await withDb(actor, (tx) => asSystem(tx, actor, () => tx`update client_profiles set hide_recommendations = ${hidden} where id = ${actor.clientId!}`));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
const lines = z.preprocess((v) => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n|,/)).map((x) => String(x).trim()).filter(Boolean),
  z.array(z.string().max(120)).max(12));
const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/, "use lowercase letters, numbers and dashes"),
  category: z.enum(["websites", "apps", "software", "ai_automation", "care"]),
  icon: z.string().trim().max(40).default("grid"),
  summary: z.string().trim().min(1).max(300),
  details: optText(5000),
  benefits: lines,
  industries: z.preprocess((v) => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n|,/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean), z.array(z.string().max(40)).max(30)),
  price_label: optText(80),
  position: z.coerce.number().int().min(0).max(10000).default(0),
  is_active: z.coerce.boolean().default(true),
});

export async function saveService(actor: Actor, id: string | null, input: unknown) {
  assertAdmin(actor);
  const d = parse(serviceSchema, input);
  return withDb(actor, async (tx) => {
    try {
      if (id) {
        const r = await tx`update service_catalog set ${tx(d as never)} where id = ${id}`;
        if (!r.count) throw notFound();
        await audit(tx, actor, "service.updated", "service", id, null, { name: d.name });
        return id;
      }
      const [s] = await tx<{ id: string }[]>`insert into service_catalog ${tx(d as never)} returning id`;
      await audit(tx, actor, "service.created", "service", s.id, null, { name: d.name });
      return s.id;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AppError("Another service already uses that short name (slug).", "conflict");
      throw e;
    }
  });
}

export async function listInquiries(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<(Inquiry & { business_name: string; lead_stage: string | null })[]>`
    select i.*, s.name as service_name, c.business_name, l.stage as lead_stage from service_inquiries i
    join service_catalog s on s.id = i.service_id join client_profiles c on c.id = i.client_id left join leads l on l.id = i.lead_id
    order by i.created_at desc limit 200`);
}

export async function setInquiryStatus(actor: Actor, id: string, status: keyof typeof INQUIRY_STATUSES) {
  assertAdmin(actor);
  if (!(status in INQUIRY_STATUSES)) throw new AppError("Unknown status", "invalid");
  await withDb(actor, async (tx) => {
    const [i] = await tx<{ client_id: string; service_name: string }[]>`
      update service_inquiries i set status = ${status} from service_catalog s where s.id = i.service_id and i.id = ${id} returning i.client_id, s.name as service_name`;
    if (!i) throw notFound();
    await audit(tx, actor, "service.inquiry_status", "service_inquiry", id, null, { status });
    await notifyClientUsers(tx, actor, i.client_id, { type: "service_inquiry", title: `Your request for ${i.service_name}: ${INQUIRY_STATUSES[status]}`, link: "/portal/services" });
  });
}
