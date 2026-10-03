"use client";

import { ActionForm, Submit } from "@/components/forms";
import { createProjectAction } from "@/app/actions/admin";
import { PROJECT_TYPES } from "@/lib/format";

export function NewProjectForm({ clientId, admins, defaultManager }: { clientId: string; admins: { id: string; name: string }[]; defaultManager: string }) {
  return (
    <ActionForm action={createProjectAction.bind(null, clientId)} className="form-grid">
      <div className="field full"><label htmlFor="name">Project name</label><input id="name" name="name" className="input" required maxLength={200} placeholder="Cafe Website Development" /></div>
      <div className="field"><label htmlFor="project_type">Project type</label>
        <select id="project_type" name="project_type" className="select" defaultValue="website">{Object.entries(PROJECT_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label htmlFor="project_manager_id">Project manager</label>
        <select id="project_manager_id" name="project_manager_id" className="select" defaultValue={defaultManager}><option value="">Unassigned</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div className="field"><label htmlFor="start_date">Planned start</label><input id="start_date" name="start_date" type="date" className="input" /></div>
      <div className="field"><label htmlFor="target_delivery_date">Estimated delivery</label><input id="target_delivery_date" name="target_delivery_date" type="date" className="input" /></div>
      <div className="field full"><label htmlFor="description">Description</label><textarea id="description" name="description" className="textarea" maxLength={5000} /></div>
      <label className="check full"><input type="checkbox" name="default_milestones" defaultChecked /> Start with the standard 14-step website milestone plan (you can edit it afterwards)</label>
      <div className="form-actions full"><Submit pendingText="Creating…">Create project</Submit></div>
    </ActionForm>
  );
}
