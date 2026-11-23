import { z } from "zod";
import { withDb, SYSTEM } from "./core";
import { parse, text, optText, email as emailSchema } from "./validate";
import { emit, getReferralSettings, referralEmail, assignAndTask } from "./referrals";
import { newBookingToken } from "./booking";
import { AppError, notFound } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { appUrl, company } from "@/lib/config";
import { istToday } from "@/lib/dates";

/**
 * Public referral landing page + enquiry. Nothing about the referring client is shown publicly;
 * the token is checked on the server and attribution is written once, server-side.
 */
const tokenOk = (t: string) => /^[A-Za-z0-9_-]{32,64}$/.test(t);
const hashIp = (ip: string | null | undefined) => sha256(`${ip || "unknown"}|${istToday()}`);

async function linkByToken(token: string) {
  if (!tokenOk(token)) return null;
  const [l] = await withDb(SYSTEM, (tx) => tx<{ id: string; client_id: string; status: string; expires_at: Date | null }[]>`
    select id, client_id, status, expires_at from referral_links where token = ${token}`);
  if (!l || l.status !== "active" || (l.expires_at && new Date(l.expires_at) < new Date())) return null;
  return l;
}

/** Landing page data. Returns null when the link is invalid, disabled, expired or the program is off. */
export async function landing(token: string, ip?: string | null) {
  const s = await getReferralSettings();
  const link = await linkByToken(token);
  if (!link || !s.enabled || s.paused) return null;
  // Unique visitors per day; the IP itself is never stored.
  const visitor = hashIp(ip);
  const [v] = await withDb(SYSTEM, (tx) => tx<{ id: string }[]>`insert into referral_visits (link_id, visitor, visited_on) values (${link.id}, ${visitor}, ${istToday()})
    on conflict do nothing returning id`);
  if (v) await emit("referral.link.visited", `referral.link.visited:${v.id}`, { client_id: link.client_id }, { link_id: link.id });
  const testimonials = await withDb(SYSTEM, (tx) => tx<{ comments: string; overall: number; owner_name: string; business_name: string }[]>`
    select f.comments, f.overall, c.owner_name, c.business_name from project_feedback f join client_profiles c on c.id = f.client_id
    where f.testimonial_consent and f.testimonial_approved and f.comments is not null and length(f.comments) > 10 order by f.created_at desc limit 6`);
  return {
    headline: s.landing_headline, intro: s.landing_intro, services: s.landing_services, problems: s.landing_problems, company: company().name,
    testimonials: testimonials.map((t) => ({ quote: t.comments.slice(0, 400), rating: t.overall, name: `${t.owner_name.split(" ")[0]}, ${t.business_name}` })),
  };
}

const SERVICES = ["Website", "Mobile app", "AI automation / chatbot", "Online booking or ordering", "CRM / business software", "Website care & maintenance", "Not sure yet"];
export const ENQUIRY_SERVICES = SERVICES;
const enquirySchema = z.object({
  business_name: text(200, 2), contact_name: text(200, 2), business_category: optText(100), email: emailSchema, phone: optText(40)
    .refine((v) => !v || /^[+\d][\d\s()-]{6,}$/.test(v), "is not a valid phone number"),
  service: z.enum(SERVICES as [string, ...string[]]), problem: text(5000, 10), budget_range: optText(60),
  preferred_contact: z.enum(["phone", "whatsapp", "email", "video_call", "in_person"]),
  consent: z.literal(true, { error: "Please agree to be contacted" }),
  website: z.string().max(0, "Spam check failed").optional().default(""),   // honeypot: real people leave it empty
  started_at: z.coerce.number().int(),
});

