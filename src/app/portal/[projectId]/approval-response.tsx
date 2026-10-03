"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { respondApprovalAction } from "@/app/actions/shared";

export function ApprovalResponse({ requestId }: { requestId: string }) {
  const [mode, setMode] = useState<"" | "approved" | "changes_requested" | "answered">("");
  if (!mode) {
    return (
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn btn-sm btn-success" onClick={() => setMode("approved")}>Approve</button>
        <button className="btn btn-sm" onClick={() => setMode("changes_requested")}>Request changes</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setMode("answered")}>Reply</button>
      </div>
    );
  }
  return (
    <ActionForm action={respondApprovalAction.bind(null, requestId)} className="stack-sm" toast>
      <input type="hidden" name="decision" value={mode} />
      <label className="sr-only" htmlFor={`resp-${requestId}`}>Your response</label>
      <textarea id={`resp-${requestId}`} name="response" className="textarea" maxLength={5000} required={mode !== "approved"}
        placeholder={mode === "approved" ? "Optional note" : mode === "answered" ? "Your answer" : "What would you like changed?"} />
      <div className="row">
        <Submit className={`btn btn-sm ${mode === "approved" ? "btn-success" : "btn-primary"}`}>
          {mode === "approved" ? "Confirm approval" : "Send"}
        </Submit>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMode("")}>Cancel</button>
      </div>
    </ActionForm>
  );
}
