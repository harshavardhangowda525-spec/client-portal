"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { reviewPreviewAction } from "@/app/actions/shared";

export function PreviewReview({ previewId }: { previewId: string }) {
  const [mode, setMode] = useState<"" | "approved" | "changes_requested">("");
  if (!mode) {
    return (
      <div className="stack">
        <p className="small muted">Happy with this version, or would you like changes?</p>
        <button className="btn btn-success btn-block" onClick={() => setMode("approved")}>Approve this version</button>
        <button className="btn btn-block" onClick={() => setMode("changes_requested")}>Request changes</button>
      </div>
    );
  }
  return (
    <ActionForm action={reviewPreviewAction.bind(null, previewId)} className="stack" toast>
      <input type="hidden" name="decision" value={mode} />
      <div className="field">
        <label htmlFor="note">{mode === "approved" ? "Anything to add? (optional)" : "What should we change?"}</label>
        <textarea id="note" name="note" className="textarea" required={mode === "changes_requested"} maxLength={10000}
          placeholder={mode === "approved" ? "" : "Be as specific as you can — page, section and what to change."} />
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setMode("")}>Back</button>
        <Submit className={mode === "approved" ? "btn btn-success" : "btn btn-primary"}>{mode === "approved" ? "Confirm approval" : "Send feedback"}</Submit>
      </div>
    </ActionForm>
  );
}
