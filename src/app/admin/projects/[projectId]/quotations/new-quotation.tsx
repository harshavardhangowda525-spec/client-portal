"use client";

import { ActionForm, Submit } from "@/components/forms";
import { createQuotationAction } from "@/app/actions/admin";

export function NewQuotationForm({ projectId, templates }: { projectId: string; templates: { id: string; name: string }[] }) {
  return (
    <ActionForm action={createQuotationAction.bind(null, projectId)} className="stack">
      <div className="field"><label htmlFor="q-title">Title</label><input id="q-title" name="title" className="input" defaultValue="Website development quotation" required maxLength={200} /></div>
      <div className="field"><label htmlFor="q-tpl">Start from template</label>
        <select id="q-tpl" name="template_id" className="select">{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      <Submit pendingText="Creating…">Create draft</Submit>
      <p className="tiny faint">Drafts are private until you send them.</p>
    </ActionForm>
  );
}
