"use client";

import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { sendQuotationAction, saveVersionAsTemplateAction } from "@/app/actions/admin";

export function SendQuote({ versionId, emailConfigured }: { versionId: string; emailConfigured: boolean }) {
  return (
    <ActionForm action={sendQuotationAction.bind(null, versionId)} className="stack-sm" toast>
      <label className="check"><input type="checkbox" name="send_email" disabled={!emailConfigured} defaultChecked={emailConfigured} />
        {emailConfigured ? "Also email the client" : "Email not configured — the client is notified in the portal"}</label>
      <Submit className="btn btn-primary btn-block" pendingText="Sending…" confirm="Send this quotation to the client? It can no longer be edited afterwards — save your draft first."><Icon name="send" /> Send to client</Submit>
    </ActionForm>
  );
}

export function SaveTemplate({ versionId }: { versionId: string }) {
  return (
    <details>
      <summary className="tiny faint" style={{ padding: "4px 0" }}>Save as reusable template…</summary>
      <ActionForm action={saveVersionAsTemplateAction.bind(null, versionId)} className="row" toast resetOnSuccess>
        <input name="name" className="input" placeholder="Template name" required maxLength={200} style={{ flex: 1 }} aria-label="Template name" />
        <Submit className="btn btn-sm">Save</Submit>
      </ActionForm>
    </details>
  );
}
