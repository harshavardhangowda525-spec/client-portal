"use client";

import { useState } from "react";
import { ActionForm, CopyButton, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { inviteClientAction } from "@/app/actions/admin";

export function InvitePanel({ clientId, email, phone, ownerName, projects, emailConfigured }: {
  clientId: string; email: string; phone: string | null; ownerName: string; projects: { id: string; name: string }[]; emailConfigured: boolean;
}) {
  const [link, setLink] = useState<string | null>(null);
  const wa = (l: string) => {
    const digits = (phone ?? "").replace(/[^\d]/g, "");
    const to = digits.length === 10 ? `91${digits}` : digits;
    const text = `Hi ${ownerName}, here is your private project portal from Infinity Web & Apps: ${l}\n\nThis link works once and expires in 7 days.`;
    return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
  };
  return (
    <div className="stack">
      <ActionForm action={inviteClientAction.bind(null, clientId)} className="stack" onDone={(s) => setLink((s?.data?.link as string) ?? null)}>
        <div className="field"><label htmlFor="inv-email">Client email</label><input id="inv-email" name="email" type="email" className="input" defaultValue={email} required /></div>
        {projects.length > 0 && (
          <div className="field"><label htmlFor="inv-project">Project</label>
            <select id="inv-project" name="project_id" className="select">{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="">All of this client&apos;s projects</option></select></div>
        )}
        <label className="check"><input type="checkbox" name="send_email" defaultChecked={emailConfigured} disabled={!emailConfigured} />
          {emailConfigured ? "Also send the invitation by email" : "Email is not configured — copy the link and share it manually"}</label>
        <Submit pendingText="Creating…"><Icon name="link" /> Create invitation link</Submit>
      </ActionForm>
      {link && (
        <div className="notice info stack-sm">
          <span className="small">Private invitation link (single use, expires in 7 days):</span>
          <code className="tiny" style={{ wordBreak: "break-all" }}>{link}</code>
          <div className="row">
            <CopyButton text={link} label="Copy link" />
            <a className="btn btn-sm" href={wa(link)} target="_blank" rel="noopener noreferrer"><Icon name="send" /> Open in WhatsApp</a>
          </div>
          <span className="tiny faint">“Open in WhatsApp” opens a pre-filled chat for you to send — nothing is sent automatically.</span>
        </div>
      )}
    </div>
  );
}
