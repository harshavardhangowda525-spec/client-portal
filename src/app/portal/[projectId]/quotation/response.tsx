"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { acceptQuotationAction, rejectQuotationAction, requestChangesAction } from "@/app/actions/shared";
import { formatMoney } from "@/lib/money";

export function QuoteResponse({ versionId, hash, total, currency, defaultName, number, versionNo }: {
  versionId: string; hash: string; total: number; currency: string; defaultName: string; number: string; versionNo: number;
}) {
  const [mode, setMode] = useState<"" | "accept" | "changes" | "reject">("");
  if (!mode) {
    return (
      <div className="stack">
        <button className="btn btn-primary btn-lg btn-block" onClick={() => setMode("accept")}>Accept quotation</button>
        <button className="btn btn-block" onClick={() => setMode("changes")}>Request changes</button>
        <button className="btn btn-ghost btn-block" onClick={() => setMode("reject")}>Decline</button>
      </div>
    );
  }
  const cancel = <button type="button" className="btn btn-ghost" onClick={() => setMode("")}>Back</button>;
  if (mode === "accept") {
    return (
      <ActionForm action={acceptQuotationAction.bind(null, versionId)} className="stack" toast>
        <input type="hidden" name="content_hash" value={hash} />
        <p className="small">You are accepting <strong>{number} (version {versionNo})</strong> for a total of <strong>{formatMoney(total, currency)}</strong>.</p>
        <label className="check"><input type="checkbox" name="confirm_scope" required /> I have reviewed the services, inclusions and exclusions in this quotation.</label>
        <label className="check"><input type="checkbox" name="confirm_terms" required /> I agree to the payment milestones and the terms &amp; conditions.</label>
        <div className="field">
          <label htmlFor="signer_name">Type your full name to sign</label>
          <input id="signer_name" name="signer_name" className="input" defaultValue={defaultName} required minLength={2} maxLength={200} autoComplete="name" />
        </div>
        <p className="tiny faint">Your name, account, the time and this exact version are recorded as your acceptance.</p>
        <div className="form-actions">{cancel}<Submit className="btn btn-primary" pendingText="Accepting…">Accept &amp; sign</Submit></div>
      </ActionForm>
    );
  }
  if (mode === "changes") {
    return (
      <ActionForm action={requestChangesAction.bind(null, versionId)} className="stack" toast>
        <div className="field">
          <label htmlFor="note">What would you like changed?</label>
          <textarea id="note" name="note" className="textarea" required maxLength={5000} placeholder="e.g. Please add an online menu with QR code…" />
        </div>
        <div className="form-actions">{cancel}<Submit pendingText="Sending…">Send request</Submit></div>
      </ActionForm>
    );
  }
  return (
    <ActionForm action={rejectQuotationAction.bind(null, versionId)} className="stack" toast>
      <div className="field">
        <label htmlFor="reason">Reason (optional)</label>
        <textarea id="reason" name="reason" className="textarea" maxLength={5000} placeholder="Help us understand what did not work for you." />
      </div>
      <div className="form-actions">{cancel}<Submit className="btn btn-danger" pendingText="Sending…" confirm="Decline this quotation?">Decline quotation</Submit></div>
    </ActionForm>
  );
}
