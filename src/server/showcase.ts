import { z } from "zod";
import { withDb, SYSTEM, assertAdmin, asSystem, audit, type Actor } from "./core";
import { parse, optText } from "./validate";
import { notifyAdmins, notifyClientUsers } from "./notify";
import { emit } from "./referrals";
import { AppError, forbidden, notFound } from "@/lib/errors";

/**
 * Success showcase and testimonials. Nothing is public until an admin records the client's permission (case studies)
 * or the client gives consent for the exact text and an admin publishes it (testimonials).
 */
export type ShowcaseItem = { id: string; slug: string; title: string; client_label: string; client_id: string | null; project_id: string | null; industry: string; service_type: string;
  summary: string; story: string | null; metrics: { label: string; value: string }[]; live_url: string | null; has_before_image: boolean; has_after_image: boolean;
  permission_confirmed_at: Date | null; permission_note: string | null; status: "draft" | "published"; published_at: Date | null; position: number };
export type Testimonial = { id: string; client_id: string; project_id: string | null; quote: string; display_name: string; display_role: string | null; rating: number | null;
  status: "submitted" | "published" | "rejected" | "withdrawn"; consent_at: Date; published_at: Date | null; created_at: Date };

// ---- Public ----
export async function publishedShowcase() {
  return withDb(SYSTEM, async (tx) => ({
    items: await tx<ShowcaseItem[]>`select * from showcase_items where status = 'published' and permission_confirmed_at is not null order by position, published_at desc`,
    testimonials: await tx<Testimonial[]>`select id, quote, display_name, display_role, rating, published_at from testimonials where status = 'published' order by published_at desc limit 24`,
  }));
}
export async function publishedItem(slug: string) {
  const [i] = await withDb(SYSTEM, (tx) => tx<ShowcaseItem[]>`select * from showcase_items where slug = ${slug} and status = 'published' and permission_confirmed_at is not null`);
  return i ?? null;
}
export async function showcaseImage(id: string, kind: "before" | "after", actor: Actor | null) {
  const [r] = await withDb(SYSTEM, (tx) => tx<{ mime_type: string; data: Buffer; status: string }[]>`
    select g.mime_type, g.data, i.status from showcase_images g join showcase_items i on i.id = g.item_id where g.item_id = ${id} and g.kind = ${kind}`);
  if (!r || (r.status !== "published" && actor?.role !== "admin")) throw notFound();
  return r;
}

// ---- Admin: case studies ----
const metricLines = z.preprocess((v) => String(v ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
  const [label, ...rest] = l.split(":"); return { label: label.trim(), value: rest.join(":").trim() };
}), z.array(z.object({ label: z.string().min(1).max(60), value: z.string().min(1).max(40) })).max(6));
const itemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/, "use lowercase letters, numbers and dashes"),
  client_label: z.string().trim().min(1).max(160),
  industry: z.string().trim().min(1).max(60),
  service_type: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(400),
  story: optText(8000),
  metrics: metricLines,
  live_url: z.string().trim().max(500).refine((v) => !v || /^https:\/\//.test(v), "must start with https://").transform((v) => v || null),
  client_id: z.string().uuid().nullable().optional().or(z.literal("").transform(() => null)),
  position: z.coerce.number().int().min(0).max(10000).default(0),
  permission_confirmed: z.boolean(),
  permission_note: optText(1000),
});

export async function listShowcase(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => ({
    items: await tx<ShowcaseItem[]>`select * from showcase_items order by position, created_at desc`,
    testimonials: await tx<(Testimonial & { business_name: string })[]>`select t.*, c.business_name from testimonials t join client_profiles c on c.id = t.client_id order by t.created_at desc limit 200`,
    clients: await tx<{ id: string; business_name: string }[]>`select id, business_name from client_profiles order by business_name`,
  }));
}

export async function saveShowcaseItem(actor: Actor, id: string | null, input: unknown) {
  assertAdmin(actor);
  const d = parse(itemSchema, input);
  const row = { title: d.title, slug: d.slug, client_label: d.client_label, industry: d.industry, service_type: d.service_type, summary: d.summary, story: d.story ?? null,
    metrics: d.metrics, live_url: d.live_url, client_id: d.client_id ?? null, position: d.position, permission_note: d.permission_note ?? null };
  return withDb(actor, async (tx) => {
    try {
      let itemId = id;
      if (id) {
        const r = await tx`update showcase_items set ${tx({ ...row, metrics: tx.json(d.metrics as never) } as never)},
          permission_confirmed_at = case when ${d.permission_confirmed} then coalesce(permission_confirmed_at, now()) else null end,
          status = case when ${d.permission_confirmed} then status else 'draft' end where id = ${id}`;
        if (!r.count) throw notFound();
      } else {
        const [s] = await tx<{ id: string }[]>`insert into showcase_items ${tx({ ...row, metrics: tx.json(d.metrics as never) } as never)} returning id`;
        itemId = s.id;
        if (d.permission_confirmed) await tx`update showcase_items set permission_confirmed_at = now() where id = ${itemId}`;
      }
      await audit(tx, actor, id ? "showcase.updated" : "showcase.created", "showcase_item", itemId!, null, { permission: d.permission_confirmed });
      return itemId!;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AppError("Another case study already uses that web address (slug).", "conflict");
      throw e;
    }
  });
}

