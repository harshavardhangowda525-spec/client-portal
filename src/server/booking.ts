import { z } from "zod";
import { randomBytes } from "node:crypto";
import { withDb, SYSTEM, assertAdmin, audit, type Actor, type Tx } from "./core";
import { parse, optText } from "./validate";
import { emit, referralEmail, assignAndTask, STAGES } from "./referrals";
import { AppError, notFound } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { appUrl, company } from "@/lib/config";
import { addDays, istToday } from "@/lib/dates";

/**
 * Internal discovery-call calendar. Availability comes only from the weekly hours an admin sets; booked slots are
 * removed; the database's unique index on scheduled start times makes double-booking impossible even under races.
 */
export type BookingSettings = {
  timezone: "Asia/Kolkata"; slot_minutes: number; min_notice_hours: number; horizon_days: number;
  weekly: Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", [string, string][]>; blocked_dates: string[];
  meeting_types: MeetingType[]; default_meeting_link: string;
};
export type MeetingType = "video_call" | "phone" | "whatsapp" | "in_person";
export const MEETING_TYPES: Record<MeetingType, string> = { video_call: "Video call", phone: "Phone call", whatsapp: "WhatsApp call", in_person: "In person" };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DEFAULTS: BookingSettings = { timezone: "Asia/Kolkata", slot_minutes: 30, min_notice_hours: 12, horizon_days: 21,
  weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }, blocked_dates: [], meeting_types: ["video_call", "phone"], default_meeting_link: "" };

