"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { savePreferencesAction } from "@/app/actions/growth";

export function PreferencesForm({ prefs }: { prefs: { email: boolean; whatsapp: boolean; consentAt: string | null; phone: string | null; available: boolean } }) {
  const [wa, setWa] = useState(prefs.whatsapp);
  return (
    <ActionForm action={savePreferencesAction} className="stack" toast>
      <label className="check"><input type="checkbox" name="notify_email" defaultChecked={prefs.email} /> <span>Email: new app builds, meeting confirmations and referral updates</span></label>
      <label className="check"><input type="checkbox" name="notify_whatsapp" checked={wa} onChange={(e) => setWa(e.target.checked)} disabled={!prefs.phone} />
        <span>WhatsApp: a short message when our team replies{prefs.phone ? ` (to ${prefs.phone})` : " — add a phone number first"}</span></label>
      {wa && (
        <label className="check" style={{ marginLeft: 26 }}><input type="checkbox" name="whatsapp_consent" defaultChecked={!!prefs.consentAt} required />
          <span className="small">I agree to receive WhatsApp messages from Infinity Web &amp; Apps about my projects. I can turn this off any time.</span></label>
      )}
      {!prefs.available && <p className="tiny faint" style={{ margin: 0 }}>WhatsApp messages start once our WhatsApp Business account is connected. We&apos;ll save your choice until then.</p>}
      <div><Submit className="btn btn-sm btn-primary">Save preferences</Submit></div>
    </ActionForm>
  );
}
