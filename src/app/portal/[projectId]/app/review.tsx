"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { reviewAppBuildAction } from "@/app/actions/shared";

export function AppBuildReview({ buildId, version }: { buildId: string; version: number }) {
  const [mode, setMode] = useState<"" | "approved" | "changes_requested">("");
  if (!mode) {
    return (
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Once you&apos;ve installed and tried this version, let us know.</p>
        <button className="btn btn-success btn-block" onClick={() => setMode("approved")}>Approve this build</button>
        <button className="btn btn-block" onClick={() => setMode("changes_requested")}>Request changes</button>
      </div>
    );
  }
  const approving = mode === "approved";
  return (
    <ActionForm action={reviewAppBuildAction.bind(null, buildId)} className="stack" toast>
      <input type="hidden" name="decision" value={mode} />
      <div className="field">
        <label htmlFor="ab-device">Phone you tested on {approving ? "(optional)" : ""}</label>
        <input id="ab-device" name="device" className="input" maxLength={120} placeholder="e.g. Samsung Galaxy A54, Android 14" />
      </div>
      <div className="field">
        <label htmlFor="ab-note">{approving ? "Anything to add? (optional)" : "What should we change?"}</label>
        <textarea id="ab-note" name="note" className="textarea" required={!approving} maxLength={10000}
          placeholder={approving ? "" : "Which screen, what happened, and what you expected."} />
      </div>
      {!approving && (
        <div className="field">
          <label htmlFor="ab-cshots">Screenshots of the problem (optional, up to 5)</label>
          <input id="ab-cshots" name="screenshots" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="input" />
        </div>
      )}
      {approving && (
        <label className="check"><input type="checkbox" name="confirm" required /> <span>I have tested version {version} and approve it.</span></label>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setMode("")}>Back</button>
        <Submit className={approving ? "btn btn-success" : "btn btn-primary"} pendingText="Sending…">{approving ? "Confirm approval" : "Send feedback"}</Submit>
      </div>
    </ActionForm>
  );
}
