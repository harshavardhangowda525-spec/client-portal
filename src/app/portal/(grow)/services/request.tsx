"use client";

import { ActionForm, Modal, Submit } from "@/components/forms";
import { requestUpgradeAction } from "@/app/actions/growth";

export function RequestUpgrade({ serviceId, name }: { serviceId: string; name: string }) {
  return (
    <Modal title={`Request ${name}`} triggerClass="btn btn-sm btn-primary" trigger="Request upgrade">
      {(close) => (
        <ActionForm action={requestUpgradeAction.bind(null, serviceId)} className="stack" toast onDone={(s) => { if (s?.ok) close(); }}>
          <p className="small muted" style={{ margin: 0 }}>We&apos;ll look at your business and reply with options. This doesn&apos;t charge you or change your current project.</p>
          <label className="field"><span className="label">What would you like it to do? (optional)</span>
            <textarea name="note" className="textarea" maxLength={2000} placeholder="e.g. Let patients book physio sessions online and get WhatsApp reminders" /></label>
          <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button><Submit>Send request</Submit></div>
        </ActionForm>
      )}
    </Modal>
  );
}
