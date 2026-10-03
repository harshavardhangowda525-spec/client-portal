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

export async function sendEmail(opts: {
  to: string; subject: string; text: string; html?: string; purpose: string; projectId?: string | null;
}): Promise<DeliveryResult> {
  let result: DeliveryResult;
  if (!integrations().email) {
    result = { status: "not_configured" };
  } else {
    try {
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      });
      await transport.sendMail({ from: process.env.SMTP_FROM, to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
      result = { status: "sent" };
    } catch (e) {
      result = { status: "failed", error: (e as Error).message.slice(0, 500) };
    }
  }
  await log("email", opts.to, opts.purpose, opts.subject, result, opts.projectId);
  return result;
}

/** WhatsApp Cloud API, using an approved template with one body parameter. */
export async function sendWhatsApp(opts: { to: string; text: string; purpose: string; projectId?: string | null }): Promise<DeliveryResult> {
  let result: DeliveryResult;
  const to = opts.to.replace(/[^\d]/g, "");
  if (!integrations().whatsapp) {
    result = { status: "not_configured" };
  } else if (to.length < 10) {
    result = { status: "failed", error: "Invalid phone number" };
  } else {
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to, type: "template",
          template: {
            name: process.env.WHATSAPP_TEMPLATE_NAME, language: { code: "en" },
            components: [{ type: "body", parameters: [{ type: "text", text: opts.text.slice(0, 1000) }] }],
          },
        }),
      });
      result = res.ok ? { status: "sent" } : { status: "failed", error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
    } catch (e) {
      result = { status: "failed", error: (e as Error).message.slice(0, 500) };
    }
  }
  await log("whatsapp", to, opts.purpose, null, result, opts.projectId);
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
