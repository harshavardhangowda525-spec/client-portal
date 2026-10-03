import { z } from "zod";
import { withDb, assertAdmin, audit, getProjectFor, asSystem, nextNumber, type Actor, type Tx } from "./core";
import { parse, text, optText, date, uuid } from "./validate";
import { notifyAdmins, notifyProjectClients } from "./notify";
import { DEFAULT_TEMPLATE } from "./defaults";
import { AppError, notFound } from "@/lib/errors";
import { computeTotals, splitPaymentTerms } from "@/lib/money";
import { sha256, stableStringify } from "@/lib/crypto";
import { appUrl, company } from "@/lib/config";
import { sendEmail } from "./delivery";
import { todayISO } from "@/lib/progress";

export type QuoteItem = { id?: string; position: number; description: string; details: string | null; quantity: number; unit_price: number; amount: number };
export type PaymentTerm = { label: string; percent: number; due: string; amount?: number };

export type QuoteVersion = {
  id: string; quotation_id: string; project_id: string; version_no: number; status: string; currency: string;
  client_snapshot: { business_name?: string; owner_name?: string; email?: string; phone?: string | null; address?: string | null };
  project_description: string | null; issue_date: string; valid_until: string;
  discount_type: "none" | "percent" | "amount"; discount_value: number; tax_label: string; tax_rate: number;
  subtotal: number; discount_amount: number; tax_amount: number; total: number;
  payment_terms: PaymentTerm[]; included_features: string[]; exclusions: string[]; revisions_included: number;
  maintenance_terms: string | null; domain_hosting_terms: string | null; delivery_timeline: string | null; terms_conditions: string | null;
  admin_note?: string | null; client_response_note: string | null;
  sent_at: Date | null; first_viewed_at: Date | null; view_count: number; responded_at: Date | null; accepted_at: Date | null; created_at: Date;
};

/** Columns safe to show clients (admin_note is excluded). */
const CLIENT_COLUMNS = (tx: Tx) => tx`
  v.id, v.quotation_id, v.project_id, v.version_no, v.status, v.currency, v.client_snapshot, v.project_description, v.issue_date,
  v.valid_until, v.discount_type, v.discount_value, v.tax_label, v.tax_rate, v.subtotal, v.discount_amount, v.tax_amount, v.total,
  v.payment_terms, v.included_features, v.exclusions, v.revisions_included, v.maintenance_terms, v.domain_hosting_terms,
  v.delivery_timeline, v.terms_conditions, v.client_response_note, v.sent_at, v.first_viewed_at, v.view_count, v.responded_at,
  v.accepted_at, v.created_at`;

export function effectiveStatus(v: Pick<QuoteVersion, "status" | "valid_until">, today = todayISO()) {
  return (v.status === "sent" || v.status === "viewed") && v.valid_until < today ? "expired" : v.status;
}

/** Hash of everything the client agrees to; recorded with the acceptance. */
export function contentHash(number: string, v: QuoteVersion, items: QuoteItem[]) {
  return sha256(stableStringify({
    number, version: v.version_no, currency: v.currency, client: v.client_snapshot, description: v.project_description,
    issue_date: v.issue_date, valid_until: v.valid_until,
    items: items.map((i) => ({ d: i.description, x: i.details, q: Number(i.quantity), p: Number(i.unit_price), a: Number(i.amount) })),
    discount: [v.discount_type, Number(v.discount_value), Number(v.discount_amount)], tax: [v.tax_label, Number(v.tax_rate), Number(v.tax_amount)],
    subtotal: Number(v.subtotal), total: Number(v.total), payment_terms: v.payment_terms, features: v.included_features, exclusions: v.exclusions,
    revisions: v.revisions_included, maintenance: v.maintenance_terms, hosting: v.domain_hosting_terms, timeline: v.delivery_timeline,
    terms: v.terms_conditions,
  }));
}

async function expireStale(tx: Tx, projectId: string) {
  await tx`update quotation_versions set status = 'expired'
           where project_id = ${projectId} and status in ('sent', 'viewed') and valid_until < current_date`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export async function listTemplates(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const rows = await tx<{ id: string; name: string; description: string | null; content: typeof DEFAULT_TEMPLATE.content; updated_at: Date }[]>`
      select * from quotation_templates order by name`;
    if (rows.length === 0) {
      const [t] = await tx<{ id: string; name: string; description: string | null; content: typeof DEFAULT_TEMPLATE.content; updated_at: Date }[]>`
        insert into quotation_templates (name, description, content)
        values (${DEFAULT_TEMPLATE.name}, ${DEFAULT_TEMPLATE.description}, ${tx.json(DEFAULT_TEMPLATE.content as never)}) returning *`;
      return [t];
    }
    return rows;
  });
}

