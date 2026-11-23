import { z } from "zod";
import { withDb, SYSTEM, asSystem, audit, type Actor } from "./core";
import { parse } from "./validate";
import { sendWhatsApp } from "./delivery";
import { forbidden, AppError } from "@/lib/errors";

/**
 * Client notification preferences. Email covers optional updates (new app builds, meeting confirmations, referral
 * news); invoices, proposals, account and security emails are always sent. WhatsApp needs the client's explicit
 * consent and a configured WhatsApp Business API; until then nothing is sent and the page says so.
 */
export const whatsappConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME);

export async function getPreferences(actor: Actor) {
  if (actor.role !== "client" || !actor.clientId) throw forbidden();
  const [p] = await withDb(actor, (tx) => asSystem(tx, actor, () => tx<{ notify_email: boolean; notify_whatsapp: boolean; whatsapp_consent_at: Date | null; phone: string | null; email: string }[]>`
    select notify_email, notify_whatsapp, whatsapp_consent_at, phone, email from client_profiles where id = ${actor.clientId!}`));
  return { ...p, whatsappAvailable: whatsappConfigured() };
}

const schema = z.object({ notify_email: z.boolean(), notify_whatsapp: z.boolean(), whatsapp_consent: z.boolean() });

export async function savePreferences(actor: Actor, input: unknown) {
  if (actor.role !== "client" || !actor.clientId) throw forbidden();
  const d = parse(schema, input);
  if (d.notify_whatsapp && !d.whatsapp_consent) throw new AppError("Please confirm you agree to receive WhatsApp messages.", "invalid");
  await withDb(actor, async (tx) => {
    await asSystem(tx, actor, async () => {
      const [c] = await tx<{ phone: string | null }[]>`select phone from client_profiles where id = ${actor.clientId!}`;
      if (d.notify_whatsapp && !c?.phone) throw new AppError("Add a phone number to your profile first (ask our team to update it).", "invalid");
      await tx`update client_profiles set notify_email = ${d.notify_email}, notify_whatsapp = ${d.notify_whatsapp},
               whatsapp_consent_at = case when ${d.notify_whatsapp} then coalesce(whatsapp_consent_at, now()) else null end where id = ${actor.clientId!}`;
    });
    await audit(tx, actor, "client.preferences_updated", "client", actor.clientId!, null, { email: d.notify_email, whatsapp: d.notify_whatsapp });
  });
}

/** Optional WhatsApp nudge for a project's clients (only with consent + a configured provider). Never throws. */
export async function whatsappNudge(projectId: string, text: string) {
  if (!whatsappConfigured()) return;
  try {
    const rows = await withDb(SYSTEM, (tx) => tx<{ phone: string }[]>`
      select c.phone from projects p join client_profiles c on c.id = p.client_id
      where p.id = ${projectId} and c.notify_whatsapp and c.whatsapp_consent_at is not null and c.phone is not null`);
    for (const r of rows) await sendWhatsApp({ to: r.phone, text, purpose: "client_update", projectId });
  } catch (e) { console.error("[whatsapp nudge]", e); }
}