export async function setShowcaseStatus(actor: Actor, id: string, publish: boolean) {
  assertAdmin(actor);
  await withDb(actor, async (tx) => {
    const [i] = await tx<{ permission_confirmed_at: Date | null }[]>`select permission_confirmed_at from showcase_items where id = ${id}`;
    if (!i) throw notFound();
    if (publish && !i.permission_confirmed_at) throw new AppError("Record the client's permission before publishing.", "conflict");
    await tx`update showcase_items set status = ${publish ? "published" : "draft"}, published_at = case when ${publish} then coalesce(published_at, now()) else published_at end where id = ${id}`;
    await audit(tx, actor, publish ? "showcase.published" : "showcase.unpublished", "showcase_item", id, null, {});
  });
}

const IMG = /^image\/(png|jpeg|webp)$/;
export async function uploadShowcaseImage(actor: Actor, id: string, kind: "before" | "after", file: { type: string; data: Buffer }) {
  assertAdmin(actor);
  if (!IMG.test(file.type)) throw new AppError("Use a PNG, JPG or WebP image.", "invalid");
  if (file.data.length > 3 * 1024 * 1024) throw new AppError("Images must be 3 MB or smaller.", "invalid");
  await withDb(actor, async (tx) => {
    const [i] = await tx`select 1 from showcase_items where id = ${id}`;
    if (!i) throw notFound();
    await tx`insert into showcase_images (item_id, kind, mime_type, data) values (${id}, ${kind}, ${file.type}, ${file.data})
             on conflict (item_id, kind) do update set mime_type = excluded.mime_type, data = excluded.data, updated_at = now()`;
    await tx`update showcase_items set ${kind === "before" ? tx`has_before_image = true` : tx`has_after_image = true`} where id = ${id}`;
  });
}

// ---- Testimonials ----
const testimonialSchema = z.object({
  quote: z.string().trim().min(10, "Please write at least a sentence").max(1200),
  display_name: z.string().trim().min(1).max(120),
  display_role: optText(120),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  project_id: z.string().uuid().nullable().optional().or(z.literal("").transform(() => null)),
  consent: z.literal(true, { message: "Please confirm we may publish this text" }),
});

export async function submitTestimonial(actor: Actor, input: unknown) {
  if (actor.role !== "client" || !actor.clientId) throw forbidden();
  const d = parse(testimonialSchema, input);
  const id = await withDb(actor, async (tx) => {
    if (d.project_id) { const [p] = await tx`select 1 from projects where id = ${d.project_id}`; if (!p) throw notFound(); }
    return asSystem(tx, actor, async () => {
      const [n] = await tx<{ n: number }[]>`select count(*)::int as n from testimonials where client_id = ${actor.clientId!} and status = 'submitted'`;
      if (n.n >= 3) throw new AppError("You already have testimonials waiting for review. Thank you!", "rate_limited");
      const [t] = await tx<{ id: string }[]>`insert into testimonials (client_id, project_id, author_id, quote, display_name, display_role, rating, consent_at)
        values (${actor.clientId!}, ${d.project_id ?? null}, ${actor.userId}, ${d.quote}, ${d.display_name}, ${d.display_role ?? null}, ${d.rating ?? null}, now()) returning id`;
      await notifyAdmins(tx, actor, { type: "testimonial", title: `New testimonial from ${d.display_name} to review`, link: "/admin/showcase" });
      return t.id;
    });
  });
  await emit("testimonial.submitted", `testimonial.submitted:${id}`, { client_id: actor.clientId });
  return id;
}

export async function myTestimonials(actor: Actor) {
  if (actor.role !== "client") throw forbidden();
  return withDb(actor, (tx) => tx<Testimonial[]>`select * from testimonials where client_id = ${actor.clientId!} order by created_at desc`);
}

export async function withdrawTestimonial(actor: Actor, id: string) {
  if (actor.role !== "client") throw forbidden();
  await withDb(actor, async (tx) => {
    const [t] = await tx`select 1 from testimonials where id = ${id} and client_id = ${actor.clientId!}`;
    if (!t) throw notFound();
    await asSystem(tx, actor, () => tx`update testimonials set status = 'withdrawn' where id = ${id}`);
  });
}

export async function reviewTestimonial(actor: Actor, id: string, decision: "published" | "rejected" | "submitted") {
  assertAdmin(actor);
  await withDb(actor, async (tx) => {
    const [t] = await tx<{ client_id: string; status: string }[]>`select client_id, status from testimonials where id = ${id}`;
    if (!t) throw notFound();
    if (t.status === "withdrawn") throw new AppError("The client withdrew this testimonial.", "conflict");
    await tx`update testimonials set status = ${decision}, reviewed_by = ${actor.userId}, reviewed_at = now(),
             published_at = case when ${decision} = 'published' then coalesce(published_at, now()) else null end where id = ${id}`;
    await audit(tx, actor, `testimonial.${decision}`, "testimonial", id, null, {});
    if (decision === "published") await notifyClientUsers(tx, actor, t.client_id, { type: "testimonial", title: "Thank you! Your testimonial is now on our showcase.", link: "/showcase" });
  });
}
