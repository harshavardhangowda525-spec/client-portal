import { z } from "zod";
import { withDb, asSystem, audit, type Actor } from "./core";
import { parse, optText } from "./validate";
import { availableSlots, fmtCall, MEETING_TYPES, type MeetingType } from "./booking";
import { notifyAdmins } from "./notify";
import { emit, referralEmail } from "./referrals";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { appUrl, company } from "@/lib/config";

/**
 * Client meetings share the internal calendar with discovery calls: only real free slots are offered, and the unique
 * index on scheduled start times (plus an advisory lock) makes double booking impossible. No external calendar or
 * video link is claimed unless one is configured (Settings → Discovery calls → default meeting link).
 */
export const PURPOSES = {
  consultation: { label: "15-minute consultation", minutes: 15, hint: "New ideas, services or questions" },
  project_checkin: { label: "Project check-in", minutes: 30, hint: "Progress, priorities and questions" },
  design_walkthrough: { label: "Design walkthrough", minutes: 30, hint: "We screen-share the latest design" },
  support: { label: "Support call", minutes: 30, hint: "Something isn't working as expected" },
} as const;
export type Purpose = keyof typeof PURPOSES;
export type Meeting = { id: string; purpose: Purpose | null; agenda: string | null; starts_at: Date; ends_at: Date; meeting_type: MeetingType; meeting_link: string | null;
  status: "scheduled" | "completed" | "cancelled" | "no_show"; project_id: string | null; owner_name: string | null };

function ensureClient(actor: Actor) { if (actor.role !== "client" || !actor.clientId) throw forbidden(); }

export async function clientMeetings(actor: Actor) {
  ensureClient(actor);
  const slots = await availableSlots();
  const meetings = await withDb(actor, (tx) => tx<Meeting[]>`
    select c.id, c.purpose, c.agenda, c.starts_at, c.ends_at, c.meeting_type, c.meeting_link, c.status, c.project_id, null as owner_name
    from discovery_calls c where c.client_id = ${actor.clientId!} order by c.starts_at desc limit 50`);
  const now = Date.now();
  return {
    days: slots.days, meetingTypes: slots.settings.meeting_types,
    upcoming: meetings.filter((m) => m.status === "scheduled" && new Date(m.ends_at).getTime() > now).reverse(),
    history: meetings.filter((m) => !(m.status === "scheduled" && new Date(m.ends_at).getTime() > now)),
  };
}

const bookSchema = z.object({
  purpose: z.enum(["consultation", "project_checkin", "design_walkthrough", "support"]),
  starts_at: z.string().datetime({ offset: true }),
  meeting_type: z.enum(["video_call", "phone", "whatsapp", "in_person"]),
  agenda: optText(2000),
  project_id: z.string().uuid().nullable().optional().or(z.literal("").transform(() => null)),
  replaces: z.string().uuid().nullable().optional().or(z.literal("").transform(() => null)),
});

