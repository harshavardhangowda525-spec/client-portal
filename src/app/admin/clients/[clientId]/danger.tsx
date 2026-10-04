"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { deleteClientAction } from "@/app/actions/admin";
import type { DeletionImpact } from "@/server/clients";

export function DangerZone({ clientId, im }: { clientId: string; im: DeletionImpact }) {
  const [name, setName] = useState("");
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const match = norm(name) === norm(im.businessName);
  const c = im.counts;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts = [
    c.projects && plural(c.projects, "project"), c.proposals && plural(c.proposals, "proposal"), c.quotations && plural(c.quotations, "quotation"),
    c.invoices && plural(c.invoices, "invoice"), c.payments && plural(c.payments, "payment record"), c.documents && plural(c.documents, "document"),
    c.users && plural(c.users, "portal login"),
  ].filter(Boolean);
  return (
    <div className="stack">
      <div className="notice error small">
        This <strong>permanently deletes</strong> the client{parts.length ? ` and ${parts.join(", ")}` : ""}, including messages and files.
        Their portal login stops working immediately. This cannot be undone.
      </div>
      {im.protectedRecords.length > 0 && (
        <div className="notice warn small">
          <strong>This also deletes {im.protectedRecords.join(", ")}.</strong> Download any quotation, invoice or receipt PDFs you need for your accounts before deleting.
        </div>
      )}
      <ActionForm action={deleteClientAction.bind(null, clientId)} className="stack-sm">
        <label htmlFor="confirm_name" className="small">Type <strong>{im.businessName}</strong> to confirm</label>
        <input id="confirm_name" name="confirm_name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} />
        <Submit className="btn btn-danger" disabled={!match} pendingText="Deleting…"
          confirm={`Permanently delete ${im.businessName} and all their data${im.protectedRecords.length ? `, including ${im.protectedRecords.join(", ")}` : ""}? This cannot be undone.`}>
          Delete client permanently
        </Submit>
      </ActionForm>
    </div>
  );
}
