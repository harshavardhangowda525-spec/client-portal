"use client";

import { ActionForm, Submit } from "../forms";
import { uploadDocumentAction } from "@/app/actions/shared";

export function UploadForm({ projectId, categories, extra }: { projectId: string; categories: [string, string][]; extra?: React.ReactNode }) {
  return (
    <ActionForm action={uploadDocumentAction.bind(null, projectId)} resetOnSuccess className="form-grid">
      <div className="field">
        <label htmlFor="file">File</label>
        <input id="file" name="file" type="file" className="input" required
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv,.ai,.psd,.eps" />
      </div>
      <div className="field">
        <label htmlFor="category">Type</label>
        <select id="category" name="category" className="select">{categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      {extra}
      <div className="form-actions full"><Submit pendingText="Uploading…">Upload</Submit></div>
    </ActionForm>
  );
}
