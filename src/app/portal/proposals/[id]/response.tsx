"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { acceptProposalAction, rejectProposalAction, requestProposalChangesAction } from "@/app/actions/proposals";
import { formatMoney } from "@/lib/money";

type Props = {
  versionId: string; hash: string; number: string; versionNo: number; defaultName: string; total: number; monthly: number; annual: number;
  milestones: { label: string; due: string | null; amount: number }[]; tbc: boolean;
};

export function ProposalResponse(p: Props) {
  const [mode, setMode] = useState<"" | "accept" | "changes" | "reject">("");
  const back = <button type="button" className="btn btn-ghost" onClick={() => setMode("")}>Back</button>;
  if (!mode) {
    return (
      <div className="stack">
        <button className="btn btn-primary btn-lg btn-block" onClick={() => setMode("accept")}>Review &amp; accept</button>
        <button className="btn btn-block" onClick={() => setMode("changes")}>Request changes</button>
        <button className="btn btn-ghost btn-block" onClick={() => setMode("reject")}>Decline</button>
      </div>
    );
  }
  if (mode === "accept") {
    return (
      <ActionForm action={acceptProposalAction.bind(null, p.versionId)} className="stack" toast>
        <input type="hidden" name="content_hash" value={p.hash} />
        <div className="glass stack-sm" style={{ padding: 14, background: "rgba(0,0,0,.2)" }}>
          <span className="tiny faint">You are agreeing to</span>
          <strong>{p.number} · version {p.versionNo}</strong>
          <div className="row-between small"><span>One-time total</span><strong>{formatMoney(p.total)}</strong></div>
          {p.monthly > 0 && <div className="row-between small"><span>Recurring</span><span>{formatMoney(p.monthly)} / month</span></div>}
          {p.annual > 0 && <div className="row-between small"><span>Recurring</span><span>{formatMoney(p.annual)} / year</span></div>}
          {p.milestones.length > 0 && <>
            <span className="tiny faint" style={{ marginTop: 6 }}>Payment schedule</span>
            {p.milestones.map((m, i) => <div key={i} className="row-between small"><span>{m.label}{m.due ? ` · ${m.due}` : ""}</span><span>{formatMoney(m.amount)}</span></div>)}
          </>}
          {p.tbc && <span className="tiny" style={{ color: "var(--amber)" }}>Some third-party fees are “to be confirmed” and are not included above.</span>}
        </div>
        <label className="check"><input type="checkbox" name="confirm_scope" required /> I have read the scope, deliverables, exclusions and terms.</label>
        <label className="check"><input type="checkbox" name="confirm_amount" required /> I agree to the one-time total and the payment schedule above.</label>
        <label className="check"><input type="checkbox" name="confirm_recurring" required /> I understand the recurring and third-party costs listed separately.</label>
        <div className="field">
          <label htmlFor="signer_name">Type your full name</label>
          <input id="signer_name" name="signer_name" className="input" defaultValue={p.defaultName} required minLength={2} maxLength={200} autoComplete="name" />
        </div>
        <p className="tiny faint">We record your account, name, the time and this exact version. This is an electronic acceptance, not a certified digital signature.</p>
        <div className="form-actions">{back}<Submit pendingText="Accepting…">Accept proposal</Submit></div>
      </ActionForm>
    );
  }
  if (mode === "changes") {
    return (
      <ActionForm action={requestProposalChangesAction.bind(null, p.versionId)} className="stack" toast>
        <div className="field"><label htmlFor="note">What would you like changed?</label>
          <textarea id="note" name="note" className="textarea" required maxLength={5000} placeholder="e.g. Please add online table booking…" /></div>
        <div className="form-actions">{back}<Submit pendingText="Sending…">Send request</Submit></div>
      </ActionForm>
    );
  }
  return (
    <ActionForm action={rejectProposalAction.bind(null, p.versionId)} className="stack" toast>
      <div className="field"><label htmlFor="reason">Reason (optional)</label>
        <textarea id="reason" name="reason" className="textarea" maxLength={5000} placeholder="Help us understand what did not work for you." /></div>
      <div className="form-actions">{back}<Submit className="btn btn-danger" pendingText="Sending…" confirm="Decline this proposal?">Decline proposal</Submit></div>
    </ActionForm>
  );
}