/** Submit an enquiry from a referral link. Returns the booking token (shown once) so the prospect can book a call. */
export async function submitEnquiry(token: string, input: unknown, meta: { ip?: string | null } = {}) {
  const d = parse(enquirySchema, input);
  const age = Date.now() - d.started_at;
  if (age < 2500 || age > 24 * 3600_000) throw new AppError("Please take a moment to fill in the form, then try again.");
  const s = await getReferralSettings();
  const link = await linkByToken(token);
  if (!link || !s.enabled || s.paused) throw notFound("This referral link isn't active any more. You can still contact us directly.");
  const ip = hashIp(meta.ip);
  const email = d.email.toLowerCase();
  const out = await withDb(SYSTEM, async (tx) => {
    const [{ recent, perLink }] = await tx<{ recent: number; perLink: number }[]>`
      select (select count(*)::int from leads where submitted_ip = ${ip} and created_at > now() - interval '1 hour') as recent,
             (select count(*)::int from referral_attributions where link_id = ${link.id} and created_at > now() - interval '1 hour') as "perLink"`;
    if (recent >= s.max_enquiries_per_hour) throw new AppError("Too many enquiries from this connection. Please try again later.");
    const booking = newBookingToken();
    // Existing open lead with this email → same lead (no duplicate), attribution unchanged.
    const [dup] = await tx<{ id: string; created_at: Date }[]>`select id, created_at from leads where lower(email) = ${email} and stage not in ('lost', 'disqualified') order by created_at limit 1`;
    if (dup) {
      await tx`update leads set booking_token_hash = ${booking.hash} where id = ${dup.id}`;
      await tx`insert into lead_activities (lead_id, kind, body, data) values (${dup.id}, 'duplicate', ${"Another enquiry was submitted through a referral link"}, ${tx.json({ service: d.service, problem: d.problem.slice(0, 500) } as never)})`;
      return { leadId: dup.id, token: booking.token, duplicate: true, flags: [] as string[] };
    }
    const referrer = await tx<{ email: string }[]>`select email from client_profiles where id = ${link.client_id}
      union select email from users where client_id = ${link.client_id}`;
    const flags: string[] = [];
    if (referrer.some((r) => r.email.toLowerCase() === email)) flags.push("self_referral");
    const [existingClient] = await tx<{ id: string }[]>`select id from client_profiles where lower(email) = ${email} limit 1`;
    if (existingClient && existingClient.id !== link.client_id) flags.push("existing_client");
    if (existingClient?.id === link.client_id && !flags.includes("self_referral")) flags.push("self_referral");
    if (perLink >= 10) flags.push("suspicious");
    const [lead] = await tx<{ id: string }[]>`
      insert into leads (source, stage, business_name, contact_name, email, phone, business_category, service, problem, budget_range, preferred_contact,
                         contact_consent_at, flags, booking_token_hash, verified_at, submitted_ip, client_id)
      values ('client_referral', ${flags.length ? "verification_pending" : "enquiry_submitted"}, ${d.business_name}, ${d.contact_name}, ${email}, ${d.phone}, ${d.business_category},
              ${d.service}, ${d.problem}, ${d.budget_range}, ${d.preferred_contact}, now(), ${flags}, ${booking.hash}, ${flags.length ? null : new Date()}, ${ip},
              ${flags.includes("existing_client") ? existingClient!.id : null})
      returning id`;
    // Attribution only for genuine new referrals (not self-referrals or existing clients).
    if (!flags.includes("self_referral") && !flags.includes("existing_client")) {
      const [w] = await tx<{ project_id: string }[]>`select project_id from referral_workflows where client_id = ${link.client_id} and status = 'referral_eligible' order by updated_at desc limit 1`;
      await tx`insert into referral_attributions (lead_id, referrer_client_id, link_id, project_id, method) values (${lead.id}, ${link.client_id}, ${link.id}, ${w?.project_id ?? null}, 'link')`;
    }
    await tx`insert into lead_activities (lead_id, kind, body, data) values (${lead.id}, 'created', ${"Enquiry submitted through a client referral link"}, ${tx.json({ flags } as never)})`;
    return { leadId: lead.id, token: booking.token, duplicate: false, flags, referrerClientId: link.client_id };
  });
  if (!out.duplicate) {
    await emit("referral.enquiry.submitted", `referral.enquiry.submitted:${out.leadId}`, { lead_id: out.leadId, client_id: link.client_id }, { flags: out.flags });
  }
  await referralEmail({ key: `lead-ack:${out.leadId}:${out.duplicate ? Date.now() : "first"}`, to: email, subject: `Thanks for contacting ${company().name}`,
    body: `Hi ${d.contact_name.split(" ")[0]},\n\nThanks for your enquiry about ${d.service.toLowerCase()}. We'll review it and get back to you soon.\n\nWant to talk sooner? Pick a time for a free discovery call:\n${appUrl()}/book/${out.token}\n\n${company().name}` });
  return { token: out.token, duplicate: out.duplicate };
}

import { _handlers } from "./referrals";
_handlers["referral.enquiry.submitted"] = async ({ lead_id, client_id, flags }) => {
  const f = (flags as string[]) ?? [];
  await assignAndTask(lead_id!, f.length ? `Check this enquiry (${f.join(", ").replace(/_/g, " ")}) before contacting` : "Review the new referral enquiry and contact the prospect", "enquiry");
  const { adminRecipient } = await import("./resolve-email");
  const to = await adminRecipient().catch(() => "");
  const [l] = await withDb(SYSTEM, (tx) => tx<{ business_name: string; service: string | null }[]>`select business_name, service from leads where id = ${lead_id!}`);
  await referralEmail({ key: `lead-admin:${lead_id}`, to, subject: `[Referrals] New referral enquiry: ${l?.business_name ?? ""}`,
    body: `A new enquiry arrived through a client referral link.\n\nBusiness: ${l?.business_name}\nService: ${l?.service ?? "—"}${f.length ? `\nFlags: ${f.join(", ")}` : ""}\n\n${appUrl()}/admin/referrals/leads/${lead_id}` });
  if (client_id && !f.length) {
    await withDb(SYSTEM, async (tx) => {
      const { notifyClientUsers } = await import("./notify");
      await notifyClientUsers(tx, null, client_id, { type: "referral_update", link: "/portal/referrals", title: "Someone you referred has sent us an enquiry — thank you!" });
    });
  }
};
