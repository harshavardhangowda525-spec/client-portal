import { z } from "zod";
import { withDb, assertAdmin, audit, getProjectFor, nextNumber, type Actor, type Tx } from "./core";
import { parse, text, optText, optDate, date, uuid } from "./validate";
import { notifyProjectClients } from "./notify";
import { acceptedVersion } from "./quotations";
import { acceptedProposalForProject } from "./proposals";
import { AppError, notFound } from "@/lib/errors";
import { fromPaise, toPaise } from "@/lib/money";
import { todayISO } from "@/lib/progress";

export type Invoice = {
  id: string; project_id: string; number: string; title: string; description: string | null; payment_term_label: string | null;
  amount: number; currency: string; status: string; issue_date: string | null; due_date: string | null; created_at: Date;
  paid: number; balance: number; overdue: boolean;
};
export type Payment = {
  id: string; invoice_id: string | null; invoice_number: string | null; receipt_number: string | null; amount: number; currency: string;
  method: string; status: string; paid_on: string | null; reference: string | null; notes: string | null; source: string;
  confirmed_at: Date | null; created_at: Date;
};

type Baseline = {
  source: "quotation" | "proposal"; id: string; number: string; version_no: number; total: number; currency: string;
  payment_terms: { label: string; percent: number; due: string; amount: number }[];
};

/** The agreed commercial terms for a project: the accepted quotation, or else the accepted proposal. */
async function acceptedBaseline(tx: Tx, projectId: string): Promise<Baseline | null> {
  const q = await acceptedVersion(tx, projectId);
  if (q) {
    return { source: "quotation", id: q.id, number: q.number, version_no: q.version_no, total: Number(q.total), currency: q.currency,
      payment_terms: q.payment_terms.map((t) => ({ label: t.label, percent: Number(t.percent), due: t.due, amount: Number(t.amount ?? 0) })) };
  }
  const p = await acceptedProposalForProject(tx, projectId);
  if (!p) return null;
  const total = Number(p.total);
  return { source: "proposal", id: p.id, number: p.number, version_no: p.version_no, total, currency: p.currency,
    payment_terms: p.milestones.map((m) => ({ label: m.label, percent: total > 0 ? Math.round((Number(m.amount) / total) * 10000) / 100 : 0, due: m.due ?? "", amount: Number(m.amount) })) };
}

async function recomputeInvoice(tx: Tx, invoiceId: string) {
  await tx`update invoices i set status = case
             when i.status in ('draft', 'void') then i.status
             when coalesce(p.paid, 0) >= i.amount then 'paid'
             when coalesce(p.paid, 0) > 0 then 'partially_paid'
             else 'issued' end
           from (select sum(amount) as paid from payments where invoice_id = ${invoiceId} and status = 'confirmed') p
           where i.id = ${invoiceId}`;
}

