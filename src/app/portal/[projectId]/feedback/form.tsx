"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { submitFeedbackAction } from "@/app/actions/referrals";

const QUESTIONS: [string, string][] = [["satisfaction", "Overall satisfaction"], ["quality", "Project quality"], ["communication", "Communication"], ["delivery", "Delivery experience"], ["overall", "Overall experience"]];

function Stars({ name, label }: { name: string; label: string }) {
  const [v, setV] = useState(0);
  const [hover, setHover] = useState(0);
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label">{label}</legend>
      <input type="hidden" name={name} value={v || ""} />
      <div className="row" style={{ gap: 4 }} role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={v === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setV(n)} onMouseEnter={() => setHover(n)}
            style={{ fontSize: 28, lineHeight: 1, background: "none", border: 0, cursor: "pointer", padding: 2, color: n <= (hover || v) ? "#fbbf24" : "rgba(255,255,255,.22)", transition: "transform .12s", transform: n <= (hover || v) ? "scale(1.08)" : undefined }}>★</button>
        ))}
      </div>
    </fieldset>
  );
}

export function FeedbackForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={submitFeedbackAction.bind(null, projectId)} className="stack" toast>
      <div className="grid grid-2">{QUESTIONS.map(([n, l]) => <Stars key={n} name={n} label={l} />)}</div>
      <label className="field"><span className="label">Anything you'd like to tell us? (optional)</span><textarea name="comments" className="textarea" maxLength={5000} /></label>
      <label className="field"><span className="label">How could we improve? (optional)</span><textarea name="suggestions" className="textarea" maxLength={5000} /></label>
      <label className="check"><input type="checkbox" name="testimonial_consent" /> <span>You may use my comments as a public testimonial (with my first name and business name).</span></label>
      <div><Submit pendingText="Sending…">Send feedback</Submit></div>
    </ActionForm>
  );
}