const templateContent = z.object({
  project_description: optText(10000),
  items: z.array(z.object({ description: text(500), details: optText(2000), quantity: z.coerce.number().positive().max(100000), unit_price: z.coerce.number().min(0).max(999_999_999) })).max(100),
  payment_terms: z.array(z.object({ label: text(100), percent: z.coerce.number().min(0).max(100), due: text(200) })).max(12),
  included_features: z.array(text(300)).max(100),
  exclusions: z.array(text(300)).max(100),
  revisions_included: z.coerce.number().int().min(0).max(100),
  maintenance_terms: optText(5000),
  domain_hosting_terms: optText(5000),
  delivery_timeline: optText(2000),
  terms_conditions: optText(20000),
  tax_label: text(40),
  tax_rate: z.coerce.number().min(0).max(100),
  valid_days: z.coerce.number().int().min(1).max(365),
});

export async function saveTemplate(actor: Actor, templateId: string | null, input: { name: string; description?: string | null; content: unknown }) {
  assertAdmin(actor);
  const name = parse(text(200), input.name);
  const description = parse(optText(500), input.description ?? null);
  const content = parse(templateContent, input.content);
  return withDb(actor, async (tx) => {
    if (templateId) {
      const r = await tx`update quotation_templates set name = ${name}, description = ${description}, content = ${tx.json(content as never)} where id = ${templateId}`;
      if (r.count === 0) throw notFound();
      return templateId;
    }
    const [t] = await tx<{ id: string }[]>`insert into quotation_templates (name, description, content) values (${name}, ${description}, ${tx.json(content as never)}) returning id`;
    return t.id;
  });
}

export async function deleteTemplate(actor: Actor, templateId: string) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx`delete from quotation_templates where id = ${templateId}`);
}

// ---------------------------------------------------------------------------
// Admin: create, edit drafts, send, revise
// ---------------------------------------------------------------------------
export async function createQuotation(actor: Actor, projectId: string, input: { title?: string; template_id?: string | null }) {
  assertAdmin(actor);
  const title = parse(text(200), input.title || "Website development quotation");
  const templateId = input.template_id ? parse(uuid, input.template_id) : null;
  return withDb(actor, async (tx) => {
    const project = await getProjectFor(tx, actor, projectId);
    const [client] = await tx`select business_name, owner_name, email, phone, address from client_profiles where id = ${project.client_id}`;
    let tpl = DEFAULT_TEMPLATE.content;
    if (templateId) {
      const [t] = await tx<{ content: typeof DEFAULT_TEMPLATE.content }[]>`select content from quotation_templates where id = ${templateId}`;
      if (!t) throw notFound("Template not found.");
      tpl = t.content;
    }
    const number = await nextNumber(tx, "Q");
    const [q] = await tx<{ id: string }[]>`insert into quotations (project_id, number, title, created_by) values (${projectId}, ${number}, ${title}, ${actor.userId}) returning id`;
    const items = tpl.items.map((i, idx) => ({ ...i, position: idx + 1 }));
    const totals = computeTotals(items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price })), "none", 0, tpl.tax_rate);
    const validUntil = new Date(Date.now() + (tpl.valid_days ?? 15) * 86400_000).toISOString().slice(0, 10);
    const [v] = await tx<{ id: string }[]>`
      insert into quotation_versions ${tx({
        quotation_id: q.id, project_id: projectId, version_no: 1, client_snapshot: tx.json(client as never) as never,
        project_description: tpl.project_description ?? project.description, valid_until: validUntil,
        tax_label: tpl.tax_label ?? "Tax", tax_rate: tpl.tax_rate ?? 0,
        subtotal: totals.subtotal, discount_amount: 0, tax_amount: totals.taxAmount, total: totals.total,
        payment_terms: tx.json(splitPaymentTerms(totals.total, tpl.payment_terms) as never) as never,
        included_features: tx.json(tpl.included_features as never) as never, exclusions: tx.json(tpl.exclusions as never) as never,
        revisions_included: tpl.revisions_included, maintenance_terms: tpl.maintenance_terms, domain_hosting_terms: tpl.domain_hosting_terms,
        delivery_timeline: tpl.delivery_timeline, terms_conditions: tpl.terms_conditions, created_by: actor.userId,
      })} returning id`;
    if (items.length) {
      await tx`insert into quotation_items ${tx(items.map((i, idx) => ({
        version_id: v.id, position: i.position, description: i.description, details: i.details ?? null,
        quantity: i.quantity, unit_price: i.unit_price, amount: totals.lineAmounts[idx],
      })))}`;
    }
    await audit(tx, actor, "quotation.created", "quotation", q.id, projectId, { number });
    return { quotationId: q.id, versionId: v.id };
  });
}

