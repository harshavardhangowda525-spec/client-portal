"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { commenceProjectAction, updateProjectAction, setProjectStatusAction, createApprovalAction, addInternalNoteAction } from "@/app/actions/admin";
import { PROJECT_STATUS, PROJECT_TYPES } from "@/lib/format";

export function CommenceForm({ projectId, start, delivery }: { projectId: string; start: string | null; delivery: string | null }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={commenceProjectAction.bind(null, projectId)} className="form-grid" toast>
      <div className="field"><label htmlFor="c-start">Start date</label><input id="c-start" name="start_date" type="date" className="input" defaultValue={start ?? today} required /></div>
      <div className="field"><label htmlFor="c-del">Estimated delivery</label><input id="c-del" name="target_delivery_date" type="date" className="input" defaultValue={delivery ?? ""} /></div>
      <div className="field full"><label htmlFor="c-stage">Current stage shown to client</label><input id="c-stage" name="current_stage" className="input" defaultValue="Project kick-off" maxLength={200} /></div>
      <div className="form-actions full"><Submit className="btn btn-primary btn-lg" pendingText="Activating…">Confirm commencement &amp; payment terms</Submit></div>
    </ActionForm>
  );
}

const NEXT: Record<string, string[]> = {
  proposal: ["quotation_accepted", "declined", "cancelled", "on_hold"], quotation_accepted: ["on_hold", "cancelled"],
  active: ["awaiting_client", "on_hold", "completed", "cancelled"], awaiting_client: ["active", "on_hold", "completed", "cancelled"],
  on_hold: ["active", "awaiting_client", "proposal", "cancelled"], completed: ["active"], cancelled: ["proposal", "active"], declined: ["proposal"],
};

export function StatusForm({ projectId, status }: { projectId: string; status: string }) {
  const [next, setNext] = useState("");
  const options = (NEXT[status] ?? []).filter((s) => s !== "quotation_accepted");
  if (!options.length) return null;
  return (
    <ActionForm action={setProjectStatusAction.bind(null, projectId)} className="row" toast>
      <label htmlFor="status" className="small muted">Change status</label>
      <select id="status" name="status" className="select" style={{ width: "auto" }} value={next} onChange={(e) => setNext(e.target.value)} required>
        <option value="" disabled>Select…</option>
        {options.map((s) => <option key={s} value={s}>{PROJECT_STATUS[s]}</option>)}
      </select>
      {(next === "cancelled" || next === "declined") && <input name="reason" className="input" placeholder="Reason" style={{ width: 200 }} maxLength={500} />}
      <Submit className="btn btn-sm" disabled={!next} confirm={next === "cancelled" ? "Cancel this project?" : undefined}>Update</Submit>
    </ActionForm>
  );
}

type P = { name: string; project_type: string; description: string | null; project_manager_id: string | null; start_date: string | null; target_delivery_date: string | null; current_stage: string | null };

export function ProjectSettingsForm({ projectId, project, admins }: { projectId: string; project: P; admins: { id: string; name: string }[] }) {
  return (
    <ActionForm action={updateProjectAction.bind(null, projectId)} className="stack" toast>
      <div className="field"><label htmlFor="ps-name">Name</label><input id="ps-name" name="name" className="input" defaultValue={project.name} required maxLength={200} /></div>
      <div className="field"><label htmlFor="ps-stage">Current stage (shown to client)</label><input id="ps-stage" name="current_stage" className="input" defaultValue={project.current_stage ?? ""} maxLength={200} /></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="ps-type">Type</label><select id="ps-type" name="project_type" className="select" defaultValue={project.project_type}>{Object.entries(PROJECT_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="ps-pm">Project manager</label><select id="ps-pm" name="project_manager_id" className="select" defaultValue={project.project_manager_id ?? ""}><option value="">Unassigned</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="field"><label htmlFor="ps-start">Start</label><input id="ps-start" name="start_date" type="date" className="input" defaultValue={project.start_date ?? ""} /></div>
        <div className="field"><label htmlFor="ps-del">Delivery</label><input id="ps-del" name="target_delivery_date" type="date" className="input" defaultValue={project.target_delivery_date ?? ""} /></div>
      </div>
      <div className="field"><label htmlFor="ps-desc">Description</label><textarea id="ps-desc" name="description" className="textarea" defaultValue={project.description ?? ""} maxLength={5000} /></div>
      <div className="form-actions"><Submit className="btn btn-sm">Save</Submit></div>
    </ActionForm>
  );
}

export function ApprovalRequestForm({ projectId, milestones }: { projectId: string; milestones: { id: string; title: string }[] }) {
  return (
    <ActionForm action={createApprovalAction.bind(null, projectId)} className="form-grid" resetOnSuccess>
      <div className="field full"><label htmlFor="ar-title">What do you need?</label><input id="ar-title" name="title" className="input" required maxLength={200} placeholder="Approve the homepage design" /></div>
      <div className="field"><label htmlFor="ar-kind">Type</label><select id="ar-kind" name="kind" className="select"><option value="approval">Approval</option><option value="feedback">Feedback</option><option value="question">Question</option></select></div>
      <div className="field"><label htmlFor="ar-due">Respond by</label><input id="ar-due" name="due_date" type="date" className="input" /></div>
      <div className="field full"><label htmlFor="ar-ms">Related milestone</label><select id="ar-ms" name="milestone_id" className="select"><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></div>
      <div className="field full"><label htmlFor="ar-desc">Details</label><textarea id="ar-desc" name="description" className="textarea" maxLength={5000} /></div>
      <div className="form-actions full"><Submit pendingText="Sending…">Send to client</Submit></div>
    </ActionForm>
  );
}

export function InternalNoteForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={addInternalNoteAction.bind(null, projectId)} className="stack-sm" resetOnSuccess toast>
      <label htmlFor="note" className="sr-only">Internal note</label>
      <textarea id="note" name="body" className="textarea" style={{ minHeight: 60 }} placeholder="Private note for your team…" required maxLength={10000} />
      <div className="row" style={{ justifyContent: "flex-end" }}><Submit className="btn btn-sm">Add note</Submit></div>
    </ActionForm>
  );
}