/** Book (or reschedule, with `replaces`) a meeting in a slot that is free right now. */
export async function bookMeeting(actor: Actor, input: unknown) {
  ensureClient(actor);
  const d = parse(bookSchema, input);
  const start = new Date(d.starts_at);
  const end = new Date(start.getTime() + PURPOSES[d.purpose].minutes * 60_000);
  const r = await withDb(actor, async (tx) => {
    if (d.project_id) { const [p] = await tx`select 1 from projects where id = ${d.project_id}`; if (!p) throw notFound(); }
    if (d.replaces) {
      const [old] = await tx`select 1 from discovery_calls where id = ${d.replaces} and client_id = ${actor.clientId!} and status = 'scheduled'`;
      if (!old) throw notFound("That meeting can't be rescheduled.");
    }
    return asSystem(tx, actor, async () => {
      await tx`select pg_advisory_xact_lock(hashtext('discovery_calendar'))`;
      const { days, settings } = await availableSlots(new Date(), tx);
      if (!settings.meeting_types.includes(d.meeting_type)) throw new AppError("That meeting type isn't offered.", "invalid");
      // When rescheduling, the old slot doesn't block the new one.
      if (d.replaces) await tx`update discovery_calls set status = 'cancelled', cancelled_at = now() where id = ${d.replaces}`;
      const free = (d.replaces ? (await availableSlots(new Date(), tx)).days : days).some((x) => x.slots.includes(start.toISOString()));
      if (!free) throw new AppError("That time was just taken or isn't available. Please pick another slot.", "conflict");
      const [pm] = d.project_id ? await tx<{ project_manager_id: string | null }[]>`select project_manager_id from projects where id = ${d.project_id}` : [];
      const link = d.meeting_type === "video_call" && settings.default_meeting_link ? settings.default_meeting_link : null;
      try {
        const [c] = await tx<{ id: string }[]>`
          insert into discovery_calls (client_id, project_id, purpose, agenda, owner_id, starts_at, ends_at, meeting_type, meeting_link, booked_by)
          values (${actor.clientId!}, ${d.project_id ?? null}, ${d.purpose}, ${d.agenda ?? null}, ${pm?.project_manager_id ?? null}, ${start}, ${end}, ${d.meeting_type}, ${link}, 'client') returning id`;
        await audit(tx, actor, d.replaces ? "meeting.rescheduled" : "meeting.booked", "discovery_call", c.id, d.project_id ?? null, { purpose: d.purpose, starts_at: start.toISOString() });
        const [cp] = await tx<{ business_name: string; email: string; owner_name: string; notify_email: boolean }[]>`select business_name, email, owner_name, notify_email from client_profiles where id = ${actor.clientId!}`;
        await notifyAdmins(tx, actor, { type: "meeting", title: `${cp.business_name} ${d.replaces ? "rescheduled" : "booked"} a ${PURPOSES[d.purpose].label.toLowerCase()}: ${fmtCall(start)}`, link: "/admin/referrals/calls" });
        return { id: c.id, link, cp };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new AppError("That time was just taken. Please pick another slot.", "conflict");
        throw e;
      }
    });
  });
  if (r.cp.notify_email) {
    await referralEmail({ key: `meeting-booked:${r.id}`, to: r.cp.email, subject: `Confirmed: ${PURPOSES[d.purpose].label} — ${fmtCall(start)}`,
      body: `Hi ${r.cp.owner_name},\n\nYour ${PURPOSES[d.purpose].label.toLowerCase()} with ${company().name} is booked for ${fmtCall(start)} (India time), ${MEETING_TYPES[d.meeting_type].toLowerCase()}.${r.link ? `\nJoin: ${r.link}` : "\nWe'll call you on your registered number."}\n\nReschedule or cancel: ${appUrl()}/portal/meetings\n\n${company().name}` });
  }
  await emit("meeting.booked", `meeting.booked:${r.id}`, { client_id: actor.clientId }, { purpose: d.purpose });
  return r.id;
}

export async function cancelMeeting(actor: Actor, id: string) {
  ensureClient(actor);
  await withDb(actor, async (tx) => {
    const [m] = await tx<{ starts_at: Date; status: string }[]>`select starts_at, status from discovery_calls where id = ${id} and client_id = ${actor.clientId!}`;
    if (!m) throw notFound();
    if (m.status !== "scheduled" || new Date(m.starts_at).getTime() < Date.now()) throw new AppError("Only upcoming meetings can be cancelled.", "conflict");
    await asSystem(tx, actor, async () => {
      await tx`update discovery_calls set status = 'cancelled', cancelled_at = now() where id = ${id}`;
      await notifyAdmins(tx, actor, { type: "meeting", title: `A client cancelled their meeting on ${fmtCall(m.starts_at)}`, link: "/admin/referrals/calls" });
    });
    await audit(tx, actor, "meeting.cancelled", "discovery_call", id, null, {});
  });
  await emit("meeting.cancelled", `meeting.cancelled:${id}`, { client_id: actor.clientId });
}