export async function getBookingSettings(tx?: Tx): Promise<BookingSettings> {
  const run = async (t: Tx) => {
    const [r] = await t<{ value: Partial<BookingSettings> }[]>`select value from app_settings where key = 'booking'`;
    return { ...DEFAULTS, ...(r?.value ?? {}), timezone: "Asia/Kolkata" as const };
  };
  return tx ? run(tx) : withDb(SYSTEM, run);
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");
const windows = z.array(z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, "end must be after start")).max(6);
const bookingSchema = z.object({
  slot_minutes: z.coerce.number().int().refine((n) => [15, 20, 30, 45, 60].includes(n), "must be 15, 20, 30, 45 or 60"),
  min_notice_hours: z.coerce.number().int().min(0).max(240), horizon_days: z.coerce.number().int().min(1).max(90),
  weekly: z.object(Object.fromEntries(DAYS.map((d) => [d, windows])) as Record<(typeof DAYS)[number], typeof windows>),
  blocked_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(200),
  meeting_types: z.array(z.enum(["video_call", "phone", "whatsapp", "in_person"])).min(1),
  default_meeting_link: z.string().trim().max(500).refine((v) => !v || /^https:\/\//.test(v), "must be an https:// link"),
});

export async function saveBookingSettings(actor: Actor, input: unknown) {
  assertAdmin(actor);
  const d = parse(bookingSchema, input);
  await withDb(actor, async (tx) => {
    await tx`insert into app_settings (key, value) values ('booking', ${tx.json({ ...d, timezone: "Asia/Kolkata" } as never)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await audit(tx, actor, "booking.settings_updated", "settings", "booking", null, { slot_minutes: d.slot_minutes });
  });
}

const istInstant = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const fmtCall = fmt;

/** Real free slots: weekly hours − blocked dates − minimum notice − existing scheduled calls. */
export async function availableSlots(now = new Date(), tx?: Tx) {
  const run = async (t: Tx) => {
    const s = await getBookingSettings(t);
    const today = istToday(now);
    const until = addDays(today, s.horizon_days);
    const taken = await t<{ starts_at: Date; ends_at: Date }[]>`select starts_at, ends_at from discovery_calls where status = 'scheduled' and ends_at > ${now} and starts_at < ${istInstant(until, "23:59")}`;
    const earliest = now.getTime() + s.min_notice_hours * 3600_000;
    const days: { date: string; slots: string[] }[] = [];
    for (let i = 0; i <= s.horizon_days; i++) {
      const date = addDays(today, i);
      if (s.blocked_dates.includes(date)) continue;
      const dow = DAYS[new Date(`${date}T12:00:00+05:30`).getUTCDay()];
      const slots: string[] = [];
      for (const [a, b] of s.weekly[dow] ?? []) {
        for (let m = toMin(a); m + s.slot_minutes <= toMin(b); m += s.slot_minutes) {
          const start = istInstant(date, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
          const end = new Date(start.getTime() + s.slot_minutes * 60_000);
          if (start.getTime() < earliest) continue;
          if (taken.some((c) => new Date(c.starts_at) < end && new Date(c.ends_at) > start)) continue;
          slots.push(start.toISOString());
        }
      }
      if (slots.length) days.push({ date, slots });
    }
    return { days, settings: s };
  };
  return tx ? run(tx) : withDb(SYSTEM, run);
}

// ---------------------------------------------------------------------------
// Prospect (public, by booking token)
// ---------------------------------------------------------------------------
export function newBookingToken() { const t = randomBytes(24).toString("base64url"); return { token: t, hash: sha256(t) }; }
const tokenOk = (t: string) => /^[A-Za-z0-9_-]{32,64}$/.test(t);

async function leadByToken(tx: Tx, token: string) {
  if (!tokenOk(token)) throw notFound("This booking link isn't valid.");
  const [l] = await tx<{ id: string; business_name: string; contact_name: string | null; email: string | null; stage: string; owner_id: string | null }[]>`
    select id, business_name, contact_name, email, stage, owner_id from leads where booking_token_hash = ${sha256(token)}`;
  if (!l) throw notFound("This booking link isn't valid.");
  if (["lost", "disqualified"].includes(l.stage)) throw new AppError("This booking link is no longer active. Please contact us directly.");
  return l;
}

export async function bookingContext(token: string) {
  return withDb(SYSTEM, async (tx) => {
    const l = await leadByToken(tx, token);
    const [call] = await tx<{ id: string; starts_at: Date; ends_at: Date; meeting_type: MeetingType; meeting_link: string | null }[]>`
      select id, starts_at, ends_at, meeting_type, meeting_link from discovery_calls where lead_id = ${l.id} and status = 'scheduled' and ends_at > now() order by starts_at limit 1`;
    const { days, settings } = await availableSlots(new Date(), tx);
    return { lead: { business_name: l.business_name, first_name: (l.contact_name ?? "").split(" ")[0] || null }, call: call ?? null, days, meetingTypes: settings.meeting_types };
  });
}

const bookSchema = z.object({ starts_at: z.string().datetime({ offset: true }), meeting_type: z.enum(["video_call", "phone", "whatsapp", "in_person"]) });

/** Book (or reschedule to) a slot. The slot must be one we actually offer; the unique index stops two people taking it. */
export async function bookByToken(token: string, input: unknown) {
  const d = parse(bookSchema, input);
  const r = await withDb(SYSTEM, async (tx) => {
    const l = await leadByToken(tx, token);
    const { days, settings } = await availableSlots(new Date(), tx);
    const start = new Date(d.starts_at);
    if (!days.some((x) => x.slots.includes(start.toISOString()))) throw new AppError("That time is no longer available. Please choose another slot.");
    if (!settings.meeting_types.includes(d.meeting_type)) throw new AppError("Please choose one of the offered meeting types.");
    const end = new Date(start.getTime() + settings.slot_minutes * 60_000);
    const [prev] = await tx<{ id: string; starts_at: Date }[]>`update discovery_calls set status = 'cancelled', cancelled_at = now() where lead_id = ${l.id} and status = 'scheduled' returning id, starts_at`;
    let call: { id: string };
    try {
      [call] = await tx<{ id: string }[]>`
        insert into discovery_calls (lead_id, owner_id, starts_at, ends_at, meeting_type, meeting_link, booked_by)
        values (${l.id}, ${l.owner_id}, ${start}, ${end}, ${d.meeting_type}, ${d.meeting_type === "video_call" ? settings.default_meeting_link || null : null}, 'prospect') returning id`;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AppError("Someone just booked that time. Please choose another slot.");
      throw e;
    }
    await tx`update leads set call_booked_at = coalesce(call_booked_at, now()), stage = case when stage in ('enquiry_submitted', 'verification_pending', 'qualified') then 'call_scheduled' else stage end where id = ${l.id}`;
    await tx`insert into lead_activities (lead_id, kind, body) values (${l.id}, 'call', ${`${prev ? "Rescheduled" : "Booked"} discovery call: ${fmt(start)} (${MEETING_TYPES[d.meeting_type]})`})`;
    return { leadId: l.id, callId: call.id, start, type: d.meeting_type, email: l.email, name: l.contact_name, rescheduled: !!prev, link: d.meeting_type === "video_call" ? settings.default_meeting_link : "" };
  });
  await emit("referral.call.booked", `referral.call.booked:${r.callId}`, { lead_id: r.leadId }, { call_id: r.callId });
  await referralEmail({ key: `call-confirm:${r.callId}`, to: r.email, subject: `${r.rescheduled ? "Rescheduled" : "Confirmed"}: your call with ${company().name} — ${fmt(r.start)}`,
    body: `Hi ${r.name ?? "there"},\n\nYour discovery call with ${company().name} is ${r.rescheduled ? "rescheduled" : "booked"}.\n\nWhen: ${fmt(r.start)} (India time)\nHow: ${MEETING_TYPES[r.type]}${r.link ? `\nJoin: ${r.link}` : r.type === "video_call" ? "\nWe'll send the meeting link before the call." : r.type === "phone" || r.type === "whatsapp" ? "\nWe'll call you on the number you gave us." : ""}\n\nNeed to change it? ${appUrl()}/book/${token}\n\n${company().name}` });
  return { callId: r.callId };
}

export async function cancelByToken(token: string) {
  const r = await withDb(SYSTEM, async (tx) => {
    const l = await leadByToken(tx, token);
    const [c] = await tx<{ id: string; starts_at: Date }[]>`update discovery_calls set status = 'cancelled', cancelled_at = now() where lead_id = ${l.id} and status = 'scheduled' returning id, starts_at`;
    if (!c) throw new AppError("There's no upcoming call to cancel.");
    await tx`update leads set stage = case when stage = 'call_scheduled' then 'qualified' else stage end where id = ${l.id}`;
    await tx`insert into lead_activities (lead_id, kind, body) values (${l.id}, 'call', ${`Prospect cancelled the call on ${fmt(c.starts_at)}`})`;
    return { leadId: l.id, callId: c.id };
  });
  await emit("referral.call.cancelled", `referral.call.cancelled:${r.callId}`, { lead_id: r.leadId });
  await assignAndTask(r.leadId, "The prospect cancelled their discovery call — follow up to rebook", `call-cancelled-${r.callId}`);
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------
/** Create a fresh booking link for a lead (the old one stops working) so it can be sent manually. */
export async function bookingLinkFor(actor: Actor, leadId: string) {
  assertAdmin(actor);
  const t = newBookingToken();
  await withDb(actor, async (tx) => {
    const r = await tx`update leads set booking_token_hash = ${t.hash} where id = ${leadId}`;
    if (!r.count) throw notFound();
    await audit(tx, actor, "lead.booking_link_created", "lead", leadId, null, {});
  });
  return `${appUrl()}/book/${t.token}`;
}

const teamBookSchema = z.object({ starts_at: z.string().min(10), duration: z.coerce.number().int().min(10).max(240).default(30),
  meeting_type: z.enum(["video_call", "phone", "whatsapp", "in_person"]), meeting_link: z.string().trim().max(500).optional().transform((v) => v || null)
    .refine((v) => !v || /^https:\/\//.test(v), "must be an https:// link") });

/** The team books a call (any time, but never overlapping another scheduled call). */
export async function scheduleCall(actor: Actor, leadId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(teamBookSchema, input);
  const start = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(d.starts_at) ? d.starts_at : `${d.starts_at}:00+05:30`);
  if (Number.isNaN(start.getTime())) throw new AppError("Choose a valid date and time.");
  if (start.getTime() < Date.now()) throw new AppError("Choose a time in the future.");
  const end = new Date(start.getTime() + d.duration * 60_000);
  const callId = await withDb(actor, async (tx) => {
    const [l] = await tx<{ id: string; owner_id: string | null }[]>`select id, owner_id from leads where id = ${leadId}`;
    if (!l) throw notFound();
    const [clash] = await tx`select 1 from discovery_calls where status = 'scheduled' and starts_at < ${end} and ends_at > ${start}`;
    if (clash) throw new AppError("That time overlaps another scheduled call.");
    await tx`update discovery_calls set status = 'cancelled', cancelled_at = now() where lead_id = ${leadId} and status = 'scheduled'`;
    let c: { id: string };
    try {
      [c] = await tx<{ id: string }[]>`insert into discovery_calls (lead_id, owner_id, starts_at, ends_at, meeting_type, meeting_link, booked_by)
        values (${leadId}, ${l.owner_id ?? actor.userId}, ${start}, ${end}, ${d.meeting_type}, ${d.meeting_link}, 'team') returning id`;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AppError("That time is already booked.");
      throw e;
    }
    await tx`update leads set call_booked_at = coalesce(call_booked_at, now()), stage = case when stage in ('enquiry_submitted', 'verification_pending', 'qualified') then 'call_scheduled' else stage end where id = ${leadId}`;
    await tx`insert into lead_activities (lead_id, actor_id, kind, body) values (${leadId}, ${actor.userId}, 'call', ${`Discovery call scheduled: ${fmt(start)} (${MEETING_TYPES[d.meeting_type]})`})`;
    return c.id;
  });
  await emit("referral.call.booked", `referral.call.booked:${callId}`, { lead_id: leadId }, { call_id: callId, by: "team" });
  const [l] = await withDb(SYSTEM, (tx) => tx<{ email: string | null; contact_name: string | null }[]>`select email, contact_name from leads where id = ${leadId}`);
  await referralEmail({ key: `call-confirm:${callId}`, to: l?.email, subject: `Confirmed: your call with ${company().name} — ${fmt(start)}`,
    body: `Hi ${l?.contact_name ?? "there"},\n\nYour discovery call with ${company().name} is booked for ${fmt(start)} (India time), ${MEETING_TYPES[d.meeting_type].toLowerCase()}.${d.meeting_link ? `\nJoin: ${d.meeting_link}` : ""}\n\nReply to this email if you need to change it.\n\n${company().name}` });
  return callId;
}

const outcomeSchema = z.object({ outcome: z.enum(["qualified", "proposal_requested", "not_a_fit", "follow_up", "no_show"]), notes: optText(5000) });

export async function recordCallOutcome(actor: Actor, callId: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(outcomeSchema, input);
  const leadId = await withDb(actor, async (tx) => {
    const [c] = await tx<{ lead_id: string; status: string; starts_at: Date }[]>`select lead_id, status, starts_at from discovery_calls where id = ${callId}`;
    if (!c) throw notFound();
    if (c.status !== "scheduled" && c.status !== "completed") throw new AppError("This call was cancelled.");
    if (new Date(c.starts_at).getTime() > Date.now() && d.outcome !== "no_show") throw new AppError("You can record the outcome once the call has started.");
    const noShow = d.outcome === "no_show";
    await tx`update discovery_calls set status = ${noShow ? "no_show" : "completed"}, outcome = ${d.outcome}, notes = ${d.notes} where id = ${callId}`;
    if (!noShow) {
      await tx`update leads set call_completed_at = coalesce(call_completed_at, now()),
                 qualified_at = case when ${d.outcome} in ('qualified', 'proposal_requested') then coalesce(qualified_at, now()) else qualified_at end,
                 verified_at = coalesce(verified_at, now()),
                 stage = case when stage in ('enquiry_submitted', 'verification_pending', 'qualified', 'call_scheduled') then 'call_completed' else stage end where id = ${c.lead_id}`;
      if (d.outcome === "not_a_fit") await tx`update leads set stage = 'disqualified', lost_reason = 'Not a fit (discovery call)', closed_at = now() where id = ${c.lead_id}`;
    } else {
      await tx`update leads set stage = case when stage = 'call_scheduled' then 'qualified' else stage end where id = ${c.lead_id}`;
    }
    await tx`insert into lead_activities (lead_id, actor_id, kind, body) values (${c.lead_id}, ${actor.userId}, 'call', ${`Call outcome: ${d.outcome.replace(/_/g, " ")}${d.notes ? ` — ${d.notes}` : ""}`})`;
    await tx`update lead_tasks set status = 'done', completed_at = now() where lead_id = ${c.lead_id} and status = 'open' and dedupe_key like ${`outcome:%`}`;
    await audit(tx, actor, "lead.call_outcome", "discovery_call", callId, null, { outcome: d.outcome });
    return c.lead_id;
  });
  if (d.outcome === "no_show") await assignAndTask(leadId, "The prospect missed the discovery call — follow up to rebook", `no-show-${callId}`);
  else await emit("referral.call.completed", `referral.call.completed:${callId}`, { lead_id: leadId }, { call_id: callId, outcome: d.outcome });
}

export async function cancelCall(actor: Actor, callId: string) {
  assertAdmin(actor);
  await withDb(actor, async (tx) => {
    const [c] = await tx<{ lead_id: string; starts_at: Date }[]>`update discovery_calls set status = 'cancelled', cancelled_at = now() where id = ${callId} and status = 'scheduled' returning lead_id, starts_at`;
    if (!c) throw new AppError("Only scheduled calls can be cancelled.");
    await tx`update leads set stage = case when stage = 'call_scheduled' then 'qualified' else stage end where id = ${c.lead_id}`;
    await tx`insert into lead_activities (lead_id, actor_id, kind, body) values (${c.lead_id}, ${actor.userId}, 'call', ${`Call on ${fmt(c.starts_at)} cancelled by the team`})`;
  });
}

export async function listCalls(actor: Actor, scope: "upcoming" | "past" = "upcoming") {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<{ id: string; lead_id: string; starts_at: Date; ends_at: Date; meeting_type: MeetingType; meeting_link: string | null; status: string; outcome: string | null;
    business_name: string; contact_name: string | null; owner_name: string | null; stage: string }[]>`
    select c.*, l.business_name, l.contact_name, l.stage, u.name as owner_name from discovery_calls c join leads l on l.id = c.lead_id left join users u on u.id = c.owner_id
    where ${scope === "upcoming" ? tx`c.status = 'scheduled' and c.ends_at > now() - interval '2 hours'` : tx`(c.status <> 'scheduled' or c.ends_at <= now() - interval '2 hours')`}
    order by c.starts_at ${scope === "upcoming" ? tx`asc` : tx`desc`} limit 200`);
}

/** Daily: reminders for tomorrow's calls; prompt owners to record outcomes of past calls. */
export async function runCallAutomation(now = new Date()) {
  const due = await withDb(SYSTEM, (tx) => tx<{ id: string; lead_id: string; starts_at: Date; meeting_type: MeetingType; meeting_link: string | null; email: string | null; contact_name: string | null }[]>`
    select c.id, c.lead_id, c.starts_at, c.meeting_type, c.meeting_link, l.email, l.contact_name from discovery_calls c join leads l on l.id = c.lead_id
    where c.status = 'scheduled' and c.reminder_sent_at is null and c.starts_at > ${now} and c.starts_at < ${new Date(now.getTime() + 36 * 3600_000)}`);
  let reminders = 0;
  for (const c of due) {
    const r = await referralEmail({ key: `call-reminder:${c.id}`, to: c.email, subject: `Reminder: your call with ${company().name} — ${fmt(c.starts_at)}`,
      body: `Hi ${c.contact_name ?? "there"},\n\nA quick reminder of your discovery call with ${company().name} on ${fmt(c.starts_at)} (India time), ${MEETING_TYPES[c.meeting_type].toLowerCase()}.${c.meeting_link ? `\nJoin: ${c.meeting_link}` : ""}\n\nSee you then!\n${company().name}` });
    if (r === "sent") reminders++;
    await withDb(SYSTEM, (tx) => tx`update discovery_calls set reminder_sent_at = now() where id = ${c.id}`);
  }
  const ended = await withDb(SYSTEM, (tx) => tx<{ id: string; lead_id: string }[]>`select id, lead_id from discovery_calls where status = 'scheduled' and ends_at < ${new Date(now.getTime() - 2 * 3600_000)}`);
  for (const c of ended) await assignAndTask(c.lead_id, "Record the outcome of the discovery call", `outcome:${c.id}`);
  return { reminders, outcomePrompts: ended.length };
}

export { STAGES };

// Event handlers for calls (registered with the referral event engine).
import { _handlers } from "./referrals";
_handlers["referral.call.booked"] = async ({ lead_id }) => {
  await withDb(SYSTEM, async (tx) => {
    const [l] = await tx<{ owner_id: string | null; business_name: string }[]>`select owner_id, business_name from leads where id = ${lead_id!}`;
    if (l?.owner_id) await tx`insert into notifications (user_id, type, title, link) values (${l.owner_id}, 'referral_call', ${`Discovery call booked: ${l.business_name}`}, ${`/admin/referrals/leads/${lead_id}`})`;
    await tx`update lead_tasks set status = 'done', completed_at = now() where lead_id = ${lead_id!} and status = 'open' and dedupe_key like 'book-call:%'`;
  });
};
_handlers["referral.call.cancelled"] = async () => undefined;
_handlers["referral.call.completed"] = async ({ lead_id, outcome }) => {
  if (outcome === "qualified" || outcome === "proposal_requested") await assignAndTask(lead_id!, "Prepare and send a proposal", "proposal");
  else if (outcome === "follow_up") await assignAndTask(lead_id!, "Follow up after the discovery call", "after-call");
};
