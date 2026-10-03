"use client";

import { ActionForm, Submit } from "@/components/forms";
import { saveTemplateAction } from "@/app/actions/admin";

/** Advanced editor: the template is stored as structured JSON and validated on save. */
export function TemplateEditor({ id, name, description, content }: { id: string; name: string; description: string | null; content: unknown }) {
  return (
    <ActionForm action={saveTemplateAction.bind(null, id)} className="stack">
      <div className="form-grid">
        <div className="field"><label htmlFor={`n-${id}`}>Name</label><input id={`n-${id}`} name="name" className="input" defaultValue={name} required /></div>
        <div className="field"><label htmlFor={`d-${id}`}>Description</label><input id={`d-${id}`} name="description" className="input" defaultValue={description ?? ""} /></div>
      </div>
      <div className="field"><label htmlFor={`c-${id}`}>Content (JSON)</label>
        <textarea id={`c-${id}`} name="content" className="textarea mono" style={{ minHeight: 320, fontSize: 12.5 }} defaultValue={JSON.stringify(content, null, 2)} spellCheck={false} />
        <span className="hint">Fields: items, payment_terms (percent must total 100), included_features, exclusions, revisions_included, terms…</span></div>
      <div className="form-actions"><Submit>Save template</Submit></div>
    </ActionForm>
  );
}
