import { z } from "zod";
import { withDb, SYSTEM, assertAdmin, audit, asSystem, nextNumber, getProjectFor, type Actor, type Tx } from "./core";
import { parse, text, optText, optDate, date } from "./validate";
import { deliverEmail, deliverWhatsApp, escapeHtml, type DeliveryResult } from "./delivery";
import { notifyAdmins, notifyProjectClients } from "./notify";
import { getBusiness, getTaxConfig } from "./pricing";
import { AppError, notFound } from "@/lib/errors";
import { addDays, addMonths, daysBetween, istDate, istToday } from "@/lib/dates";
import { appUrl, integrations } from "@/lib/config";
import { formatMoney, fromPaise, toPaise } from "@/lib/money";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const MAINTENANCE_STATUSES = [
  "FREE_MAINTENANCE_ACTIVE", "EXPIRING_SOON", "FREE_MAINTENANCE_EXPIRED", "AWAITING_CLIENT_CONFIRMATION",
  "PAID_MAINTENANCE_ACTIVE", "PAYMENT_OVERDUE", "MAINTENANCE_CANCELLED",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export type Template = { subject: string; body: string };
export type MaintenanceSettings = {
  trigger: "proposal_initiated" | "proposal_accepted" | "project_delivered";
  free_months: number; default_fee: number; expiring_soon_days: number; reminder_days: number[];
  billing_reminder_days: number; catch_up_days: number; retry_max_attempts: number; retry_delay_hours: number;
  admin_email: string; admin_whatsapp: string; whatsapp_template: string; whatsapp_language: string;
  included: string[]; hosting_line: string; excluded: string[]; cancellation_terms: string; payment_terms: string;
  templates: Partial<Record<NotificationKind, Partial<Template>>>;
};
export type PaymentDetails = { upi_id: string; payee_name: string; account_holder: string; account_number: string; ifsc: string; bank_name: string; branch: string; instructions: string };

const DEFAULT_SETTINGS: MaintenanceSettings = {
  trigger: "proposal_initiated", free_months: 6, default_fee: 500, expiring_soon_days: 30, reminder_days: [30, 7],
  billing_reminder_days: 3, catch_up_days: 2, retry_max_attempts: 3, retry_delay_hours: 6, admin_email: "", admin_whatsapp: "",
  whatsapp_template: "", whatsapp_language: "en",
  included: ["Minor bug fixes", "Minor technical glitches", "Routine maintenance of the agreed project"],
  hosting_line: "Hosting and domain renewal costs covered by the maintenance agreement",
  excluded: ["Major redesigns", "New features", "New integrations", "Significant backend redevelopment", "Work outside the agreed maintenance scope"],
  cancellation_terms: "You can cancel at any time from your client portal. Cancelling stops future monthly invoices; months already invoiced remain payable.",
  payment_terms: "Each month an invoice is issued a few days before the billing date and is due on the billing date.",
  templates: {},
};

export async function getMaintenanceSettings(tx?: Tx): Promise<MaintenanceSettings> {
  const run = async (t: Tx) => {
    const [r] = await t<{ value: Partial<MaintenanceSettings> }[]>`select value from app_settings where key = 'maintenance'`;
    return { ...DEFAULT_SETTINGS, ...(r?.value ?? {}) };
  };
  return tx ? run(tx) : withDb(SYSTEM, run);
}

const lines = z.union([z.array(z.string()), z.string()]).transform((v) => (Array.isArray(v) ? v : v.split("\n")).map((x) => x.trim()).filter(Boolean).slice(0, 30));
const settingsSchema = z.object({
  trigger: z.enum(["proposal_initiated", "proposal_accepted", "project_delivered"]),
  free_months: z.coerce.number().int().min(1).max(60),
  default_fee: z.coerce.number().min(0).max(999_999),
  expiring_soon_days: z.coerce.number().int().min(1).max(120),
  reminder_days: z.union([z.array(z.coerce.number()), z.string()]).transform((v) => (Array.isArray(v) ? v : v.split(/[,\s]+/)).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 120))
    .transform((a) => [...new Set(a)].sort((x, y) => y - x)),
  billing_reminder_days: z.coerce.number().int().min(0).max(30),
  catch_up_days: z.coerce.number().int().min(0).max(14),
  retry_max_attempts: z.coerce.number().int().min(1).max(10),
  retry_delay_hours: z.coerce.number().min(0.25).max(168),
  admin_email: z.string().trim().max(320).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "is not a valid email"),
  admin_whatsapp: z.string().trim().max(40),
  whatsapp_template: z.string().trim().max(200),
  whatsapp_language: z.string().trim().max(20).default("en"),
  included: lines, hosting_line: z.string().trim().max(300), excluded: lines,
  cancellation_terms: z.string().trim().max(3000), payment_terms: z.string().trim().max(3000),
  templates: z.record(z.string(), z.object({ subject: z.string().max(300).optional(), body: z.string().max(5000).optional() })).default({}),
});

export async function saveMaintenanceSettings(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const d = parse(settingsSchema, input);
  return withDb(actor, async (tx) => {
    await tx`insert into app_settings (key, value) values ('maintenance', ${tx.json(d as never)})
             on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await audit(tx, actor, "maintenance.settings_updated", "settings", "maintenance", null, { trigger: d.trigger, free_months: d.free_months, default_fee: d.default_fee });
  });
}

export async function getPaymentDetails(): Promise<PaymentDetails> {
  return withDb(SYSTEM, async (tx) => {
    const [r] = await tx<{ value: Partial<PaymentDetails> }[]>`select value from app_settings where key = 'payment_details'`;
    return { upi_id: "", payee_name: "", account_holder: "", account_number: "", ifsc: "", bank_name: "", branch: "", instructions: "", ...(r?.value ?? {}) };
  });
}

const paymentDetailsSchema = z.object({
  upi_id: z.string().trim().max(256).refine((v) => !v || /^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/.test(v), "is not a valid UPI ID (e.g. name@okicici)"),
  payee_name: z.string().trim().max(100),
  account_holder: z.string().trim().max(100),
  account_number: z.string().trim().max(30).refine((v) => !v || /^\d{6,20}$/.test(v), "must be 6–20 digits"),
  ifsc: z.string().trim().toUpperCase().max(11).refine((v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "is not a valid IFSC (e.g. HDFC0001234)"),
  bank_name: z.string().trim().max(100), branch: z.string().trim().max(100), instructions: z.string().trim().max(1000),
}).refine((d) => !d.upi_id || d.payee_name, { message: "Payee name is required with a UPI ID", path: ["payee_name"] });

export async function savePaymentDetails(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const d = parse(paymentDetailsSchema, input);
  return withDb(actor, async (tx) => {
    await tx`insert into app_settings (key, value) values ('payment_details', ${tx.json(d as never)})
             on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await audit(tx, actor, "settings.payment_details_updated", "settings", "payment_details", null, { upi_id: d.upi_id ? "set" : "empty", bank: d.account_number ? "set" : "empty" });
  });
}

