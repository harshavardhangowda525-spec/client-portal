"use client";

import { ActionForm, Submit } from "@/components/forms";
import { publishPreviewAction } from "@/app/actions/admin";

export function PublishPreviewForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={publishPreviewAction.bind(null, projectId)} className="stack" resetOnSuccess>
      <div className="field"><label htmlFor="pv-url">Preview URL</label><input id="pv-url" name="url" type="url" className="input" required placeholder="https://preview.example.com" /></div>
      <div className="field"><label htmlFor="pv-title">Title</label><input id="pv-title" name="title" className="input" maxLength={200} placeholder="Homepage first draft" /></div>
      <div className="field"><label htmlFor="pv-notes">Notes for the client</label><textarea id="pv-notes" name="notes" className="textarea" maxLength={5000} placeholder="What to look at in this version…" /></div>
      <Submit pendingText="Publishing…">Publish preview</Submit>
      <span className="tiny faint">We check whether the site allows embedding; if not, the client gets an “Open in new tab” link.</span>
    </ActionForm>
  );
}