const draftSchema = templateContent.omit({ valid_days: true }).extend({
  valid_until: date,
  discount_type: z.enum(["none", "percent", "amount"]),
  discount_value: z.coerce.number().min(0).max(999_999_999),
  admin_note: optText(5000),
});

export async function saveDraft(actor: Actor, versionId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(draftSchema, input);
  if (d.discount_type === "percent" && d.discount_value > 100) throw new AppError("Discount percentage cannot exceed 100.");
  return withDb(actor, async (tx) => {
    const [v] = await tx<{ id: string; status: string; project_id: string }[]>`select id, status, project_id from quotation_versions where id = ${versionId}`;
    if (!v) throw notFound("Quotation version not found.");
    if (v.status !== "draft") throw new AppError("Only drafts can be edited. Create a revised version instead.");
    const totals = computeTotals(d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price })), d.discount_type, d.discount_value, d.tax_rate);
    await tx`delete from quotation_items where version_id = ${versionId}`;
    if (d.items.length) {
      await tx`insert into quotation_items ${tx(d.items.map((i, idx) => ({
        version_id: versionId, position: idx + 1, description: i.description, details: i.details, quantity: i.quantity,
        unit_price: i.unit_price, amount: totals.lineAmounts[idx],
      })))}`;
    }
    await tx`update quotation_versions set
      project_description = ${d.project_description}, valid_until = ${d.valid_until}, discount_type = ${d.discount_type},
      discount_value = ${d.discount_type === "none" ? 0 : d.discount_value}, tax_label = ${d.tax_label}, tax_rate = ${d.tax_rate},
      subtotal = ${totals.subtotal}, discount_amount = ${totals.discountAmount}, tax_amount = ${totals.taxAmount}, total = ${totals.total},
      payment_terms = ${tx.json(splitPaymentTerms(totals.total, d.payment_terms) as never)},
      included_features = ${tx.json(d.included_features as never)}, exclusions = ${tx.json(d.exclusions as never)},
      revisions_included = ${d.revisions_included}, maintenance_terms = ${d.maintenance_terms}, domain_hosting_terms = ${d.domain_hosting_terms},
      delivery_timeline = ${d.delivery_timeline}, terms_conditions = ${d.terms_conditions}, admin_note = ${d.admin_note}
      where id = ${versionId}`;
    return totals;
  });
}

