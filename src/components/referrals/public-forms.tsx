"use client";

import { useEffect, useState } from "react";
import { ActionForm, Submit } from "../forms";
import { submitEnquiryAction, bookAction, cancelBookingAction } from "@/app/actions/referrals";

export function EnquiryForm({ token, services }: { token: string; services: string[] }) {
  const [started, setStarted] = useState(0);
  useEffect(() => setStarted(Date.now()), []);
  return (
    <ActionForm action={submitEnquiryAction.bind(null, token)} className="form-grid" toast>
      <input type="hidden" name="started_at" value={started} />
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      </div>
      <label className="field"><span className="label">Business name</span><input name="business_name" className="input" required minLength={2} maxLength={200} autoComplete="organization" /></label>
      <label className="field"><span className="label">Your name</span><input name="contact_name" className="input" required minLength={2} maxLength={200} autoComplete="name" /></label>
      <label className="field"><span className="label">Email</span><input name="email" type="email" className="input" required maxLength={320} autoComplete="email" /></label>
      <label className="field"><span className="label">Phone / WhatsApp (optional)</span><input name="phone" type="tel" className="input" maxLength={40} autoComplete="tel" /></label>
      <label className="field"><span className="label">Business category</span><input name="business_category" className="input" maxLength={100} placeholder="e.g. Restaurant, salon, clinic" /></label>
      <label className="field"><span className="label">What do you need?</span><select name="service" className="select" required defaultValue="">
        <option value="" disabled>Choose a service</option>{services.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="field full"><span className="label">What problem would you like to solve?</span>
        <textarea name="problem" className="textarea" required minLength={10} maxLength={5000} placeholder="e.g. We take bookings by phone and miss customers after hours." /></label>
      <label className="field"><span className="label">Budget range (optional)</span><select name="budget_range" className="select" defaultValue="">
        <option value="">Prefer not to say</option><option>Under ₹10,000</option><option>₹10,000 – ₹50,000</option><option>₹50,000 – ₹2,00,000</option><option>Above ₹2,00,000</option></select></label>
      <label className="field"><span className="label">How should we contact you?</span><select name="preferred_contact" className="select" defaultValue="phone">
        <option value="phone">Phone call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="video_call">Video call</option><option value="in_person">In person</option></select></label>
      <label className="check full"><input type="checkbox" name="consent" required /> <span>I agree that Infinity Web &amp; Apps may contact me about this enquiry. My details won&apos;t be shared with anyone else.</span></label>
      <div className="form-actions full"><Submit className="btn btn-primary btn-lg" pendingText="Sending…">Request a free consultation</Submit></div>
    </ActionForm>
  );
}

const LABEL: Record<string, string> = { video_call: "Video call", phone: "Phone call", whatsapp: "WhatsApp call", in_person: "In person" };
const dayLabel = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function SlotPicker({ token, days, meetingTypes, hasBooking }: { token: string; days: { date: string; slots: string[] }[]; meetingTypes: string[]; hasBooking: boolean }) {
  const [day, setDay] = useState(days[0]?.date ?? "");
  const [slot, setSlot] = useState("");
  const current = days.find((d) => d.date === day);
  if (!days.length) return <p className="muted">There are no free times in the next few weeks. Please reply to our email and we&apos;ll find a time together.</p>;
  return (
    <ActionForm action={bookAction.bind(null, token)} className="stack" toast>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Choose a day">
        {days.map((d) => <button key={d.date} type="button" className="btn btn-sm" aria-pressed={d.date === day} onClick={() => { setDay(d.date); setSlot(""); }}
          style={d.date === day ? { borderColor: "var(--blue)", background: "rgba(61,139,255,.18)" } : undefined}>{dayLabel(d.date)}</button>)}
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }} role="group" aria-label="Choose a time (India time)">
        {current?.slots.map((s) => <button key={s} type="button" className="btn btn-sm" aria-pressed={s === slot} onClick={() => setSlot(s)}
          style={s === slot ? { borderColor: "var(--blue)", background: "rgba(61,139,255,.18)" } : undefined}>{timeLabel(s)}</button>)}
      </div>
      <input type="hidden" name="starts_at" value={slot} />
      <label className="field" style={{ maxWidth: 260 }}><span className="label">Meeting type</span>
        <select name="meeting_type" className="select" defaultValue={meetingTypes[0]}>{meetingTypes.map((m) => <option key={m} value={m}>{LABEL[m] ?? m}</option>)}</select></label>
      <div><Submit className="btn btn-primary" disabled={!slot} pendingText="Booking…">{hasBooking ? "Move my call to this time" : "Book this time"}</Submit></div>
      <span className="tiny faint">Times are shown in India time (IST).</span>
    </ActionForm>
  );
}

export function CancelBooking({ token }: { token: string }) {
  return (
    <ActionForm action={cancelBookingAction.bind(null, token)} toast className="inline-form">
      <Submit className="btn btn-sm btn-ghost" confirm="Cancel your call?">Cancel my call</Submit>
    </ActionForm>
  );
}
