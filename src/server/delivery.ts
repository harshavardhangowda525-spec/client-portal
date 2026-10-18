import nodemailer from "nodemailer";
import { withDb, SYSTEM } from "./core";
import { integrations } from "@/lib/config";

export type DeliveryResult = { status: "sent" | "failed" | "not_configured"; error?: string };

async function log(channel: "email" | "whatsapp", recipient: string, purpose: string, subject: string | null,
  result: DeliveryResult, projectId?: string | null) {
  await withDb(SYSTEM, (tx) => tx`
    insert into message_deliveries (channel, recipient, subject, purpose, status, error, project_id)
    values (${channel}, ${recipient}, ${subject}, ${purpose}, ${result.status}, ${result.error ?? null}, ${projectId ?? null})`);
}

/** Send an email over SMTP without logging (callers decide how to record the attempt). */
export async function deliverEmail(opts: { to: string; subject: string; text: string; html?: string }): Promise<DeliveryResult> {
  if (!integrations().email) return { status: "not_configured" };
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      tls: process.env.SMTP_ALLOW_SELF_SIGNED === "true" ? { rejectUnauthorized: false } : undefined,
    });
    await transport.sendMail({ from: process.env.SMTP_FROM, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
    return { status: "sent" };
  } catch (e) {
    return { status: "failed", error: (e as Error).message.slice(0, 500) };
  }
}

export async function sendEmail(opts: {
  to: string; subject: string; text: string; html?: string; purpose: string; projectId?: string | null;
}): Promise<DeliveryResult> {
  const result = await deliverEmail(opts);
  await log("email", opts.to, opts.purpose, opts.subject, result, opts.projectId);
  return result;
}

/** WhatsApp template parameters may not contain newlines, tabs or more than four consecutive spaces. */
export function whatsappParam(text: string): string {
  return text.replace(/\s*\n+\s*/g, " · ").replace(/\t/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1000);
}

export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

/**
 * WhatsApp Cloud API (official WhatsApp Business Platform), using an approved template with one body
 * parameter. Business-initiated messages must use approved templates.
 */
export async function deliverWhatsApp(opts: { to: string; text: string; template?: string | null; language?: string | null }): Promise<DeliveryResult> {
  const to = normalizePhone(opts.to);
  const template = opts.template || process.env.WHATSAPP_TEMPLATE_NAME;
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !template) return { status: "not_configured" };
  if (to.length < 11) return { status: "failed", error: "Invalid phone number" };
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: {
          name: template, language: { code: opts.language || "en" },
          components: [{ type: "body", parameters: [{ type: "text", text: whatsappParam(opts.text) }] }],
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? { status: "sent" } : { status: "failed", error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
  } catch (e) {
    return { status: "failed", error: (e as Error).message.slice(0, 500) };
  }
}

export async function sendWhatsApp(opts: { to: string; text: string; purpose: string; projectId?: string | null }): Promise<DeliveryResult> {
  const result = await deliverWhatsApp(opts);
  await log("whatsapp", normalizePhone(opts.to), opts.purpose, null, result, opts.projectId);
  return result;
}

/** A wa.me share link the admin can open themselves — not an automated delivery. */
export function whatsappShareLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