export async function sendQuotation(actor: Actor, versionId: string, opts: { sendEmail?: boolean } = {}) {
  assertAdmin(actor);
  const info = await withDb(actor, async (tx) => {
    const [v] = await tx<(QuoteVersion & { number: string; title: string })[]>`
      select v.*, q.number, q.title from quotation_versions v join quotations q on q.id = v.quotation_id where v.id = ${versionId}`;
    if (!v) throw notFound("Quotation version not found.");
    if (v.status !== "draft") throw new AppError("This version has already been sent.");
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from quotation_items where version_id = ${versionId}`;
    if (n === 0) throw new AppError("Add at least one line item before sending.");
    if (Number(v.total) <= 0) throw new AppError("The quotation total must be greater than zero.");
    const pct = v.payment_terms.reduce((s, t) => s + Number(t.percent), 0);
    if (v.payment_terms.length === 0 || Math.abs(pct - 100) > 0.001) throw new AppError("Payment milestones must add up to 100%.");
    if (v.valid_until < todayISO()) throw new AppError("The expiry date is in the past.");
    // Older open versions are superseded; accepted versions are never touched.
    await tx`update quotation_versions set status = 'superseded'
             where quotation_id = ${v.quotation_id} and id <> ${versionId} and status in ('sent', 'viewed', 'changes_requested', 'expired')`;
    await tx`update quotation_versions set status = 'sent', sent_at = now(), issue_date = current_date where id = ${versionId}`;
    await audit(tx, actor, "quotation.sent", "quotation_version", versionId, v.project_id, { number: v.number, version: v.version_no, total: v.total });
    await notifyProjectClients(tx, actor, v.project_id, {
      type: "quotation_received", title: `New quotation ${v.number}${v.version_no > 1 ? ` (version ${v.version_no})` : ""} is ready for review`,
      link: `/portal/${v.project_id}/quotation`,
    });
    const members = await tx<{ email: string; name: string }[]>`
      select u.email, u.name from project_members m join users u on u.id = m.user_id where m.project_id = ${v.project_id} and u.role = 'client' and u.disabled_at is null`;
    return { v, members };
  });
  const deliveries = [];
  if (opts.sendEmail) {
    for (const m of info.members) {
      deliveries.push(await sendEmail({
        to: m.email, purpose: "quotation_sent", projectId: info.v.project_id,
        subject: `Quotation ${info.v.number} from ${company().name}`,
        text: `Hi ${m.name},\n\nYour quotation ${info.v.number} is ready for review in your project portal:\n${appUrl()}/portal/${info.v.project_id}/quotation\n\nThank you,\n${company().name}`,
      }));
    }
  }
  return { recipients: info.members.length, deliveries };
}

/** Create a new draft version from the latest one. Previous versions (especially accepted ones) are preserved. */
export async function reviseQuotation(actor: Actor, quotationId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [latest] = await tx<QuoteVersion[]>`select * from quotation_versions where quotation_id = ${quotationId} order by version_no desc limit 1`;
    if (!latest) throw notFound("Quotation not found.");
    if (latest.status === "draft") return latest.id;
    const items = await tx<QuoteItem[]>`select * from quotation_items where version_id = ${latest.id} order by position`;
    const validUntil = new Date(Date.now() + 15 * 86400_000).toISOString().slice(0, 10);
    const { id: _id, created_at: _c, sent_at: _s, first_viewed_at: _f, view_count: _vc, responded_at: _r, accepted_at: _a,
      client_response_note: _crn, status: _st, ...rest } = latest as QuoteVersion & Record<string, unknown>;
    const copy = { ...rest } as Record<string, unknown>;
    delete copy.updated_at; delete copy.responded_by;
    const [v] = await tx<{ id: string }[]>`
      insert into quotation_versions ${tx({
        ...copy, version_no: latest.version_no + 1, status: "draft", valid_until: validUntil, created_by: actor.userId,
        client_snapshot: tx.json(latest.client_snapshot as never), payment_terms: tx.json(latest.payment_terms as never),
        included_features: tx.json(latest.included_features as never), exclusions: tx.json(latest.exclusions as never),
      } as never)} returning id`;
    if (items.length) {
      await tx`insert into quotation_items ${tx(items.map((i) => ({
        version_id: v.id, position: i.position, description: i.description, details: i.details, quantity: i.quantity, unit_price: i.unit_price, amount: i.amount,
      })))}`;
    }
    await audit(tx, actor, "quotation.revised", "quotation_version", v.id, latest.project_id, { from_version: latest.version_no, to_version: latest.version_no + 1 });
    return v.id;
  });
}

export async function withdrawVersion(actor: Actor, versionId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const r = await tx`update quotation_versions set status = 'withdrawn' where id = ${versionId} and status in ('sent', 'viewed', 'changes_requested') returning project_id`;
    if (r.count === 0) throw new AppError("Only open quotations can be withdrawn.");
    await audit(tx, actor, "quotation.withdrawn", "quotation_version", versionId, r[0].project_id);
  });
}

export async function deleteDraft(actor: Actor, versionId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [v] = await tx<{ quotation_id: string; project_id: string; status: string }[]>`select quotation_id, project_id, status from quotation_versions where id = ${versionId}`;
    if (!v || v.status !== "draft") throw new AppError("Only drafts can be deleted.");
    await tx`delete from quotation_versions where id = ${versionId}`;
    const [left] = await tx`select 1 from quotation_versions where quotation_id = ${v.quotation_id}`;
    if (!left) await tx`delete from quotations where id = ${v.quotation_id}`;
    await audit(tx, actor, "quotation.draft_deleted", "quotation_version", versionId, v.project_id);
  });
}

export async function listProjectQuotations(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    if (actor.role === "admin") await expireStale(tx, projectId);
    const quotes = await tx<{ id: string; number: string; title: string; created_at: Date }[]>`
      select id, number, title, created_at from quotations where project_id = ${projectId} order by created_at desc`;
    const versions = await tx<QuoteVersion[]>`
      select ${CLIENT_COLUMNS(tx)} from quotation_versions v where v.project_id = ${projectId} order by v.version_no desc`;
    return quotes
      .map((q) => ({ ...q, versions: versions.filter((v) => v.quotation_id === q.id).map((v) => ({ ...v, status: effectiveStatus(v) })) }))
      .filter((q) => q.versions.length > 0);
  });
}

export async function getVersion(actor: Actor, versionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw notFound();
  return withDb(actor, async (tx) => {
    const [v] = await tx<(QuoteVersion & { number: string; title: string })[]>`
      select ${CLIENT_COLUMNS(tx)}, ${actor.role === "admin" ? tx`v.admin_note,` : tx``} q.number, q.title
      from quotation_versions v join quotations q on q.id = v.quotation_id where v.id = ${versionId}`;
    if (!v) throw notFound("Quotation not found.");
    await getProjectFor(tx, actor, v.project_id);
    const items = await tx<QuoteItem[]>`select id, position, description, details, quantity, unit_price, amount from quotation_items where version_id = ${versionId} order by position`;
    const [acceptance] = await tx<{ signer_name: string; accepted_at: Date; content_hash: string; user_name: string; user_email: string; version_no: number; ip: string | null }[]>`
      select a.signer_name, a.accepted_at, a.content_hash, a.version_no, a.ip, u.name as user_name, u.email as user_email
      from quotation_acceptances a join users u on u.id = a.user_id where a.version_id = ${versionId}`;
    return { version: { ...v, status: effectiveStatus(v) }, items, acceptance: acceptance ?? null, hash: contentHash(v.number, v, items) };
  });
}

// ---------------------------------------------------------------------------
// Client actions
// ---------------------------------------------------------------------------
export async function recordQuotationView(actor: Actor, versionId: string) {
  if (actor.role !== "client") return;
  await withDb(actor, async (tx) => {
    const [v] = await tx<{ id: string; status: string; project_id: string; view_count: number }[]>`
      select id, status, project_id, view_count from quotation_versions where id = ${versionId}`;
    if (!v) return;
    await asSystem(tx, actor, async () => {
      await tx`update quotation_versions set view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, now()),
               status = case when status = 'sent' then 'viewed' else status end
               where id = ${versionId} and accepted_at is null`;
    });
    if (v.status === "sent") await audit(tx, actor, "quotation.viewed", "quotation_version", versionId, v.project_id);
  });
}

async function loadForResponse(tx: Tx, actor: Actor, versionId: string) {
  if (actor.role !== "client") throw new AppError("Only the client can respond to a quotation.");
  const [v] = await tx<(QuoteVersion & { number: string })[]>`
    select ${CLIENT_COLUMNS(tx)}, q.number from quotation_versions v join quotations q on q.id = v.quotation_id where v.id = ${versionId}`;
  if (!v) throw notFound("Quotation not found.");
  await getProjectFor(tx, actor, v.project_id);
  const [newer] = await tx`select 1 from quotation_versions where quotation_id = ${v.quotation_id} and version_no > ${v.version_no} and status <> 'draft'`;
  if (newer) throw new AppError("A newer version of this quotation exists. Please review the latest version.");
  if (effectiveStatus(v) === "expired") {
    await asSystem(tx, actor, () => tx`update quotation_versions set status = 'expired' where id = ${versionId} and status in ('sent','viewed')`);
    throw new AppError("This quotation has expired. Please ask Infinity Web & Apps for an updated quotation.");
  }
  if (!["sent", "viewed", "changes_requested"].includes(v.status)) throw new AppError("This quotation is no longer open for a response.");
  return v;
}

const acceptSchema = z.object({
  signer_name: text(200, 2),
  confirm_scope: z.literal(true, { errorMap: () => ({ message: "Please confirm you have reviewed the scope" }) }),
  confirm_terms: z.literal(true, { errorMap: () => ({ message: "Please confirm you agree to the terms" }) }),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function acceptQuotation(actor: Actor, versionId: string, input: unknown, meta: { ip?: string | null; ua?: string | null } = {}) {
  const d = parse(acceptSchema, input);
  return withDb(actor, async (tx) => {
    const v = await loadForResponse(tx, actor, versionId);
    const items = await tx<QuoteItem[]>`select position, description, details, quantity, unit_price, amount from quotation_items where version_id = ${versionId} order by position`;
    const hash = contentHash(v.number, v, items);
    if (hash !== d.content_hash) throw new AppError("This quotation changed while you were reviewing it. Please reload and review it again.");
    const snapshot = { ...v, number: v.number, items };
    await asSystem(tx, actor, async () => {
      await tx`insert into quotation_acceptances (version_id, quotation_id, project_id, user_id, version_no, signer_name, total, currency, content_hash, terms_snapshot, ip, user_agent)
               values (${versionId}, ${v.quotation_id}, ${v.project_id}, ${actor.userId}, ${v.version_no}, ${d.signer_name}, ${v.total}, ${v.currency},
                       ${hash}, ${tx.json(snapshot as never)}, ${meta.ip ?? null}, ${meta.ua?.slice(0, 300) ?? null})`;
      await tx`update quotation_versions set status = 'accepted', accepted_at = now(), responded_at = now(), responded_by = ${actor.userId} where id = ${versionId}`;
      await tx`update projects set status = 'quotation_accepted', current_stage = 'Quotation accepted — awaiting project commencement'
               where id = ${v.project_id} and status in ('proposal', 'on_hold')`;
    });
    await audit(tx, actor, "quotation.accepted", "quotation_version", versionId, v.project_id,
      { number: v.number, version: v.version_no, total: v.total, signer: d.signer_name, hash }, meta.ip);
    await notifyAdmins(tx, actor, {
      type: "quotation_accepted", projectId: v.project_id, link: `/admin/projects/${v.project_id}`,
      title: `${actor.name} accepted quotation ${v.number} (v${v.version_no})`,
    });
    return { hash };
  });
}

export async function requestQuotationChanges(actor: Actor, versionId: string, input: unknown) {
  const d = parse(z.object({ note: text(5000) }), input);
  return withDb(actor, async (tx) => {
    const v = await loadForResponse(tx, actor, versionId);
    await asSystem(tx, actor, () => tx`
      update quotation_versions set status = 'changes_requested', client_response_note = ${d.note}, responded_at = now(), responded_by = ${actor.userId}
      where id = ${versionId}`);
    await tx`insert into comments (project_id, target_type, target_id, author_id, body)
             values (${v.project_id}, 'quotation', ${v.quotation_id}, ${actor.userId}, ${`Change request for v${v.version_no}: ${d.note}`})`;
    await audit(tx, actor, "quotation.changes_requested", "quotation_version", versionId, v.project_id, { note: d.note });
    await notifyAdmins(tx, actor, { type: "quotation_changes", projectId: v.project_id, link: `/admin/projects/${v.project_id}/quotations/${v.quotation_id}`,
      title: `${actor.name} requested changes to ${v.number}`, body: d.note });
  });
}

export async function rejectQuotation(actor: Actor, versionId: string, input: unknown) {
  const d = parse(z.object({ reason: optText(5000) }), input);
  return withDb(actor, async (tx) => {
    const v = await loadForResponse(tx, actor, versionId);
    await asSystem(tx, actor, () => tx`
      update quotation_versions set status = 'rejected', client_response_note = ${d.reason}, responded_at = now(), responded_by = ${actor.userId}
      where id = ${versionId}`);
    await audit(tx, actor, "quotation.rejected", "quotation_version", versionId, v.project_id, { reason: d.reason });
    await notifyAdmins(tx, actor, { type: "quotation_rejected", projectId: v.project_id, link: `/admin/projects/${v.project_id}/quotations/${v.quotation_id}`,
      title: `${actor.name} declined quotation ${v.number}`, body: d.reason });
  });
}

/** The latest accepted version for a project (the commercial baseline). */
export async function acceptedVersion(tx: Tx, projectId: string) {
  const [v] = await tx<(QuoteVersion & { number: string })[]>`
    select ${CLIENT_COLUMNS(tx)}, q.number from quotation_versions v join quotations q on q.id = v.quotation_id
    where v.project_id = ${projectId} and v.status = 'accepted' order by v.accepted_at desc limit 1`;
  return v ?? null;
}
