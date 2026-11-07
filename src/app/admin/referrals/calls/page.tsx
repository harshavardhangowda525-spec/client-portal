import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listCalls, getBookingSettings, availableSlots, fmtCall, MEETING_TYPES } from "@/server/booking";
import { Badge, Empty, Panel } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { saveBookingSettingsAction } from "@/app/actions/referrals";

export const metadata = { title: "Discovery calls" };
export const dynamic = "force-dynamic";
const DAYS: [string, string][] = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];

export default async function Calls() {
  const actor = await requireAdmin();
  const [upcoming, past, s, slots] = await Promise.all([listCalls(actor, "upcoming"), listCalls(actor, "past"), getBookingSettings(), availableSlots()]);
  const free = slots.days.reduce((n, d) => n + d.slots.length, 0);
  const table = (rows: (typeof upcoming)[number][]) => rows.length === 0 ? <Empty icon="clock" title="No calls" /> : (
    <div className="table-wrap"><table className="table table-cards"><thead><tr><th>When (IST)</th><th>Lead</th><th>Type</th><th>Status</th><th>Owner</th></tr></thead>
      <tbody>{rows.map((c) => (
        <tr key={c.id}><td data-label="When">{fmtCall(c.starts_at)}</td><td data-label="Lead"><Link href={`/admin/referrals/leads/${c.lead_id}`}>{c.business_name}</Link><div className="tiny faint">{c.contact_name ?? ""}</div></td>
          <td data-label="Type" className="small">{MEETING_TYPES[c.meeting_type]}</td><td data-label="Status"><Badge tone={c.status === "completed" ? "green" : c.status === "scheduled" ? "blue" : ""}>{c.status.replace("_", " ")}</Badge>{c.outcome && <div className="tiny faint">{c.outcome.replace(/_/g, " ")}</div>}</td>
          <td data-label="Owner" className="small">{c.owner_name ?? "—"}</td></tr>
      ))}</tbody></table></div>
  );
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <div className="stack">
        <Panel title="Upcoming calls">{table(upcoming)}</Panel>
        <Panel title="Past calls">{table(past.slice(0, 50))}</Panel>
      </div>
      <Panel title="Your availability" sub={`Prospects can only pick these times (India time). ${free} free slot(s) in the next ${s.horizon_days} days.`}>
        <ActionForm action={saveBookingSettingsAction} className="stack-sm" toast>
          {DAYS.map(([k, l]) => (
            <label key={k} className="field"><span className="label">{l}</span>
              <input name={`day_${k}`} className="input" defaultValue={(s.weekly[k as keyof typeof s.weekly] ?? []).map(([a, b]) => `${a}-${b}`).join(", ")} placeholder="e.g. 10:00-13:00, 15:00-18:00 (empty = closed)" /></label>
          ))}
          <div className="form-grid">
            <label className="field"><span className="label">Call length (min)</span><select name="slot_minutes" className="select" defaultValue={s.slot_minutes}>{[15, 20, 30, 45, 60].map((n) => <option key={n}>{n}</option>)}</select></label>
            <label className="field"><span className="label">Minimum notice (hours)</span><input name="min_notice_hours" type="number" min={0} className="input" defaultValue={s.min_notice_hours} /></label>
            <label className="field"><span className="label">Bookable days ahead</span><input name="horizon_days" type="number" min={1} max={90} className="input" defaultValue={s.horizon_days} /></label>
          </div>
          <label className="field"><span className="label">Blocked dates (holidays)</span><input name="blocked_dates" className="input" defaultValue={s.blocked_dates.join(", ")} placeholder="2026-12-25, 2027-01-01" /></label>
          <fieldset className="row" style={{ border: 0, padding: 0, flexWrap: "wrap" }}><legend className="label">Meeting types offered</legend>
            {Object.entries(MEETING_TYPES).map(([k, v]) => <label key={k} className="check"><input type="checkbox" name="meeting_types" value={k} defaultChecked={s.meeting_types.includes(k as never)} /> {v}</label>)}</fieldset>
          <label className="field"><span className="label">Default video link (optional)</span><input name="default_meeting_link" className="input" defaultValue={s.default_meeting_link} placeholder="https://meet.google.com/…" /></label>
          <Submit>Save availability</Submit>
        </ActionForm>
      </Panel>
    </div>
  );
}
