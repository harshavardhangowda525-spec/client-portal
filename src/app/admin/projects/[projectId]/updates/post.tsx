"use client";

import { ActionForm, Submit } from "@/components/forms";
import { postUpdateAction } from "@/app/actions/admin";
import { UPDATE_KINDS } from "@/lib/format";

export function PostUpdateForm({ projectId, milestones }: { projectId: string; milestones: { id: string; title: string }[] }) {
  return (
    <ActionForm action={postUpdateAction.bind(null, projectId)} className="stack" resetOnSuccess>
      <div className="field"><label htmlFor="u-title">Title</label><input id="u-title" name="title" className="input" required maxLength={200} placeholder="Homepage preview published" /></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="u-kind">Type</label><select id="u-kind" name="kind" className="select">{Object.entries(UPDATE_KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="u-vis">Visibility</label><select id="u-vis" name="visibility" className="select"><option value="client">Client can see</option><option value="internal">Internal only</option></select></div>
      </div>
      <div className="field"><label htmlFor="u-ms">Related milestone</label><select id="u-ms" name="milestone_id" className="select"><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></div>
      <div className="field"><label htmlFor="u-body">Message</label><textarea id="u-body" name="body" className="textarea" style={{ minHeight: 120 }} maxLength={20000} /></div>
      <label className="check"><input type="checkbox" name="requests_feedback" /> Ask the client for feedback (adds a pending action for them)</label>
      <Submit pendingText="Posting…">Post update</Submit>
    </ActionForm>
  );
}
