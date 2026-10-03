"use client";

import { ActionButton, ActionForm, Modal, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { createMilestoneAction, deleteMilestoneAction, moveMilestoneAction, updateMilestoneAction } from "@/app/actions/admin";
import { MILESTONE_STATUS } from "@/lib/format";

type M = { id: string; title: string; description: string | null; status: string; weight: number; start_date: string | null; due_date: string | null; blocked_reason: string | null };

function Fields({ m }: { m?: M }) {
  const k = m?.id ?? "new";
  return (
    <>
      <div className="field full"><label htmlFor={`t-${k}`}>Title</label><input id={`t-${k}`} name="title" className="input" defaultValue={m?.title} required maxLength={200} /></div>
      <div className="field full"><label htmlFor={`d-${k}`}>Description</label><textarea id={`d-${k}`} name="description" className="textarea" defaultValue={m?.description ?? ""} maxLength={5000} /></div>
      <div className="field"><label htmlFor={`s-${k}`}>Start date</label><input id={`s-${k}`} name="start_date" type="date" className="input" defaultValue={m?.start_date ?? ""} /></div>
      <div className="field"><label htmlFor={`u-${k}`}>Due date</label><input id={`u-${k}`} name="due_date" type="date" className="input" defaultValue={m?.due_date ?? ""} /></div>
      <div className="field"><label htmlFor={`w-${k}`}>Weight</label><input id={`w-${k}`} name="weight" type="number" min={0} max={1000} step="0.5" className="input" defaultValue={m ? Number(m.weight) : 5} required /><span className="hint">Relative share of total work.</span></div>
    </>
  );
}

export function MilestoneControls({ milestone: m, first, last }: { milestone: M; first: boolean; last: boolean }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <Modal title={`Edit: ${m.title}`} trigger={<><Icon name="edit" /><span className="sr-only">Edit {m.title}</span></>} triggerClass="btn btn-sm btn-ghost icon-btn">
        {(close) => (
          <ActionForm action={updateMilestoneAction.bind(null, m.id)} className="form-grid" onDone={close} toast>
            <Fields m={m} />
            <div className="field"><label htmlFor={`st-${m.id}`}>Status</label>
              <select id={`st-${m.id}`} name="status" className="select" defaultValue={m.status}>{Object.entries(MILESTONE_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="field full"><label htmlFor={`br-${m.id}`}>Blocked reason (if blocked)</label><input id={`br-${m.id}`} name="blocked_reason" className="input" defaultValue={m.blocked_reason ?? ""} maxLength={1000} /></div>
            <div className="field full"><label htmlFor={`n-${m.id}`}>Update note (shown in history)</label><textarea id={`n-${m.id}`} name="note" className="textarea" style={{ minHeight: 60 }} maxLength={2000} placeholder="e.g. Homepage hero and menu highlights done" /></div>
            <div className="form-actions full"><Submit pendingText="Saving…">Save milestone</Submit></div>
          </ActionForm>
        )}
      </Modal>
      <ActionButton action={moveMilestoneAction.bind(null, m.id, "up")} className={`btn btn-sm btn-ghost icon-btn${first ? " sr-only" : ""}`}><Icon name="up" /><span className="sr-only">Move up</span></ActionButton>
      <ActionButton action={moveMilestoneAction.bind(null, m.id, "down")} className={`btn btn-sm btn-ghost icon-btn${last ? " sr-only" : ""}`}><Icon name="down" /><span className="sr-only">Move down</span></ActionButton>
      <ActionButton action={deleteMilestoneAction.bind(null, m.id)} className="btn btn-sm btn-ghost icon-btn" confirm={`Delete milestone "${m.title}"? Its history will be removed.`}><Icon name="trash" /><span className="sr-only">Delete</span></ActionButton>
    </div>
  );
}

export function NewMilestoneForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={createMilestoneAction.bind(null, projectId)} className="form-grid" resetOnSuccess>
      <Fields />
      <div className="form-actions full"><Submit pendingText="Adding…"><Icon name="plus" /> Add milestone</Submit></div>
    </ActionForm>
  );
}