export async function getBilling(actor: Actor, projectId: string) {
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const quote = await acceptedBaseline(tx, projectId);
    const today = todayISO();
    const invoiceRows = await tx<Omit<Invoice, "paid" | "balance" | "overdue">[]>`
      select * from invoices where project_id = ${projectId} order by created_at`;
    // Clients only ever see confirmed payments (enforced by RLS).
    const payments = await tx<Payment[]>`
      select p.*, i.number as invoice_number from payments p left join invoices i on i.id = p.invoice_id
      where p.project_id = ${projectId} order by coalesce(p.paid_on, p.created_at::date) desc, p.created_at desc`;
    const confirmed = payments.filter((p) => p.status === "confirmed");
    const invoices: Invoice[] = invoiceRows.map((i) => {
      const paid = fromPaise(confirmed.filter((p) => p.invoice_id === i.id).reduce((s, p) => s + toPaise(p.amount), 0));
      const balance = Math.max(0, fromPaise(toPaise(i.amount) - toPaise(paid)));
      return { ...i, paid, balance, overdue: ["issued", "partially_paid"].includes(i.status) && !!i.due_date && i.due_date < today && balance > 0 };
    });
    const paidTotal = fromPaise(confirmed.reduce((s, p) => s + toPaise(p.amount), 0)
      - payments.filter((p) => p.status === "refunded").reduce((s, p) => s + toPaise(p.amount), 0));
    const contractTotal = quote ? Number(quote.total) : null;
    const terms = quote?.payment_terms ?? [];
    return {
      quotation: quote ? { id: quote.id, source: quote.source, number: quote.number, version_no: quote.version_no, total: Number(quote.total), currency: quote.currency } : null,
      advanceRequired: terms[0]?.amount ?? null,
      advanceLabel: terms[0]?.label ?? null,
      terms: terms.map((t) => ({ ...t, invoice: invoices.find((i) => i.payment_term_label === t.label && i.status !== "void") ?? null })),
      invoices: actor.role === "client" ? invoices.filter((i) => i.status !== "draft") : invoices,
      payments,
      paidTotal,
      contractTotal,
      remaining: contractTotal == null ? null : Math.max(0, fromPaise(toPaise(contractTotal) - toPaise(paidTotal))),
      outstandingInvoiced: fromPaise(invoices.filter((i) => ["issued", "partially_paid"].includes(i.status)).reduce((s, i) => s + toPaise(i.balance), 0)),
      overdueInvoices: invoices.filter((i) => i.overdue),
    };
  });
}

const invoiceSchema = z.object({
  title: text(200),
  description: optText(5000),
  amount: z.coerce.number().positive("must be greater than zero").max(999_999_999),
  due_date: optDate,
  payment_term_label: optText(100),
});

export async function createInvoice(actor: Actor, projectId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(invoiceSchema, input);
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const base = await acceptedBaseline(tx, projectId);
    const number = await nextNumber(tx, "INV");
    const [i] = await tx<{ id: string }[]>`
      insert into invoices ${tx({ ...d, project_id: projectId, number, currency: base?.currency ?? "INR", created_by: actor.userId,
        quotation_version_id: base?.source === "quotation" ? base.id : null, proposal_version_id: base?.source === "proposal" ? base.id : null })}
      returning id`;
    await audit(tx, actor, "invoice.created", "invoice", i.id, projectId, { number, amount: d.amount });
    return i.id;
  });
}

/** Draft an invoice for one payment milestone of the accepted quotation. */
export async function createInvoiceFromTerm(actor: Actor, projectId: string, termIndex: number, dueDate?: string | null) {
  assertAdmin(actor);
  const due = parse(optDate, dueDate ?? null);
  const term = await withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    const quote = await acceptedBaseline(tx, projectId);
    if (!quote) throw new AppError("There is no accepted quotation or proposal for this project yet.");
    const t = quote.payment_terms[termIndex];
    if (!t || !t.amount) throw new AppError("Payment milestone not found.");
    const [exists] = await tx`select number from invoices where project_id = ${projectId} and payment_term_label = ${t.label} and status <> 'void'`;
    if (exists) throw new AppError(`An invoice (${exists.number}) already exists for "${t.label}".`);
    return { t, quote };
  });
  return createInvoice(actor, projectId, {
    title: `${term.t.label} — ${term.quote.number}`,
    description: `${term.t.percent}% of ${term.quote.source} ${term.quote.number} (v${term.quote.version_no}).${term.t.due ? ` Due: ${term.t.due}.` : ""}`,
    amount: term.t.amount, due_date: due, payment_term_label: term.t.label,
  });
}

