"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { deleteClientAction } from "@/app/actions/admin";
import type { DeletionImpact } from "@/server/clients";

export function DangerZone({ clientId, im }: { clientId: string; im: DeletionImpact }) {
  const [name, setName] = useState("");
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const match = norm(name) === norm(im.businessName);
  const archive = im.protectedRecords.length > 0;
  const c = im.counts;
  const parts = [
    c.projects && `${c.projects} project${c.projects > 1 ? "s" : ""}`, c.proposals && `${c.proposals} proposal${c.proposals > 1 ? "s" : ""}`,
    c.quotations && `${c.quotations} quotation${c.quotations > 1 ? "s" : ""}`, c.invoices && `${c.invoices} invoice${c.invoices > 1 ? "s" : ""}`,
    c.payments && `${c.payments} payment record${c.payments > 1 ? "s" : ""}`, c.documents && `${c.documents} document${c.documents > 1 ? "s" : ""}`,
    c.users && `${c.users} portal login${c.users > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return (
    <div className="stack">
      {archive ? (
        <div className="notice warn small">
          This client has {im.protectedRecords.join(", ")}. To protect your signed agreements and financial history, they will be <strong>archived</strong> instead of deleted:
          hidden from your lists and signed out of the portal, with all records kept. You can unarchive them later.
        </div>
      ) : (
        <div className="notice error small">
          This <strong>permanently deletes</strong> the client{parts.length ? ` and ${parts.join(", ")}` : ""}, including messages and files. Their portal login stops working immediately. This cannot be undone.
        </div>
      )}
      <ActionForm action={deleteClientAction.bind(null, clientId)} className="stack-sm">
        <label htmlFor="confirm_name" className="small">Type <strong>{im.businessName}</strong> to confirm</label>
        <input id="confirm_name" name="confirm_name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} />
        <Submit className="btn btn-danger" disabled={!match} pendingText={archive ? "Archiving…" : "Deleting…"}
          confirm={archive ? `Archive ${im.businessName}?` : `Permanently delete ${im.businessName} and all their data? This cannot be undone.`}>
          {archive ? "Archive client" : "Delete client permanently"}
        </Submit>
      </ActionForm>
    </div>
  );
}
