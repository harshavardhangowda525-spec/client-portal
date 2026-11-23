"use client";

import { ActionForm, Modal, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { saveCampaignAction, decideRewardAction } from "@/app/actions/growth";
import type { Campaign } from "@/server/rewards";
import { istToday } from "@/lib/dates";

const TYPES = { renewal_credit: "Credit on a renewal", discount: "Discount on a future project", cash: "Cash / bank transfer", gift: "Gift" };

export function CampaignEditor({ campaign: c }: { campaign?: Campaign }) {
  return (
    <Modal title={c ? `Edit ${c.name}` : "New referral campaign"} triggerClass={c ? "btn btn-sm" : "btn btn-sm btn-primary"} trigger={c ? <><Icon name="edit" /> Edit</> : <><Icon name="plus" /> New campaign</>}>
      {(close) => (
        <ActionForm action={saveCampaignAction.bind(null, c?.id ?? null)} className="form-grid" toast onDone={(r) => { if (r?.ok) close(); }}>
          <label className="field full"><span className="label">Campaign name</span><input name="name" className="input" defaultValue={c?.name} required maxLength={120} placeholder="Winter referral campaign" /></label>
          <label className="field"><span className="label">Reward type</span><select name="reward_type" className="select" defaultValue={c?.reward_type ?? "renewal_credit"}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span className="label">Value (₹, for reports)</span><input name="reward_value" type="number" min={0} step="1" className="input" defaultValue={c?.reward_value ?? 0} /></label>
          <label className="field full"><span className="label">What clients see</span><input name="reward_text" className="input" defaultValue={c?.reward_text} required maxLength={200} placeholder="₹2,000 off your next renewal" /></label>
          <label className="field"><span className="label">Starts</span><input name="starts_on" type="date" className="input" defaultValue={c?.starts_on ?? istToday()} required /></label>
          <label className="field"><span className="label">Ends (optional)</span><input name="ends_on" type="date" className="input" defaultValue={c?.ends_on ?? ""} /></label>
          <label className="field full"><span className="label">Terms (optional)</span><textarea name="terms" className="textarea" defaultValue={c?.terms ?? ""} maxLength={2000} /></label>
          <label className="check full"><input type="checkbox" name="is_active" defaultChecked={c?.is_active ?? true} /> Active</label>
          <div className="form-actions full"><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button><Submit>Save campaign</Submit></div>
        </ActionForm>
      )}
    </Modal>
  );
}

export function RewardDecision({ id, status }: { id: string; status: string }) {
  return (
    <Modal title="Decide on this reward" triggerClass="btn btn-sm btn-primary" trigger={status === "eligible" ? "Review" : "Mark issued"}>
      {(close) => (
        <ActionForm action={decideRewardAction.bind(null, id)} className="stack" toast onDone={(r) => { if (r?.ok) close(); }}>
          <label className="field"><span className="label">Note (required when not approving; for “issued”, how it was given)</span><textarea name="note" className="textarea" maxLength={1000} /></label>
          <div className="form-actions">
            {status === "eligible" && <Submit name="decision" value="rejected" className="btn btn-danger">Don&apos;t approve</Submit>}
            {status === "eligible" && <Submit name="decision" value="approved" className="btn btn-success">Approve</Submit>}
            {status === "approved" && <Submit name="decision" value="rejected" className="btn btn-danger">Cancel reward</Submit>}
            {status === "approved" && <Submit name="decision" value="issued">Mark issued</Submit>}
          </div>
        </ActionForm>
      )}
    </Modal>
  );
}
