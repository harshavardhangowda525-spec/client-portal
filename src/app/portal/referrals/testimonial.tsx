"use client";

import { ActionButton, ActionForm, Submit } from "@/components/forms";
import { submitTestimonialAction, withdrawTestimonialAction } from "@/app/actions/growth";

const LABEL: Record<string, string> = { submitted: "Waiting for review", published: "Published", rejected: "Not published", withdrawn: "Withdrawn" };

export function TestimonialForm({ defaultName, items }: { defaultName: string; items: { id: string; quote: string; status: string }[] }) {
  return (
    <div className="stack">
      {items.map((t) => (
        <div key={t.id} className="row-between small">
          <span className="muted truncate" style={{ maxWidth: "65%" }}>&ldquo;{t.quote}&rdquo;</span>
          <span className="row" style={{ gap: 6 }}><span className="badge plain">{LABEL[t.status]}</span>
            {(t.status === "submitted" || t.status === "published") && <ActionButton action={withdrawTestimonialAction.bind(null, t.id)} className="btn btn-sm btn-ghost" confirm="Withdraw this testimonial? It will be removed from the showcase.">Withdraw</ActionButton>}</span>
        </div>
      ))}
      <ActionForm action={submitTestimonialAction} className="stack-sm" toast resetOnSuccess>
        <label className="field"><span className="label">Your testimonial</span><textarea name="quote" className="textarea" required minLength={10} maxLength={1200} placeholder="What was it like working with us? What changed for your business?" /></label>
        <div className="form-grid">
          <label className="field"><span className="label">Name to show</span><input name="display_name" className="input" defaultValue={defaultName} required maxLength={120} /></label>
          <label className="field"><span className="label">Role or business (optional)</span><input name="display_role" className="input" maxLength={120} placeholder="Owner, Sharma Physiotherapy" /></label>
        </div>
        <label className="check"><input type="checkbox" name="consent" required /> <span className="small">Infinity Web &amp; Apps may publish this exact text with the name above. I can withdraw it any time.</span></label>
        <div><Submit className="btn btn-sm btn-primary">Submit testimonial</Submit></div>
      </ActionForm>
    </div>
  );
}
