"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, CopyButton, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { sendProposalAction, connectProjectAction, deleteProposalAction } from "@/app/actions/proposals";
import { inviteClientAction } from "@/app/actions/admin";

export function SendProposal({ proposalId, emailConfigured, contactEmail, disabled }: { proposalId: string; emailConfigured: boolean; contactEmail: string; disabled: boolean }) {
  return (
    <ActionForm action={sendProposalAction.bind(null, proposalId)} className="stack-sm" toast>
      <label className="check"><input type="checkbox" name="send_email" disabled={!emailConfigured} defaultChecked={emailConfigured} />
        {emailConfigured ? `Also email it to ${contactEmail}` : "Email is not configured — share the link below instead"}</label>
      <Submit className="btn btn-primary btn-block" disabled={disabled} pendingText="Sending…"
        confirm="Send this proposal to the client? This version will be locked; later changes need a revised version and fresh approval.">
        <Icon name="send" /> Send to client
      </Submit>
    </ActionForm>
  );
}

export function SharePanel({ link, text, whatsapp, portalUsers, pendingInvite, clientId, clientEmail, sent }: {
  link: string; text: string; whatsapp: string; portalUsers: number; pendingInvite: boolean; clientId: string; clientEmail: string; sent: boolean;
}) {
  const [invite, setInvite] = useState<string | null>(null);
  const msg = invite ? `${text}\n\nFirst time? Set up your secure portal access here (single use, expires in 7 days): ${invite}` : text;
  const waLink = invite ? whatsapp.replace(/text=.*$/, `text=${encodeURIComponent(msg)}`) : whatsapp;
  return (
    <div className="stack">
      {!sent && <p className="small muted">Send the proposal first, then share the link.</p>}
      {portalUsers === 0 && (
        <div className="notice warn stack-sm">
          <span className="small">The client has no portal account yet{pendingInvite ? " (an invitation is pending)" : ""}. Create an invitation so they can sign in and review the proposal.</span>
          <ActionForm action={inviteClientAction.bind(null, clientId)} onDone={(s) => setInvite((s?.data?.link as string) ?? null)} className="row">
            <input type="hidden" name="email" value={clientEmail} />
            <Submit className="btn btn-sm">{pendingInvite ? "Create a new invitation link" : "Create invitation link"}</Submit>
          </ActionForm>
        </div>
      )}
      <div className="field">
        <label htmlFor="share-link">Secure proposal link (sign-in required)</label>
        <div className="row" style={{ flexWrap: "nowrap" }}><input id="share-link" className="input" readOnly value={link} /><CopyButton text={link} label="Copy" /></div>
      </div>
      <div className="field">
        <label htmlFor="share-msg">WhatsApp / message text</label>
        <textarea id="share-msg" className="textarea" readOnly value={msg} style={{ minHeight: 170, fontSize: 12.5 }} />
        <div className="row">
          <CopyButton text={msg} label="Copy message" />
          <a className="btn btn-sm" href={waLink} target="_blank" rel="noopener noreferrer" aria-disabled={!sent}><Icon name="send" /> Open in WhatsApp</a>
        </div>
        <span className="hint">Opens a pre-filled chat for you to send — nothing is sent automatically, and it is not tracked as delivered.</span>
      </div>
    </div>
  );
}

export function ConnectProject({ proposalId, projects }: { proposalId: string; projects: { id: string; name: string; status: string }[] }) {
  const router = useRouter();
  return (
    <ActionForm action={connectProjectAction.bind(null, proposalId)} className="stack-sm" toast
      onDone={(s) => s?.data?.projectId && router.push(`/admin/projects/${s.data.projectId}`)}>
      <label htmlFor="cp-project" className="small">Create a project from this proposal, or link an existing one</label>
      <select id="cp-project" name="project_id" className="select" defaultValue="">
        <option value="">Create a new project (milestones set up automatically)</option>
        {projects.map((p) => <option key={p.id} value={p.id}>Link to: {p.name}</option>)}
      </select>
      <Submit className="btn btn-primary btn-sm">Continue</Submit>
    </ActionForm>
  );
}

export function DeleteDraft({ proposalId }: { proposalId: string }) {
  return (
    <ActionForm action={deleteProposalAction.bind(null, proposalId)} redirectTo="/admin/proposals" toast>
      <Submit className="btn btn-ghost btn-block btn-sm" confirm="Delete this draft proposal?"><Icon name="trash" /> Delete draft</Submit>
    </ActionForm>
  );
}
