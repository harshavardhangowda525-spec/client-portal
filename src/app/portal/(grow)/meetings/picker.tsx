"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { bookMeetingAction } from "@/app/actions/growth";

const day = (d: string) => new Date(`${d}T12:00:00+05:30`);
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

export function MeetingPicker({ days, meetingTypes, purposes, projects, replaces, initialPurpose }: {
  days: { date: string; slots: string[] }[]; meetingTypes: [string, string][]; purposes: { key: string; label: string; hint: string; minutes: number }[];
  projects: { id: string; name: string }[]; replaces: string | null; initialPurpose: string;
}) {
  const [purpose, setPurpose] = useState(initialPurpose);
  const [d, setD] = useState(0);
  const [slot, setSlot] = useState<string | null>(null);
  const current = days[d];
  return (
    <ActionForm action={bookMeetingAction} className="stack" toast onDone={(s) => { if (s?.ok) { setSlot(null); if (replaces) window.location.assign("/portal/meetings"); } }}>
      {replaces && <input type="hidden" name="replaces" value={replaces} />}
      <fieldset className="stack-sm">
        <legend className="label" style={{ marginBottom: 8 }}>1. What&apos;s it about?</legend>
        <div className="grid grid-2">
          {purposes.map((p) => (
            <label key={p.key} className="choice">
              <input type="radio" name="purpose" value={p.key} checked={purpose === p.key} onChange={() => setPurpose(p.key)} />
              <strong className="small">{p.label}</strong><span className="tiny faint">{p.minutes} min · {p.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="stack-sm">
        <span className="label">2. Pick a day</span>
        <div className="day-strip" role="group" aria-label="Day">
          {days.map((x, i) => (
            <button key={x.date} type="button" className="day-btn" aria-pressed={i === d} onClick={() => { setD(i); setSlot(null); }}>
              <span className="tiny" style={{ opacity: 0.8 }}>{day(x.date).toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" })}</span>
              <strong>{day(x.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</strong>
              <span className="tiny" style={{ opacity: 0.8 }}>{x.slots.length} free</span>
            </button>
          ))}
        </div>
      </div>
      <div className="stack-sm">
        <span className="label">3. Pick a time (IST)</span>
        <div className="slot-grid" role="group" aria-label="Time">
          {current.slots.map((s) => <button key={s} type="button" className="slot" aria-pressed={slot === s} onClick={() => setSlot(s)}>{time(s)}</button>)}
        </div>
        <input type="hidden" name="starts_at" value={slot ?? ""} />
      </div>
      <div className="form-grid">
        <label className="field"><span className="label">How should we meet?</span>
          <select name="meeting_type" className="select" defaultValue={meetingTypes[0]?.[0]}>{meetingTypes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {projects.length > 0 && (
          <label className="field"><span className="label">Project (optional)</span>
            <select name="project_id" className="select" defaultValue=""><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        )}
        <label className="field full"><span className="label">Anything we should prepare? (optional)</span><textarea name="agenda" className="textarea" maxLength={2000} /></label>
      </div>
      <div className="form-actions"><Submit disabled={!slot}>{replaces ? "Move meeting" : "Confirm booking"}</Submit></div>
    </ActionForm>
  );
}