export async function issueInvoice(actor: Actor, invoiceId: string, dueDate?: string | null) {
  assertAdmin(actor);
  const due = parse(optDate, dueDate ?? null);
  return withDb(actor, async (tx) => {
    const [i] = await tx<{ id: string; project_id: string; number: string; status: string; amount: number }[]>`select * from invoices where id = ${invoiceId}`;
    if (!i) throw notFound("Invoice not found.");
    if (i.status !== "draft") throw new AppError("Only draft invoices can be issued.");
    await tx`update invoices set status = 'issued', issued_at = now(), issue_date = current_date, due_date = coalesce(${due}, due_date) where id = ${invoiceId}`;
    await recomputeInvoice(tx, invoiceId);
    await audit(tx, actor, "invoice.issued", "invoice", invoiceId, i.project_id, { number: i.number, amount: i.amount });
    await notifyProjectClients(tx, actor, i.project_id, { type: "invoice_issued", title: `Invoice ${i.number} has been issued`, link: `/portal/${i.project_id}/payments` });
  });
}

export async function voidInvoice(actor: Actor, invoiceId: string) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [paid] = await tx`select 1 from payments where invoice_id = ${invoiceId} and status = 'confirmed'`;
    if (paid) throw new AppError("This invoice has confirmed payments and cannot be voided.");
    const r = await tx`update invoices set status = 'void' where id = ${invoiceId} and status <> 'void' returning project_id, number`;
    if (r.count === 0) throw notFound();
    await audit(tx, actor, "invoice.voided", "invoice", invoiceId, r[0].project_id, { number: r[0].number });
  });
}

const paymentSchema = z.object({
  invoice_id: z.string().optional().nullable().transform((v) => v || null).pipe(uuid.nullable()),
  amount: z.coerce.number().positive("must be greater than zero").max(999_999_999),
  method: z.enum(["bank_transfer", "upi", "cash", "cheque", "card_offline", "other"]),
  paid_on: date,
  reference: optText(200),
  notes: optText(2000),
  status: z.enum(["pending", "confirmed"]),
});

/** Manual payment recording by an admin. Online (Razorpay) payments are only created after provider verification. */
export async function recordPayment(actor: Actor, projectId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(paymentSchema, input);
  if (d.paid_on > todayISO()) throw new AppError("Payment date cannot be in the future.");
  return withDb(actor, async (tx) => {
    await getProjectFor(tx, actor, projectId);
    if (d.invoice_id) {
      const [inv] = await tx<{ status: string }[]>`select status from invoices where id = ${d.invoice_id} and project_id = ${projectId}`;
      if (!inv) throw new AppError("Invoice does not belong to this project.");
      if (inv.status === "void" || inv.status === "draft") throw new AppError("Payments can only be recorded against issued invoices.");
    }
    const receipt = d.status === "confirmed" ? await nextNumber(tx, "RCPT") : null;
    const [p] = await tx<{ id: string }[]>`
      insert into payments ${tx({ ...d, project_id: projectId, source: "manual", recorded_by: actor.userId, receipt_number: receipt,
        confirmed_by: d.status === "confirmed" ? actor.userId : null, confirmed_at: d.status === "confirmed" ? new Date() : null })}
      returning id`;
    if (d.invoice_id) await recomputeInvoice(tx, d.invoice_id);
    await audit(tx, actor, "payment.recorded", "payment", p.id, projectId, { amount: d.amount, method: d.method, status: d.status, reference: d.reference });
    if (d.status === "confirmed") await paymentConfirmedNotice(tx, actor, projectId, d.amount);
    return p.id;
  });
}

async function paymentConfirmedNotice(tx: Tx, actor: Actor | null, projectId: string, amount: number) {
  await notifyProjectClients(tx, actor, projectId, {
    type: "payment_confirmed", title: `Payment of ₹${amount.toLocaleString("en-IN")} confirmed`, link: `/portal/${projectId}/payments`,
  });
}

