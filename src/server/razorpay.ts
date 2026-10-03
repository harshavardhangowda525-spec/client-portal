import { withDb, SYSTEM, getProjectFor, type Actor } from "./core";
import { recordVerifiedOnlinePayment } from "./billing";
import { AppError, notFound } from "@/lib/errors";
import { hmacSha256Hex, safeEqualHex } from "@/lib/crypto";
import { integrations } from "@/lib/config";
import { fromPaise, toPaise } from "@/lib/money";

const API = "https://api.razorpay.com/v1";
const authHeader = () => `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, secret = process.env.RAZORPAY_KEY_SECRET ?? "") {
  if (!secret) return false;
  return safeEqualHex(hmacSha256Hex(secret, `${orderId}|${paymentId}`), signature);
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "") {
  if (!secret || !signature) return false;
  return safeEqualHex(hmacSha256Hex(secret, rawBody), signature);
}

/** Create a Razorpay order for an invoice's outstanding balance. */
export async function createOrder(actor: Actor, invoiceId: string) {
  if (!integrations().razorpay) throw new AppError("Online payments are not enabled yet.");
  const inv = await withDb(actor, async (tx) => {
    const [i] = await tx<{ id: string; project_id: string; number: string; amount: number; currency: string; status: string }[]>`
      select id, project_id, number, amount, currency, status from invoices where id = ${invoiceId}`;
    if (!i) throw notFound("Invoice not found.");
    await getProjectFor(tx, actor, i.project_id);
    if (!["issued", "partially_paid"].includes(i.status)) throw new AppError("This invoice is not payable.");
    const [{ paid }] = await tx<{ paid: number }[]>`select coalesce(sum(amount), 0) as paid from payments where invoice_id = ${invoiceId} and status = 'confirmed'`;
    return { ...i, balance: fromPaise(toPaise(i.amount) - toPaise(Number(paid))) };
  });
  if (inv.balance <= 0) throw new AppError("This invoice is already paid.");
  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: toPaise(inv.balance), currency: inv.currency, receipt: inv.number, notes: { invoice_id: inv.id, project_id: inv.project_id } }),
  });
  if (!res.ok) throw new AppError("Could not start the online payment. Please try again later.");
  const order = (await res.json()) as { id: string; amount: number; currency: string };
  await withDb(SYSTEM, (tx) => tx`insert into payment_orders (project_id, invoice_id, provider_order_id, amount, currency, created_by)
    values (${inv.project_id}, ${inv.id}, ${order.id}, ${inv.balance}, ${inv.currency}, ${actor.userId})`);
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID!, invoiceNumber: inv.number };
}

/**
 * Verify a checkout result server-side: check the HMAC signature, then fetch the
 * payment from Razorpay and confirm it is captured for the right order and amount.
 */
export async function verifyPayment(actor: Actor, input: { orderId: string; paymentId: string; signature: string }) {
  if (!integrations().razorpay) throw new AppError("Online payments are not enabled.");
  if (!verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) throw new AppError("Payment verification failed.");
  const order = await withDb(actor, async (tx) => {
    const [o] = await withDb(SYSTEM, (s) => s<{ project_id: string; invoice_id: string; amount: number; currency: string }[]>`
      select project_id, invoice_id, amount, currency from payment_orders where provider_order_id = ${input.orderId}`);
    if (!o) throw new AppError("Unknown payment order.");
    await getProjectFor(tx, actor, o.project_id);
    return o;
  });
  return settle(input.orderId, input.paymentId, order);
}

async function settle(orderId: string, paymentId: string, order: { project_id: string; invoice_id: string; amount: number; currency: string }) {
  const res = await fetch(`${API}/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new AppError("Could not verify the payment with the provider.");
  const p = (await res.json()) as { id: string; order_id: string; status: string; amount: number; currency: string; method: string };
  if (p.order_id !== orderId || p.status !== "captured" || p.amount !== toPaise(order.amount) || p.currency !== order.currency) {
    throw new AppError("The payment has not been captured yet. It will be confirmed once the provider settles it.");
  }
  return withDb(SYSTEM, (tx) => recordVerifiedOnlinePayment(tx, {
    projectId: order.project_id, invoiceId: order.invoice_id, amount: fromPaise(p.amount), currency: p.currency,
    orderId, paymentId: p.id, method: p.method,
  }));
}

/** Webhook (payment.captured / order.paid). Signature is verified before anything is trusted. */
export async function handleWebhook(rawBody: string, signature: string) {
  if (!verifyWebhookSignature(rawBody, signature)) return { ok: false, status: 401 };
  const event = JSON.parse(rawBody) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string } } } };
  const entity = event.payload?.payment?.entity;
  if (!entity || !["payment.captured", "order.paid"].includes(event.event)) return { ok: true, status: 200 };
  const [o] = await withDb(SYSTEM, (s) => s<{ project_id: string; invoice_id: string; amount: number; currency: string }[]>`
    select project_id, invoice_id, amount, currency from payment_orders where provider_order_id = ${entity.order_id}`);
  if (!o) return { ok: true, status: 200 };
  await settle(entity.order_id, entity.id, o);
  return { ok: true, status: 200 };
}
