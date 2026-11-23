"use client";

import { ActionForm, Modal, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { saveServiceAction, setInquiryStatusAction } from "@/app/actions/growth";
import type { Service } from "@/server/marketplace";

const CATS = { websites: "Websites", apps: "Apps", software: "Software", ai_automation: "AI & automation", care: "Care & maintenance" };

export function ServiceEditor({ service }: { service?: Service }) {
  const s = service;
  return (
    <Modal title={s ? `Edit ${s.name}` : "New service"} triggerClass={s ? "btn btn-sm" : "btn btn-primary"} trigger={s ? <><Icon name="edit" /> Edit</> : <><Icon name="plus" /> New service</>}>
      {(close) => (
        <ActionForm action={saveServiceAction.bind(null, s?.id ?? null)} className="form-grid" toast onDone={(r) => { if (r?.ok) close(); }}>
          <label className="field"><span className="label">Name</span><input name="name" className="input" defaultValue={s?.name} required maxLength={120} /></label>
          <label className="field"><span className="label">Short name (slug)</span><input name="slug" className="input" defaultValue={s?.slug} required pattern="[a-z0-9-]{2,60}" /></label>
          <label className="field"><span className="label">Category</span><select name="category" className="select" defaultValue={s?.category ?? "software"}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span className="label">Icon</span><select name="icon" className="select" defaultValue={s?.icon ?? "grid"}>{["globe", "cart", "phone", "users", "receipt", "calendar", "headset", "sparkles", "message", "wrench", "layout", "code", "grid"].map((i) => <option key={i}>{i}</option>)}</select></label>
          <label className="field full"><span className="label">One-line description</span><input name="summary" className="input" defaultValue={s?.summary} required maxLength={300} /></label>
          <label className="field full"><span className="label">Details (optional)</span><textarea name="details" className="textarea" defaultValue={s?.details ?? ""} maxLength={5000} /></label>
          <label className="field"><span className="label">Key benefits (one per line)</span><textarea name="benefits" className="textarea" defaultValue={s?.benefits.join("\n")} /></label>
          <label className="field"><span className="label">Recommend to (industry words, one per line)</span><textarea name="industries" className="textarea" defaultValue={s?.industries.join("\n")} /><span className="hint">e.g. clinic, gym, restaurant. “all” = shown to everyone but never pushed as a suggestion.</span></label>
          <label className="field"><span className="label">Price shown (blank = Quote on request)</span><input name="price_label" className="input" defaultValue={s?.price_label ?? ""} maxLength={80} placeholder="e.g. From ₹24,999" /></label>
          <label className="field"><span className="label">Order</span><input name="position" type="number" className="input" defaultValue={s?.position ?? 200} min={0} /></label>
          <label className="check full"><input type="checkbox" name="is_active" defaultChecked={s?.is_active ?? true} /> Show to clients</label>
          <div className="form-actions full"><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button><Submit>Save</Submit></div>
        </ActionForm>
      )}
    </Modal>
  );
}

export function InquiryStatus({ id, status, options }: { id: string; status: string; options: Record<string, string> }) {
  return (
    <ActionForm action={setInquiryStatusAction.bind(null, id)} className="row" toast>
      <select name="status" className="select" defaultValue={status} aria-label="Request status" style={{ width: "auto", minWidth: 150 }}>
        {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <Submit className="btn btn-sm">Update</Submit>
    </ActionForm>
  );
}