/** UPI deep link (NPCI format) encoded in the scan-to-pay QR code. */
export function upiLink(d: Pick<PaymentDetails, "upi_id" | "payee_name">, amount: number, note: string, ref?: string) {
  const q = new URLSearchParams({ pa: d.upi_id, pn: d.payee_name, am: amount.toFixed(2), cu: "INR", tn: note.slice(0, 80) });
  if (ref) q.set("tr", ref.slice(0, 35));
  return `upi://pay?${q.toString().replace(/\+/g, "%20")}`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export const NOTIFICATION_KINDS = {
  expiry_reminder: "Free maintenance ending soon (client)",
  expired: "Free maintenance ended (client)",
  billing_reminder: "Monthly billing reminder (client)",
  payment_confirmed: "Payment confirmation (client)",
  payment_failed: "Payment not received (client)",
  payment_overdue: "Payment overdue (client)",
  admin_expiring: "Free maintenance ending soon (admin)",
  admin_expired: "Free maintenance expired (admin)",
  admin_activated: "Client activated paid maintenance (admin)",
  admin_payment: "Payment succeeded or failed (admin)",
  admin_payment_reported: "Client reported a payment (admin)",
  admin_overdue: "Payment overdue (admin)",
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export const DEFAULT_TEMPLATES: Record<NotificationKind, Template> = {
  expiry_reminder: {
    subject: "Your free maintenance for {{project_name}} ends in {{days_left}} days",
    body: "Hi {{client_name}},\n\nThe six-month free maintenance period for your {{project_name}} project with {{company_name}} ends on {{expiry_date}} ({{days_left}} days from today).\n\nAfter that, ongoing maintenance is available for {{monthly_fee}} per month. You can review the plan and activate it from your client portal: {{portal_link}}\n\nQuestions? Reply to this email or contact us at {{company_contact}}.\n\n{{company_name}}",
  },
  expired: {
    subject: "Your six-month free maintenance for {{project_name}} has ended",
    body: "Hi {{client_name}},\n\nThe six-month free maintenance period for your {{project_name}} project with {{company_name}} has now ended ({{expiry_date}}).\n\nYou can continue receiving ongoing maintenance for {{monthly_fee}} per month. This covers {{included_summary}}, subject to your maintenance agreement.\n\nIf you would like to continue, please activate the plan in your client portal: {{portal_link}} — or contact us at {{company_contact}} for assistance.\n\nThank you for choosing {{company_name}}!",
  },
  billing_reminder: {
    subject: "Maintenance invoice {{invoice_number}}: {{amount}} due {{due_date}}",
    body: "Hi {{client_name}},\n\nYour monthly maintenance invoice {{invoice_number}} for {{project_name}} is ready. Amount: {{amount}}, due on {{due_date}}.\n\nPay by scanning the UPI QR code or by bank transfer, then report the payment reference here: {{payment_link}}\n\n{{company_name}} · {{company_contact}}",
  },
  payment_confirmed: {
    subject: "Payment received — thank you ({{amount}})",
    body: "Hi {{client_name}},\n\nWe have received and confirmed your payment of {{amount}} for {{project_name}} maintenance (receipt {{receipt_number}}). Your maintenance plan is active; the next billing date is {{next_billing_date}}.\n\nDownload your receipt: {{payment_link}}\n\n{{company_name}}",
  },
  payment_failed: {
    subject: "We could not confirm your payment for {{project_name}}",
    body: "Hi {{client_name}},\n\nWe could not confirm the payment of {{amount}} for your {{project_name}} maintenance invoice {{invoice_number}}. Please check the transaction and try again, or contact us at {{company_contact}}.\n\nPay here: {{payment_link}}\n\n{{company_name}}",
  },
  payment_overdue: {
    subject: "Friendly reminder: maintenance invoice {{invoice_number}} is overdue",
    body: "Hi {{client_name}},\n\nThis is a friendly reminder that your maintenance invoice {{invoice_number}} for {{project_name}} ({{amount}}) was due on {{due_date}} and we have not received it yet.\n\nIf you have already paid, please report the payment reference so we can confirm it: {{payment_link}}\n\nThank you,\n{{company_name}} · {{company_contact}}",
  },
  admin_expiring: {
    subject: "Maintenance ending in {{days_left}} days: {{business_name}}",
    body: "Maintenance Alert — {{company_name}}\nClient: {{client_name}} ({{business_name}})\nProject: {{project_name}}\nFree maintenance ends on {{expiry_date}} ({{days_left}} days).\nMonthly maintenance fee: {{monthly_fee}}\nStatus: {{maintenance_status}}",
  },
  admin_expired: {
    subject: "Free maintenance expired: {{business_name}} — {{project_name}}",
    body: "Maintenance Alert — {{company_name}}\nClient: {{client_name}} ({{business_name}})\nProject: {{project_name}}\nThe six-month free maintenance period has expired.\nMonthly maintenance fee: {{monthly_fee}}\nPaid maintenance status: {{maintenance_status}}\nPlease check the client portal for payment and subscription details.",
  },
  admin_activated: {
    subject: "{{business_name}} activated paid maintenance",
    body: "{{client_name}} ({{business_name}}) activated paid maintenance for {{project_name}} at {{monthly_fee}} per month. Billing starts {{billing_start}}.",
  },
  admin_payment: {
    subject: "Maintenance payment {{payment_result}}: {{business_name}} ({{amount}})",
    body: "Maintenance payment {{payment_result}} for {{project_name}} ({{business_name}}): {{amount}}, invoice {{invoice_number}}.\nStatus: {{maintenance_status}}",
  },
  admin_payment_reported: {
    subject: "Payment reported by {{business_name}}: {{amount}}",
    body: "{{client_name}} reported a payment of {{amount}} for invoice {{invoice_number}} ({{project_name}}). Reference: {{reference}}.\nCheck your bank or UPI app, then confirm it in the admin dashboard.",
  },
  admin_overdue: {
    subject: "Maintenance payment overdue: {{business_name}}",
    body: "Maintenance Alert — {{company_name}}\nInvoice {{invoice_number}} for {{project_name}} ({{business_name}}) was due on {{due_date}} and is unpaid ({{amount}}).",
  },
};

export function render(tpl: string, vars: Record<string, string | number | null | undefined>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}

function templateFor(s: MaintenanceSettings, kind: NotificationKind): Template {
  const o = s.templates?.[kind] ?? {};
  return { subject: o.subject?.trim() || DEFAULT_TEMPLATES[kind].subject, body: o.body?.trim() || DEFAULT_TEMPLATES[kind].body };
}

// ---------------------------------------------------------------------------
// Dates & status
// ---------------------------------------------------------------------------
export const fmtIST = (d: string | null) =>
  d ? new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";

type Row = {
  id: string; name: string; client_id: string; status: string; completed_at: Date | null; created_at: Date;
  proposal_started_at: Date | null; free_maintenance_start_date: string | null; free_maintenance_end_date: string | null;
  maintenance_dates_overridden: boolean; maintenance_status: MaintenanceStatus | null; monthly_maintenance_fee: number | null;
  maintenance_billing_start_date: string | null; next_billing_date: string | null; maintenance_activated_at: Date | null;
  maintenance_cancelled_at: Date | null; maintenance_exempt: boolean; maintenance_paused: boolean; maintenance_covers_hosting: boolean;
};

export function computeStatus(p: Pick<Row, "free_maintenance_end_date" | "maintenance_cancelled_at" | "maintenance_activated_at" | "maintenance_billing_start_date">,
  today: string, s: Pick<MaintenanceSettings, "expiring_soon_days">, b: { paid: boolean; overdue: boolean; expiryNoticeSent: boolean }): MaintenanceStatus | null {
  const end = p.free_maintenance_end_date;
  if (!end) return null;
  if (p.maintenance_cancelled_at) return "MAINTENANCE_CANCELLED";
  if (p.maintenance_activated_at) {
    if (b.overdue) return "PAYMENT_OVERDUE";
    if (b.paid) return "PAID_MAINTENANCE_ACTIVE";
    // Activated during the free period: still free until billing starts.
    if (p.maintenance_billing_start_date && today < p.maintenance_billing_start_date) {
      return daysBetween(today, end) <= s.expiring_soon_days ? "EXPIRING_SOON" : "FREE_MAINTENANCE_ACTIVE";
    }
    return "AWAITING_CLIENT_CONFIRMATION";
  }
  if (today < end) return daysBetween(today, end) <= s.expiring_soon_days ? "EXPIRING_SOON" : "FREE_MAINTENANCE_ACTIVE";
  return b.expiryNoticeSent ? "AWAITING_CLIENT_CONFIRMATION" : "FREE_MAINTENANCE_EXPIRED";
}

/**
 * Recalculate maintenance dates and status for projects. Server-side only.
 * The free period starts on the configured trigger (proposal initiated by default) unless an admin
 * overrode the dates for the project.
 */
export async function syncMaintenance(tx: Tx, today = istToday(), projectId?: string) {
  const s = await getMaintenanceSettings(tx);
  const rows = await tx<(Row & { initiated: Date | null; accepted: Date | null })[]>`
    select p.*,
      least(
        (select min(q.created_at) from quotations q where q.project_id = p.id),
        (select min(pr.created_at) from proposals pr where pr.project_id = p.id)
      ) as initiated,
      least(
        (select min(v.accepted_at) from quotation_versions v where v.project_id = p.id),
        (select min(pv.accepted_at) from proposal_versions pv join proposals pr on pr.id = pv.proposal_id where pr.project_id = p.id)
      ) as accepted
    from projects p ${projectId ? tx`where p.id = ${projectId}` : tx``}`;
  for (const p of rows) {
    let start = p.free_maintenance_start_date;
    let end = p.free_maintenance_end_date;
    if (!p.maintenance_dates_overridden) {
      const anchor = s.trigger === "proposal_accepted" ? p.accepted : s.trigger === "project_delivered" ? p.completed_at : p.initiated;
      start = anchor ? istDate(anchor) : null;
      end = start ? addMonths(start, s.free_months) : null;
    }
    const billing = await tx<{ paid: boolean; overdue: boolean; next_due: string | null }[]>`
      select
        exists (select 1 from payments x join invoices i on i.id = x.invoice_id
                where i.project_id = ${p.id} and i.kind = 'maintenance' and x.status = 'confirmed') as paid,
        exists (select 1 from invoices i where i.project_id = ${p.id} and i.kind = 'maintenance'
                and i.status in ('issued', 'partially_paid') and i.due_date < ${today}) as overdue,
        (select min(i.due_date) from invoices i where i.project_id = ${p.id} and i.kind = 'maintenance' and i.status in ('issued', 'partially_paid')) as next_due`;
    const [notice] = end ? await tx`select 1 from message_deliveries where idempotency_key like ${`m:expired:${p.id}:${end}:client:%`} and status = 'sent' limit 1` : [];
    const st = computeStatus({ ...p, free_maintenance_end_date: end }, today, s, { ...billing[0], expiryNoticeSent: !!notice });
    let next = p.next_billing_date;
    if (p.maintenance_activated_at && p.maintenance_billing_start_date && !p.maintenance_cancelled_at) {
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from invoices where project_id = ${p.id} and kind = 'maintenance'
        and status <> 'void' and billing_period_start >= ${p.maintenance_billing_start_date}`;
      next = billing[0].next_due ?? addMonths(p.maintenance_billing_start_date, n);
    } else if (p.maintenance_cancelled_at || !p.maintenance_activated_at) next = null;
    const proposalStarted = p.initiated ?? p.proposal_started_at;
    if (start !== p.free_maintenance_start_date || end !== p.free_maintenance_end_date || st !== p.maintenance_status || next !== p.next_billing_date
      || String(proposalStarted) !== String(p.proposal_started_at)) {
      await tx`update projects set free_maintenance_start_date = ${start}, free_maintenance_end_date = ${end}, maintenance_status = ${st},
                 next_billing_date = ${next}, proposal_started_at = ${proposalStarted} where id = ${p.id}`;
    }
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Tracked notifications (idempotent, retried, logged)
// ---------------------------------------------------------------------------
type Ctx = { project: { id: string; name: string; client_id: string; free_maintenance_end_date: string | null; maintenance_status: string | null;
  monthly_maintenance_fee: number | null; maintenance_billing_start_date: string | null; next_billing_date: string | null };
  client: { business_name: string; owner_name: string; email: string; phone: string | null } };

async function loadCtx(tx: Tx, projectId: string): Promise<Ctx> {
  const [project] = await tx<Ctx["project"][]>`select id, name, client_id, free_maintenance_end_date, maintenance_status, monthly_maintenance_fee,
    maintenance_billing_start_date, next_billing_date from projects where id = ${projectId}`;
  if (!project) throw notFound("Project not found.");
  const [client] = await tx<Ctx["client"][]>`select business_name, owner_name, email, phone from client_profiles where id = ${project.client_id}`;
  return { project, client };
}

export function effectiveFee(p: { monthly_maintenance_fee: number | null }, s: MaintenanceSettings) {
  return p.monthly_maintenance_fee == null ? Number(s.default_fee) : Number(p.monthly_maintenance_fee);
}

async function baseVars(ctx: Ctx, s: MaintenanceSettings, today: string) {
  const biz = await getBusiness();
  const end = ctx.project.free_maintenance_end_date;
  const tax = await getTaxConfig();
  const fee = effectiveFee(ctx.project, s);
  return {
    client_name: ctx.client.owner_name, business_name: ctx.client.business_name, project_name: ctx.project.name,
    expiry_date: fmtIST(end), days_left: end ? Math.max(0, daysBetween(today, end)) : "",
    monthly_fee: `${formatMoney(fee)}${tax.enabled && tax.rate > 0 ? ` + ${tax.label} ${tax.rate}%` : ""}`,
    maintenance_status: (ctx.project.maintenance_status ?? "").replace(/_/g, " ").toLowerCase(),
    next_billing_date: fmtIST(ctx.project.next_billing_date), billing_start: fmtIST(ctx.project.maintenance_billing_start_date),
    portal_link: `${appUrl()}/portal/${ctx.project.id}/maintenance`, payment_link: `${appUrl()}/portal/${ctx.project.id}/maintenance`,
    company_name: biz.name, company_contact: [biz.email, biz.phone].filter(Boolean).join(" · ") || biz.name,
    included_summary: "minor bug fixes, minor technical glitches and routine maintenance",
  };
}

type Channel = "email" | "whatsapp";
type SendOpts = { projectId: string; kind: NotificationKind; period: string; audience: "client" | "admin"; channels: Channel[];
  vars?: Record<string, string | number | null | undefined>; today?: string };

/**
 * Send a notification at most once per (kind, project, period, audience, channel). A unique
 * idempotency key is claimed in the database *before* sending, so concurrent or repeated runs
 * cannot send duplicates. Failures are retried later up to the configured limit.
 */
export async function sendTracked(o: SendOpts): Promise<Record<Channel, string>> {
  const today = o.today ?? istToday();
  const s = await getMaintenanceSettings();
  const ctx = await withDb(SYSTEM, (tx) => loadCtx(tx, o.projectId));
  const vars = { ...(await baseVars(ctx, s, today)), ...(o.vars ?? {}) };
  const tpl = templateFor(s, o.kind);
  const subject = render(tpl.subject, vars);
  const body = render(tpl.body, vars);
  const out = {} as Record<Channel, string>;
  for (const channel of o.channels) {
    const recipient = o.audience === "client"
      ? (channel === "email" ? ctx.client.email : ctx.client.phone)
      : (channel === "email" ? await adminEmail(s) : s.admin_whatsapp);
    const key = `m:${o.kind}:${o.projectId}:${o.period}:${o.audience}:${channel}`;
    const claimed = await claim(key, { channel, recipient: recipient || "-", subject: channel === "email" ? subject : null, body, kind: o.kind, audience: o.audience, projectId: o.projectId }, s);
    if (!claimed) { out[channel] = "duplicate"; continue; }
    if (!recipient) {
      await finish(claimed.id, { status: "skipped", error: channel === "email" ? "No email address on file" : "No WhatsApp number on file" }, claimed.attempts, s);
      out[channel] = "skipped";
      continue;
    }
    const r = await deliver(channel, recipient, subject, body, s);
    await finish(claimed.id, r, claimed.attempts, s);
    out[channel] = r.status;
  }
  return out;
}

async function adminEmail(s: MaintenanceSettings) {
  if (s.admin_email) return s.admin_email;
  return (await getBusiness()).email || process.env.COMPANY_EMAIL || "";
}

async function deliver(channel: Channel, to: string, subject: string, body: string, s: MaintenanceSettings): Promise<DeliveryResult> {
  if (channel === "email") {
    const html = `<div style="font-family:system-ui,sans-serif;line-height:1.55;color:#111">${escapeHtml(body).replace(/\n/g, "<br/>")}</div>`;
    return deliverEmail({ to, subject, text: body, html });
  }
  return deliverWhatsApp({ to, text: body, template: s.whatsapp_template || null, language: s.whatsapp_language });
}

async function claim(key: string, row: { channel: Channel; recipient: string; subject: string | null; body: string; kind: string; audience: string; projectId: string }, s: MaintenanceSettings) {
  return withDb(SYSTEM, async (tx) => {
    const [ins] = await tx<{ id: string; attempts: number }[]>`
      insert into message_deliveries (channel, recipient, subject, purpose, status, idempotency_key, kind, audience, body, project_id)
      values (${row.channel}, ${row.recipient}, ${row.subject}, 'maintenance', 'pending', ${key}, ${row.kind}, ${row.audience}, ${row.body}, ${row.projectId})
      on conflict (idempotency_key) do nothing returning id, attempts`;
    if (ins) return ins;
    // Already exists: only a due, failed attempt with retries left may be re-claimed.
    const [re] = await tx<{ id: string; attempts: number }[]>`
      update message_deliveries set status = 'pending', attempts = attempts + 1, updated_at = now(), recipient = ${row.recipient}, body = ${row.body}, subject = ${row.subject}
      where idempotency_key = ${key} and status = 'failed' and attempts < ${s.retry_max_attempts} and (next_retry_at is null or next_retry_at <= now())
      returning id, attempts`;
    return re ?? null;
  });
}

async function finish(id: string, r: DeliveryResult | { status: "skipped"; error: string }, attempts: number, s: MaintenanceSettings) {
  const retry = r.status === "failed" && attempts < s.retry_max_attempts;
  await withDb(SYSTEM, (tx) => tx`
    update message_deliveries set status = ${r.status}, error = ${r.error ?? null}, updated_at = now(),
      next_retry_at = ${retry ? tx`now() + make_interval(mins => ${Math.round(s.retry_delay_hours * 60)})` : null}
    where id = ${id}`);
}

/** Retry failed deliveries whose retry time has come (bounded by retry_max_attempts). */
export async function retryFailedDeliveries(opts: { projectId?: string; deliveryId?: string; force?: boolean } = {}) {
  const s = await getMaintenanceSettings();
  const due = await withDb(SYSTEM, (tx) => tx<{ id: string; channel: Channel; recipient: string; subject: string | null; body: string; attempts: number }[]>`
    update message_deliveries set status = 'pending', attempts = attempts + 1, updated_at = now()
    where id in (
      select id from message_deliveries where purpose = 'maintenance' and status = 'failed' and attempts < ${s.retry_max_attempts}
        ${opts.force ? tx`` : tx`and (next_retry_at is null or next_retry_at <= now())`}
        ${opts.projectId ? tx`and project_id = ${opts.projectId}` : tx``}
        ${opts.deliveryId ? tx`and id = ${opts.deliveryId}` : tx``}
      for update skip locked)
    returning id, channel, recipient, subject, body, attempts`);
  let sent = 0;
  for (const d of due) {
    const r = await deliver(d.channel, d.recipient, d.subject ?? "", d.body, s);
    await finish(d.id, r, d.attempts, s);
    if (r.status === "sent") sent++;
  }
  return { retried: due.length, sent };
}

// ---------------------------------------------------------------------------
// Monthly maintenance invoices (paid by UPI QR / bank transfer, confirmed by an admin)
// ---------------------------------------------------------------------------
const monthLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

async function monthlyTotal(tx: Tx, fee: number) {
  const tax = await getTaxConfig(tx);
  const taxAmt = tax.enabled ? Math.round((toPaise(fee) * tax.rate) / 100) : 0;
  return { tax, total: fromPaise(toPaise(fee) + taxAmt) };
}

/** Create (and issue) the next maintenance invoices that fall within the reminder window. Idempotent. */
async function ensureInvoices(tx: Tx, p: Row, today: string, s: MaintenanceSettings) {
  if (!p.maintenance_activated_at || p.maintenance_cancelled_at || p.maintenance_paused || p.maintenance_exempt || !p.maintenance_billing_start_date) return [];
  const created: { id: string; number: string; due: string; amount: number }[] = [];
  const fee = effectiveFee(p, s);
  if (fee <= 0) return created;
  const { tax, total } = await monthlyTotal(tx, fee);
  for (let guard = 0; guard < 3; guard++) {
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from invoices where project_id = ${p.id} and kind = 'maintenance'
      and status <> 'void' and billing_period_start >= ${p.maintenance_billing_start_date}`;
    const periodStart = addMonths(p.maintenance_billing_start_date, n);
    if (addDays(periodStart, -s.billing_reminder_days) > today) break;
    const periodEnd = addDays(addMonths(p.maintenance_billing_start_date, n + 1), -1);
    const number = await nextNumber(tx, "INV");
    const [inv] = await tx<{ id: string }[]>`
      insert into invoices (project_id, number, title, description, amount, currency, status, issue_date, due_date, issued_at, kind, billing_period_start, billing_period_end)
      values (${p.id}, ${number}, ${`Maintenance — ${monthLabel(periodStart)}`},
              ${`Monthly maintenance for ${p.name}, ${fmtIST(periodStart)} to ${fmtIST(periodEnd)}: ${formatMoney(fee)}${tax.enabled && tax.rate > 0 ? ` + ${tax.label} ${tax.rate}%` : ""}.`},
              ${total}, 'INR', 'issued', ${today}, ${periodStart}, now(), 'maintenance', ${periodStart}, ${periodEnd})
      on conflict do nothing returning id`;
    if (!inv) break;
    await audit(tx, null, "maintenance.invoice_issued", "invoice", inv.id, p.id, { number, period: periodStart, amount: total });
    created.push({ id: inv.id, number, due: periodStart, amount: total });
  }
  return created;
}

// ---------------------------------------------------------------------------
// Daily job
// ---------------------------------------------------------------------------
export type JobSummary = { today: string; projects: number; notifications: Record<string, number>; invoices: number; retried: number; errors: string[] };

/**
 * The daily maintenance check. Safe to run any number of times per day: dates and statuses are
 * recalculated, notifications are claimed by idempotency key, and invoices are unique per period.
 * `today` can be overridden to simulate future dates (tests and the admin "simulate" tool).
 */
export async function runMaintenanceJob(opts: { today?: string; trigger?: string } = {}): Promise<JobSummary> {
  const today = opts.today ?? istToday();
  const summary: JobSummary = { today, projects: 0, notifications: {}, invoices: 0, retried: 0, errors: [] };
  const count = (k: string, r: Record<string, string>) => {
    for (const v of Object.values(r)) if (v !== "duplicate") summary.notifications[`${k}:${v}`] = (summary.notifications[`${k}:${v}`] ?? 0) + 1;
  };
  const s = await getMaintenanceSettings();
  // Short lease so overlapping runs (cron + "Run check now") don't work in parallel. Correctness does not
  // depend on it: notifications are claimed by unique key and invoices are unique per billing period.
  const lease = await withDb(SYSTEM, (tx) => tx`
    insert into app_settings (key, value) values ('maintenance_job_lock', ${tx.json({ until: Date.now() + 10 * 60_000 } as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where (app_settings.value->>'until')::bigint < ${Date.now()}
    returning key`);
  if (!lease.length) { summary.errors.push("Another run is in progress. Try again in a few minutes."); return summary; }
  try {

  summary.projects = await withDb(SYSTEM, (tx) => syncMaintenance(tx, today));
  const projects = await withDb(SYSTEM, (tx) => tx<Row[]>`select * from projects where free_maintenance_end_date is not null`);

  for (const p of projects) {
    try {
      if (p.maintenance_exempt || p.maintenance_paused || p.maintenance_cancelled_at) continue;
      const end = p.free_maintenance_end_date!;
      const activated = !!p.maintenance_activated_at;
      // A/B: reminders N days before expiry. Missed runs are caught up within catch_up_days, never older.
      for (const days of s.reminder_days) {
        const due = addDays(end, -days);
        if (today >= due && today <= addDays(due, s.catch_up_days) && today < end && !activated) {
          count("expiry_reminder", await sendTracked({ projectId: p.id, kind: "expiry_reminder", period: `${end}:${days}`, audience: "client", channels: ["email", "whatsapp"], today }));
          count("admin_expiring", await sendTracked({ projectId: p.id, kind: "admin_expiring", period: `${end}:${days}`, audience: "admin", channels: ["email"], today }));
        }
      }
      // C: on (or after) the expiry date — sent once, even if late.
      if (today >= end && !activated) {
        count("expired", await sendTracked({ projectId: p.id, kind: "expired", period: end, audience: "client", channels: ["email", "whatsapp"], today }));
        count("admin_expired", await sendTracked({ projectId: p.id, kind: "admin_expired", period: end, audience: "admin", channels: ["email", "whatsapp"], today }));
      }
      // D: monthly invoices + billing reminder.
      const created = await withDb(SYSTEM, (tx) => ensureInvoices(tx, p, today, s));
      summary.invoices += created.length;
      for (const inv of created) {
        count("billing_reminder", await sendTracked({ projectId: p.id, kind: "billing_reminder", period: inv.due, audience: "client", channels: ["email", "whatsapp"], today,
          vars: { invoice_number: inv.number, amount: formatMoney(inv.amount), due_date: fmtIST(inv.due) } }));
        await withDb(SYSTEM, (tx) => notifyProjectClients(tx, null, p.id, { type: "invoice_issued", title: `Maintenance invoice ${inv.number} issued`, link: `/portal/${p.id}/maintenance` }));
      }
      // F: overdue maintenance invoices — one reminder per invoice.
      const overdue = await withDb(SYSTEM, (tx) => tx<{ id: string; number: string; due_date: string; amount: number }[]>`
        select id, number, due_date, amount from invoices where project_id = ${p.id} and kind = 'maintenance'
        and status in ('issued', 'partially_paid') and due_date < ${today}`);
      for (const inv of overdue) {
        const vars = { invoice_number: inv.number, amount: formatMoney(Number(inv.amount)), due_date: fmtIST(inv.due_date) };
        count("payment_overdue", await sendTracked({ projectId: p.id, kind: "payment_overdue", period: inv.id, audience: "client", channels: ["email", "whatsapp"], today, vars }));
        count("admin_overdue", await sendTracked({ projectId: p.id, kind: "admin_overdue", period: inv.id, audience: "admin", channels: ["email", "whatsapp"], today, vars }));
      }
    } catch (e) {
      console.error("[maintenance job]", p.id, e);
      summary.errors.push(`${p.name}: ${(e as Error).message}`);
    }
  }
  // Statuses may have changed after notices/invoices.
  await withDb(SYSTEM, (tx) => syncMaintenance(tx, today));
  summary.retried = (await retryFailedDeliveries()).retried;
  await withDb(SYSTEM, (tx) => tx`insert into app_settings (key, value) values ('maintenance_job', ${tx.json({ last_run_at: new Date().toISOString(), trigger: opts.trigger ?? "manual", ...summary } as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`);
  } finally {
    await withDb(SYSTEM, (tx) => tx`delete from app_settings where key = 'maintenance_job_lock'`);
  }
  return summary;
}

export async function lastJobRun() {
  return withDb(SYSTEM, async (tx) => {
    const [r] = await tx<{ value: JobSummary & { last_run_at: string; trigger: string } }[]>`select value from app_settings where key = 'maintenance_job'`;
    return r?.value ?? null;
  });
}

// ---------------------------------------------------------------------------
// Client: activation (explicit consent), cancellation, payment reports
// ---------------------------------------------------------------------------
export async function maintenanceTerms(projectId: string) {
  return withDb(SYSTEM, async (tx) => {
    const s = await getMaintenanceSettings(tx);
    const [p] = await tx<Row[]>`select * from projects where id = ${projectId}`;
    if (!p) throw notFound();
    const fee = effectiveFee(p, s);
    const { tax, total } = await monthlyTotal(tx, fee);
    const included = [...s.included, ...(p.maintenance_covers_hosting && s.hosting_line ? [s.hosting_line] : [])];
    return { fee, tax, total, frequency: "Monthly", included, excluded: s.excluded, cancellation_terms: s.cancellation_terms, payment_terms: s.payment_terms,
      covers_hosting: p.maintenance_covers_hosting };
  });
}

const activateSchema = z.object({
  signer_name: text(200, 2),
  confirm_terms: z.literal(true, { error: "Please confirm you have read the maintenance terms" }),
  confirm_recurring: z.literal(true, { error: "Please agree to the recurring monthly charge" }),
});

export async function activateMaintenance(actor: Actor, projectId: string, input: unknown, meta: { ip?: string | null; ua?: string | null } = {}) {
  if (actor.role !== "client") throw new AppError("Only the client can activate paid maintenance.");
  const d = parse(activateSchema, input);
  const today = istToday();
  const terms = await maintenanceTerms(projectId);
  const result = await withDb(actor, async (tx) => {
    const p = await getProjectFor(tx, actor, projectId) as unknown as Row; // RLS: own projects only
    if (!p.free_maintenance_end_date) throw new AppError("Maintenance has not started for this project yet.");
    if (p.maintenance_exempt) throw new AppError("No maintenance charges apply to this project.");
    if (p.maintenance_activated_at && !p.maintenance_cancelled_at) throw new AppError("Paid maintenance is already active for this project.");
    const billingStart = today > p.free_maintenance_end_date ? today : p.free_maintenance_end_date;
    await asSystem(tx, actor, async () => {
      await tx`insert into maintenance_consents (project_id, user_id, signer_name, monthly_fee, tax_label, tax_rate, monthly_total, billing_start, terms_snapshot, ip, user_agent)
               values (${projectId}, ${actor.userId}, ${d.signer_name}, ${terms.fee}, ${terms.tax.label}, ${terms.tax.enabled ? terms.tax.rate : 0}, ${terms.total},
                       ${billingStart}, ${tx.json(terms as never)}, ${meta.ip ?? null}, ${meta.ua?.slice(0, 300) ?? null})`;
      await tx`update projects set maintenance_activated_at = now(), maintenance_cancelled_at = null, maintenance_billing_start_date = ${billingStart},
                 monthly_maintenance_fee = ${terms.fee} where id = ${projectId}`;
    });
    await audit(tx, actor, "maintenance.activated", "project", projectId, projectId, { fee: terms.fee, total: terms.total, billing_start: billingStart, signer: d.signer_name }, meta.ip);
    await asSystem(tx, actor, () => syncMaintenance(tx, today, projectId));
    return { billingStart };
  });
  await sendTracked({ projectId, kind: "admin_activated", period: result.billingStart, audience: "admin", channels: ["email"], today });
  await withDb(SYSTEM, (tx) => notifyAdmins(tx, null, { type: "maintenance_activated", projectId, title: `${actor.name} activated paid maintenance`, link: `/admin/maintenance/${projectId}` }));
  // Issue the first invoice now if it is already within the reminder window.
  await runForProject(projectId, today);
  return result;
}

/** Billing step for a single project (used after activation and admin changes). */
async function runForProject(projectId: string, today: string) {
  const s = await getMaintenanceSettings();
  const [p] = await withDb(SYSTEM, async (tx) => { await syncMaintenance(tx, today, projectId); return tx<Row[]>`select * from projects where id = ${projectId}`; });
  const created = await withDb(SYSTEM, (tx) => ensureInvoices(tx, p, today, s));
  for (const inv of created) {
    await sendTracked({ projectId, kind: "billing_reminder", period: inv.due, audience: "client", channels: ["email", "whatsapp"], today,
      vars: { invoice_number: inv.number, amount: formatMoney(inv.amount), due_date: fmtIST(inv.due) } });
  }
  await withDb(SYSTEM, (tx) => syncMaintenance(tx, today, projectId));
}

/** Cancel future maintenance billing. Invoices already due remain payable; future ones are voided. */
export async function cancelMaintenance(actor: Actor, projectId: string, reason?: string | null) {
  const today = istToday();
  await withDb(actor, async (tx) => {
    const p = await getProjectFor(tx, actor, projectId) as unknown as Row;
    if (!p.maintenance_activated_at || p.maintenance_cancelled_at) throw new AppError("Paid maintenance is not active for this project.");
    const run = async () => {
      await tx`update projects set maintenance_cancelled_at = now() where id = ${projectId}`;
      await tx`update invoices i set status = 'void' where i.project_id = ${projectId} and i.kind = 'maintenance' and i.status = 'issued' and i.due_date > ${today}
               and not exists (select 1 from payments x where x.invoice_id = i.id and x.status in ('confirmed', 'pending'))`;
    };
    if (actor.role === "client") await asSystem(tx, actor, run); else await run();
    await audit(tx, actor, "maintenance.cancelled", "project", projectId, projectId, { by: actor.role, reason: reason ?? null });
    if (actor.role === "client") await notifyAdmins(tx, actor, { type: "maintenance_cancelled", projectId, title: `${actor.name} cancelled paid maintenance`, link: `/admin/maintenance/${projectId}` });
    else await notifyProjectClients(tx, actor, projectId, { type: "maintenance_cancelled", title: "Your maintenance plan was cancelled", link: `/portal/${projectId}/maintenance` });
    if (actor.role === "client") await asSystem(tx, actor, () => syncMaintenance(tx, today, projectId)); else await syncMaintenance(tx, today, projectId);
  });
}

const reportSchema = z.object({
  reference: text(100, 4),
  amount: z.coerce.number().positive().max(999_999_999),
  paid_on: date,
});

/** A client reports a payment made by UPI/bank. It stays pending (not paid) until an admin confirms it. */
export async function reportPayment(actor: Actor, invoiceId: string, input: unknown) {
  if (actor.role !== "client") throw new AppError("Only clients can report payments.");
  const d = parse(reportSchema, input);
  if (d.paid_on > istToday()) throw new AppError("Payment date cannot be in the future.");
  const r = await withDb(actor, async (tx) => {
    const [inv] = await tx<{ id: string; project_id: string; number: string; status: string; amount: number }[]>`select id, project_id, number, status, amount from invoices where id = ${invoiceId}`;
    if (!inv) throw notFound("Invoice not found.");
    await getProjectFor(tx, actor, inv.project_id);
    if (!["issued", "partially_paid"].includes(inv.status)) throw new AppError("This invoice is not awaiting payment.");
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from payments where invoice_id = ${invoiceId} and status = 'pending' and reported_by = ${actor.userId}`;
    if (n >= 3) throw new AppError("You have already reported payments for this invoice. We will confirm them shortly.");
    const [p] = await asSystem(tx, actor, () => tx<{ id: string }[]>`
      insert into payments (project_id, invoice_id, amount, currency, method, status, paid_on, reference, notes, source, reported_by)
      values (${inv.project_id}, ${invoiceId}, ${d.amount}, 'INR', 'upi', 'pending', ${d.paid_on}, ${d.reference}, 'Reported by client — awaiting confirmation', 'manual', ${actor.userId})
      returning id`);
    await audit(tx, actor, "payment.reported", "payment", p.id, inv.project_id, { amount: d.amount, reference: d.reference, invoice: inv.number });
    await notifyAdmins(tx, actor, { type: "payment_reported", projectId: inv.project_id, title: `${actor.name} reported a payment of ${formatMoney(d.amount)} (${inv.number})`,
      link: `/admin/projects/${inv.project_id}/billing` });
    return { paymentId: p.id, projectId: inv.project_id, number: inv.number };
  });
  await sendTracked({ projectId: r.projectId, kind: "admin_payment_reported", period: r.paymentId, audience: "admin", channels: ["email"],
    vars: { amount: formatMoney(d.amount), invoice_number: r.number, reference: d.reference } });
  return r;
}

/** Called after a payment's status changes (confirmed / failed) — updates status and notifies (E, admin alerts). */
export async function onPaymentStatusChanged(paymentId: string) {
  const [x] = await withDb(SYSTEM, (tx) => tx<{ id: string; status: string; amount: number; receipt_number: string | null; project_id: string; kind: string | null; number: string | null }[]>`
    select x.id, x.status, x.amount, x.receipt_number, x.project_id, i.kind, i.number from payments x left join invoices i on i.id = x.invoice_id where x.id = ${paymentId}`);
  if (!x || x.kind !== "maintenance") return;
  const today = istToday();
  await withDb(SYSTEM, (tx) => syncMaintenance(tx, today, x.project_id));
  const vars = { amount: formatMoney(Number(x.amount)), invoice_number: x.number, receipt_number: x.receipt_number ?? "" };
  if (x.status === "confirmed") {
    await sendTracked({ projectId: x.project_id, kind: "payment_confirmed", period: x.id, audience: "client", channels: ["email"], vars });
    await sendTracked({ projectId: x.project_id, kind: "admin_payment", period: `${x.id}:ok`, audience: "admin", channels: ["email"], vars: { ...vars, payment_result: "succeeded" } });
  } else if (x.status === "failed") {
    await sendTracked({ projectId: x.project_id, kind: "payment_failed", period: x.id, audience: "client", channels: ["email", "whatsapp"], vars });
    await sendTracked({ projectId: x.project_id, kind: "admin_payment", period: `${x.id}:failed`, audience: "admin", channels: ["email"], vars: { ...vars, payment_result: "failed" } });
  }
}

// ---------------------------------------------------------------------------
// Admin controls
// ---------------------------------------------------------------------------
const adminUpdateSchema = z.object({
  monthly_maintenance_fee: z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(999_999)]).optional().transform((v) => (v === "" || v == null ? null : Number(v))),
  free_maintenance_start_date: optDate,
  free_maintenance_end_date: optDate,
  reset_dates: z.coerce.boolean().optional().default(false),
  maintenance_exempt: z.coerce.boolean(),
  maintenance_paused: z.coerce.boolean(),
  maintenance_covers_hosting: z.coerce.boolean(),
  note: optText(1000),
});

export async function updateProjectMaintenance(actor: Actor, projectId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(adminUpdateSchema, input);
  const today = istToday();
  await withDb(actor, async (tx) => {
    const s = await getMaintenanceSettings(tx);
    const p = await getProjectFor(tx, actor, projectId) as unknown as Row;
    let start = p.free_maintenance_start_date, end = p.free_maintenance_end_date, overridden = p.maintenance_dates_overridden;
    if (d.reset_dates) overridden = false;
    else if (d.free_maintenance_start_date !== p.free_maintenance_start_date || d.free_maintenance_end_date !== p.free_maintenance_end_date) {
      start = d.free_maintenance_start_date;
      if (!start) throw new AppError("A start date is required.");
      end = d.free_maintenance_end_date && d.free_maintenance_end_date !== p.free_maintenance_end_date ? d.free_maintenance_end_date : addMonths(start, s.free_months);
      if (end <= start) throw new AppError("The expiry date must be after the start date.");
      overridden = true;
    }
    const changes: Record<string, [unknown, unknown]> = {};
    const next = { monthly_maintenance_fee: d.monthly_maintenance_fee, free_maintenance_start_date: start, free_maintenance_end_date: end, maintenance_dates_overridden: overridden,
      maintenance_exempt: d.maintenance_exempt, maintenance_paused: d.maintenance_paused, maintenance_covers_hosting: d.maintenance_covers_hosting };
    for (const [k, v] of Object.entries(next)) {
      const before = (p as Record<string, unknown>)[k];
      if (String(before ?? "") !== String(v ?? "")) changes[k] = [before ?? null, v];
    }
    if (!Object.keys(changes).length && !d.reset_dates) return;
    await tx`update projects set ${tx(next as never)} where id = ${projectId}`;
    await audit(tx, actor, "maintenance.updated", "project", projectId, projectId, { changes, note: d.note });
    await syncMaintenance(tx, today, projectId);
  });
  await runForProject(projectId, today);
}

export async function adminCancelMaintenance(actor: Actor, projectId: string) {
  assertAdmin(actor);
  await cancelMaintenance(actor, projectId);
}

/** Resend a notification now, bypassing the "already sent" check (logged with a manual key). */
export async function resendNotification(actor: Actor, projectId: string, kind: "expiry_reminder" | "expired" | "billing_reminder" | "payment_overdue") {
  assertAdmin(actor);
  const p = await withDb(actor, (tx) => getProjectFor(tx, actor, projectId)) as unknown as Row;
  if (!p.free_maintenance_end_date) throw new AppError("Maintenance has not started for this project.");
  const today = istToday();
  const [inv] = await withDb(SYSTEM, (tx) => tx<{ number: string; amount: number; due_date: string }[]>`
    select number, amount, due_date from invoices where project_id = ${projectId} and kind = 'maintenance' and status in ('issued', 'partially_paid') order by due_date limit 1`);
  if ((kind === "billing_reminder" || kind === "payment_overdue") && !inv) throw new AppError("There is no unpaid maintenance invoice to remind about.");
  const vars = inv ? { invoice_number: inv.number, amount: formatMoney(Number(inv.amount)), due_date: fmtIST(inv.due_date) } : {};
  const r = await sendTracked({ projectId, kind, period: `manual:${Date.now()}`, audience: "client", channels: ["email", "whatsapp"], today, vars });
  await withDb(actor, (tx) => audit(tx, actor, "maintenance.notification_resent", "project", projectId, projectId, { kind, result: r }));
  return r;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export type MaintenanceRow = Row & { business_name: string; owner_name: string; email_status: string | null; whatsapp_status: string | null; days_left: number | null; fee: number };

const FILTERS = {
  all: () => true,
  free: (r: MaintenanceRow) => r.maintenance_status === "FREE_MAINTENANCE_ACTIVE" || r.maintenance_status === "EXPIRING_SOON",
  expiring30: (r: MaintenanceRow) => r.days_left != null && r.days_left >= 0 && r.days_left <= 30 && !r.maintenance_activated_at,
  expiring7: (r: MaintenanceRow) => r.days_left != null && r.days_left >= 0 && r.days_left <= 7 && !r.maintenance_activated_at,
  expired: (r: MaintenanceRow) => r.maintenance_status === "FREE_MAINTENANCE_EXPIRED" || (r.maintenance_status === "AWAITING_CLIENT_CONFIRMATION" && !r.maintenance_activated_at),
  paid: (r: MaintenanceRow) => r.maintenance_status === "PAID_MAINTENANCE_ACTIVE",
  overdue: (r: MaintenanceRow) => r.maintenance_status === "PAYMENT_OVERDUE",
} as const;
export type MaintenanceFilter = keyof typeof FILTERS;

export async function listMaintenance(actor: Actor, filter: MaintenanceFilter = "all") {
  assertAdmin(actor);
  const today = istToday();
  return withDb(actor, async (tx) => {
    await syncMaintenance(tx, today);
    const s = await getMaintenanceSettings(tx);
    const rows = await tx<(Row & { business_name: string; owner_name: string; email_status: string | null; whatsapp_status: string | null })[]>`
      select p.*, c.business_name, c.owner_name,
        (select status from message_deliveries m where m.project_id = p.id and m.purpose = 'maintenance' and m.audience = 'client' and m.channel = 'email' order by m.created_at desc limit 1) as email_status,
        (select status from message_deliveries m where m.project_id = p.id and m.purpose = 'maintenance' and m.audience = 'client' and m.channel = 'whatsapp' order by m.created_at desc limit 1) as whatsapp_status
      from projects p join client_profiles c on c.id = p.client_id
      order by p.free_maintenance_end_date nulls last, p.created_at desc`;
    const all: MaintenanceRow[] = rows.map((r) => ({ ...r, fee: effectiveFee(r, s), days_left: r.free_maintenance_end_date ? daysBetween(today, r.free_maintenance_end_date) : null }));
    const f = FILTERS[filter] ?? FILTERS.all;
    const tracked = all.filter((r) => r.free_maintenance_end_date);
    const stats = Object.fromEntries((Object.keys(FILTERS) as MaintenanceFilter[]).map((k) => [k, tracked.filter(FILTERS[k]).length])) as Record<MaintenanceFilter, number>;
    return { rows: filter === "all" ? all : all.filter(f), stats, today, settings: s };
  });
}

export async function maintenanceDetail(actor: Actor, projectId: string) {
  const today = istToday();
  if (actor.role === "admin") await withDb(actor, (tx) => syncMaintenance(tx, today, projectId));
  return withDb(actor, async (tx) => {
    const p = await getProjectFor(tx, actor, projectId) as unknown as Row;
    const s = await getMaintenanceSettings(tx);
    const [client] = await tx<{ business_name: string; owner_name: string; email: string; phone: string | null }[]>`
      select business_name, owner_name, email, phone from client_profiles where id = ${p.client_id}`;
    const invoices = await tx<{ id: string; number: string; title: string; amount: number; status: string; due_date: string | null; billing_period_start: string; billing_period_end: string }[]>`
      select id, number, title, amount, status, due_date, billing_period_start, billing_period_end from invoices
      where project_id = ${projectId} and kind = 'maintenance' order by billing_period_start desc`;
    // RLS shows clients only confirmed payments plus pending ones they reported themselves.
    const payments = await tx<{ id: string; invoice_id: string | null; amount: number; status: string; paid_on: string | null; reference: string | null; receipt_number: string | null; reported_by: string | null }[]>`
      select x.id, x.invoice_id, x.amount, x.status, x.paid_on, x.reference, x.receipt_number, x.reported_by from payments x join invoices i on i.id = x.invoice_id
      where i.project_id = ${projectId} and i.kind = 'maintenance' order by x.created_at desc`;
    const consents = await tx<{ id: string; signer_name: string; monthly_fee: number; monthly_total: number; billing_start: string; created_at: Date }[]>`
      select id, signer_name, monthly_fee, monthly_total, billing_start, created_at from maintenance_consents where project_id = ${projectId} order by created_at desc`;
    const base = { project: { ...p, fee: effectiveFee(p, s), days_left: p.free_maintenance_end_date ? daysBetween(today, p.free_maintenance_end_date) : null }, client, invoices, payments, consents, today };
    if (actor.role !== "admin") return { ...base, deliveries: [], history: [] };
    const deliveries = await tx<{ id: string; channel: string; recipient: string; kind: string | null; audience: string | null; status: string; error: string | null; attempts: number; next_retry_at: Date | null; created_at: Date; updated_at: Date }[]>`
      select id, channel, recipient, kind, audience, status, error, attempts, next_retry_at, created_at, updated_at from message_deliveries
      where project_id = ${projectId} and purpose = 'maintenance' order by created_at desc limit 200`;
    const history = await tx<{ id: number; action: string; data: Record<string, unknown>; created_at: Date; actor_name: string | null; actor_role: string | null }[]>`
      select a.id, a.action, a.data, a.created_at, u.name as actor_name, a.actor_role from audit_logs a left join users u on u.id = a.actor_id
      where a.project_id = ${projectId} and (a.action like 'maintenance.%' or a.action like 'payment.%' or a.action = 'invoice.issued') order by a.created_at desc limit 200`;
    return { ...base, deliveries, history };
  });
}

/** CSV export of maintenance records. */
export async function exportMaintenanceCsv(actor: Actor) {
  const { rows } = await listMaintenance(actor, "all");
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v instanceof Date ? v.toISOString() : v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = ["Business", "Owner", "Project", "Proposal initiated", "Free start", "Free expiry", "Days remaining", "Monthly fee", "Status", "Exempt", "Paused", "Next billing", "Email status", "WhatsApp status"];
  const body = rows.map((r) => [r.business_name, r.owner_name, r.name, r.proposal_started_at ? istDate(r.proposal_started_at) : "", r.free_maintenance_start_date, r.free_maintenance_end_date,
    r.days_left, r.fee, r.maintenance_status, r.maintenance_exempt ? "yes" : "no", r.maintenance_paused ? "yes" : "no", r.next_billing_date, r.email_status, r.whatsapp_status].map(cell).join(","));
  return [head.map(cell).join(","), ...body].join("\r\n");
}

export function integrationStatus() {
  const i = integrations();
  return { email: i.email, whatsapp: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID), cron: !!process.env.CRON_SECRET };
}