export async function setPaymentStatus(actor: Actor, paymentId: string, status: "confirmed" | "failed" | "refunded") {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const [p] = await tx<{ id: string; project_id: string; invoice_id: string | null; status: string; amount: number; source: string; verified_at: Date | null }[]>`
      select * from payments where id = ${paymentId}`;
    if (!p) throw notFound("Payment not found.");
    const allowed: Record<string, string[]> = { pending: ["confirmed", "failed"], confirmed: ["refunded"], failed: [], refunded: [] };
    if (!allowed[p.status]?.includes(status)) throw new AppError(`A ${p.status} payment cannot be marked ${status}.`);
    if (status === "confirmed" && p.source !== "manual" && !p.verified_at) throw new AppError("Online payments are confirmed only by provider verification.");
    const receipt = status === "confirmed" ? await nextNumber(tx, "RCPT") : null;
    await tx`update payments set status = ${status},
               receipt_number = coalesce(receipt_number, ${receipt}),
               confirmed_by = case when ${status} = 'confirmed' then ${actor.userId}::uuid else confirmed_by end,
               confirmed_at = case when ${status} = 'confirmed' then now() else confirmed_at end
             where id = ${paymentId}`;
    if (p.invoice_id) await recomputeInvoice(tx, p.invoice_id);
    await audit(tx, actor, `payment.${status}`, "payment", paymentId, p.project_id, { amount: p.amount, from: p.status });
    if (status === "confirmed") await paymentConfirmedNotice(tx, actor, p.project_id, Number(p.amount));
  });
}

export async function getInvoice(actor: Actor, invoiceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) throw notFound();
  return withDb(actor, async (tx) => {
    const [i] = await tx<Omit<Invoice, "paid" | "balance" | "overdue">[]>`select * from invoices where id = ${invoiceId}`;
    if (!i) throw notFound("Invoice not found.");
    const project = await getProjectFor(tx, actor, i.project_id);
    const [client] = await tx`select business_name, owner_name, email, phone, address from client_profiles where id = ${project.client_id}`;
    const payments = await tx<Payment[]>`select * from payments where invoice_id = ${invoiceId} and status = 'confirmed' order by paid_on`;
    const paid = fromPaise(payments.reduce((s, p) => s + toPaise(p.amount), 0));
    return { invoice: i, project, client, payments, paid, balance: Math.max(0, fromPaise(toPaise(i.amount) - toPaise(paid))) };
  });
}

export async function getPayment(actor: Actor, paymentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) throw notFound();
  return withDb(actor, async (tx) => {
    const [p] = await tx<(Payment & { project_id: string })[]>`
      select p.*, i.number as invoice_number from payments p left join invoices i on i.id = p.invoice_id where p.id = ${paymentId}`;
    if (!p) throw notFound("Payment not found.");
    const project = await getProjectFor(tx, actor, p.project_id);
    const [client] = await tx`select business_name, owner_name, email, phone, address from client_profiles where id = ${project.client_id}`;
    return { payment: p, project, client };
  });
}

// Used by the Razorpay module after server-side verification.
export async function recordVerifiedOnlinePayment(tx: Tx, args: {
  projectId: string; invoiceId: string; amount: number; currency: string; orderId: string; paymentId: string; method: string;
}) {
  const [existing] = await tx`select id from payments where provider_payment_id = ${args.paymentId}`;
  if (existing) return existing.id as string;
  const receipt = await nextNumber(tx, "RCPT");
  const [p] = await tx<{ id: string }[]>`
    insert into payments (project_id, invoice_id, receipt_number, amount, currency, method, status, paid_on, reference, source,
                          provider_order_id, provider_payment_id, verified_at, confirmed_at)
    values (${args.projectId}, ${args.invoiceId}, ${receipt}, ${args.amount}, ${args.currency}, 'razorpay', 'confirmed', current_date,
            ${args.paymentId}, 'razorpay', ${args.orderId}, ${args.paymentId}, now(), now())
    returning id`;
  await tx`update payment_orders set status = 'paid' where provider_order_id = ${args.orderId}`;
  await recomputeInvoice(tx, args.invoiceId);
  await audit(tx, null, "payment.verified_online", "payment", p.id, args.projectId, { amount: args.amount, order: args.orderId, payment: args.paymentId, method: args.method });
  await paymentConfirmedNotice(tx, null, args.projectId, args.amount);
  return p.id;
}
