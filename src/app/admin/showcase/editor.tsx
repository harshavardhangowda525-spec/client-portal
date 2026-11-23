"use client";

import { ActionForm, Modal, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { saveShowcaseAction } from "@/app/actions/growth";
import type { ShowcaseItem } from "@/server/showcase";

export function ShowcaseEditor({ item: i, clients }: { item?: ShowcaseItem; clients: { id: string; business_name: string }[] }) {
  return (
    <Modal title={i ? `Edit ${i.title}` : "New case study"} triggerClass={i ? "btn btn-sm" : "btn btn-primary"} trigger={i ? <><Icon name="edit" /> Edit</> : <><Icon name="plus" /> New case study</>}>
      {(close) => (
        <ActionForm action={saveShowcaseAction.bind(null, i?.id ?? null)} className="form-grid" toast onDone={(r) => { if (r?.ok) close(); }}>
          <label className="field full"><span className="label">Title</span><input name="title" className="input" defaultValue={i?.title} required maxLength={160} /></label>
          <label className="field"><span className="label">Web address (slug)</span><input name="slug" className="input" defaultValue={i?.slug} required pattern="[a-z0-9-]{2,80}" placeholder="fitzone-member-app" /></label>
          <label className="field"><span className="label">Client shown as</span><input name="client_label" className="input" defaultValue={i?.client_label} required maxLength={160} placeholder="FitZone Gym, Bengaluru" /></label>
          <label className="field"><span className="label">Industry</span><input name="industry" className="input" defaultValue={i?.industry} required maxLength={60} placeholder="Fitness" /></label>
          <label className="field"><span className="label">Service</span><input name="service_type" className="input" defaultValue={i?.service_type} required maxLength={60} placeholder="Mobile app" /></label>
          <label className="field"><span className="label">Client account (optional)</span><select name="client_id" className="select" defaultValue={i?.client_id ?? ""}><option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select></label>
          <label className="field"><span className="label">Live site (https, optional)</span><input name="live_url" className="input" defaultValue={i?.live_url ?? ""} /></label>
          <label className="field full"><span className="label">Summary</span><textarea name="summary" className="textarea" defaultValue={i?.summary} required maxLength={400} /></label>
          <label className="field full"><span className="label">Story (optional)</span><textarea name="story" className="textarea" defaultValue={i?.story ?? ""} maxLength={8000} /></label>
          <label className="field full"><span className="label">Approved results, one per line as “Label: value” (optional)</span>
            <textarea name="metrics" className="textarea" defaultValue={i?.metrics.map((m) => `${m.label}: ${m.value}`).join("\n")} placeholder={"Online bookings: +40%"} /></label>
          <label className="field"><span className="label">Before image (PNG/JPG/WebP, ≤ 3 MB)</span><input type="file" name="before_image" accept="image/png,image/jpeg,image/webp" className="input" /></label>
          <label className="field"><span className="label">After image</span><input type="file" name="after_image" accept="image/png,image/jpeg,image/webp" className="input" /></label>
          <label className="field"><span className="label">Order</span><input name="position" type="number" min={0} className="input" defaultValue={i?.position ?? 0} /></label>
          <label className="check full"><input type="checkbox" name="permission_confirmed" defaultChecked={!!i?.permission_confirmed_at} />
            <span>The client gave written permission to publish their name, logo, screenshots and the results above</span></label>
          <label className="field full"><span className="label">How permission was given (e.g. “Email from Arjun, 12 Nov”)</span><input name="permission_note" className="input" defaultValue={i?.permission_note ?? ""} maxLength={1000} /></label>
          <div className="form-actions full"><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button><Submit>Save</Submit></div>
        </ActionForm>
      )}
    </Modal>
  );
}
