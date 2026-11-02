"use client";

import { useState } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { VoiceRecorder } from "@/components/resolve/voice-recorder";
import { startRequestAction, replyAction, confirmAction, clientCommentAction, verifyAction } from "@/app/actions/resolve";

const EXAMPLES = ["I want to change the homepage", "The contact form isn't sending emails", "Can we add online booking?", "Please update our opening hours"];

export function AskForm({ projectId }: { projectId: string }) {
  const [text, setText] = useState("");
  return (
    <ActionForm action={startRequestAction.bind(null, projectId)} className="stack" toast>
      <input type="hidden" name="source" value="text" />
      <label className="field"><span className="label">What do you need?</span>
        <textarea name="message" className="textarea" style={{ minHeight: 110 }} required minLength={2} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Describe a change, a problem, a question or an idea. The assistant will ask follow-up questions if anything is unclear." /></label>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{EXAMPLES.map((e) => <button key={e} type="button" className="btn btn-sm btn-ghost" onClick={() => setText(e)}>{e}</button>)}</div>
      <label className="field"><span className="label">Screenshots (optional, up to 3)</span>
        <input name="screenshots" type="file" multiple accept="image/png,image/jpeg,image/webp" className="input" /></label>
      <div><Submit pendingText="Sending to the assistant…">Send</Submit></div>
      <p className="tiny faint" style={{ margin: 0 }}>The assistant only collects details. It never agrees prices, deadlines or scope changes — our team confirms those.</p>
    </ActionForm>
  );
}

export function VoiceRequest({ projectId, retentionDays }: { projectId: string; retentionDays: number }) {
  const [text, setText] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  return (
    <div className="stack">
      {text == null ? <VoiceRecorder projectId={projectId} retentionDays={retentionDays} onTranscript={(t, d) => { setText(t); setDoc(d); }} /> : (
        <ActionForm action={startRequestAction.bind(null, projectId)} className="stack" toast>
          <input type="hidden" name="source" value="voice" />
          {doc && <input type="hidden" name="document_ids" value={doc} />}
          <div className="notice info small">Here's what we heard. Please correct anything before sending.</div>
          <label className="field"><span className="label">Transcript</span>
            <textarea name="message" className="textarea" style={{ minHeight: 120 }} required minLength={2} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} /></label>
          <div className="row"><Submit>Send to the assistant</Submit><button type="button" className="btn btn-ghost" onClick={() => { setText(null); setDoc(null); }}>Record again</button></div>
        </ActionForm>
      )}
    </div>
  );
}

export function ReplyForm({ ticketId, projectId, retentionDays, placeholder = "Type your answer…" }: { ticketId: string; projectId: string; retentionDays: number; placeholder?: string }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(false);
  return (
    <ActionForm action={replyAction.bind(null, ticketId)} className="stack-sm" toast onDone={() => setText("")}>
      <label className="sr-only" htmlFor="reply">Your answer</label>
      <textarea id="reply" name="message" className="textarea" style={{ minHeight: 72 }} required maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
      {voice && <VoiceRecorder projectId={projectId} retentionDays={retentionDays} onTranscript={(t) => { setText((x) => (x ? `${x}\n${t}` : t)); setVoice(false); }} />}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {!voice && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setVoice(true)}>Answer by voice</button>}
        <Submit className="btn btn-primary btn-sm" pendingText="Thinking…">Send</Submit>
      </div>
    </ActionForm>
  );
}

export function ConfirmSummary({ ticketId, requirement }: { ticketId: string; requirement: string }) {
  const [edit, setEdit] = useState(false);
  return (
    <ActionForm action={confirmAction.bind(null, ticketId)} className="stack-sm" toast>
      {edit ? <label className="field"><span className="label">Edit the requirement</span>
        <textarea name="requirement" className="textarea" style={{ minHeight: 100 }} defaultValue={requirement} maxLength={4000} /></label> : null}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Submit className="btn btn-success" pendingText="Sending…">Yes, this is correct — send to the team</Submit>
        {!edit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(true)}>Edit wording</button>}
      </div>
    </ActionForm>
  );
}

export function CommentForm({ ticketId }: { ticketId: string }) {
  return (
    <ActionForm action={clientCommentAction.bind(null, ticketId)} className="stack-sm" toast resetOnSuccess>
      <label className="sr-only" htmlFor="cc">Message the team</label>
      <textarea id="cc" name="message" className="textarea" style={{ minHeight: 64 }} required maxLength={10000} placeholder="Add a comment or more details for the team…" />
      <div className="row" style={{ justifyContent: "flex-end" }}><Submit className="btn btn-primary btn-sm" pendingText="Sending…">Send</Submit></div>
    </ActionForm>
  );
}

export function VerifyForm({ ticketId }: { ticketId: string }) {
  const [no, setNo] = useState(false);
  return (
    <div className="stack-sm">
      {!no ? (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <ActionForm action={verifyAction.bind(null, ticketId)} toast className="inline-form"><input type="hidden" name="fixed" value="1" />
            <Submit className="btn btn-success">Yes, it's resolved</Submit></ActionForm>
          <button type="button" className="btn" onClick={() => setNo(true)}>No, something's still wrong</button>
        </div>
      ) : (
        <ActionForm action={verifyAction.bind(null, ticketId)} toast className="stack-sm"><input type="hidden" name="fixed" value="0" />
          <textarea name="note" className="textarea" required maxLength={5000} placeholder="What still isn't right?" aria-label="What still isn't right?" />
          <div className="row"><Submit>Send to the team</Submit><button type="button" className="btn btn-ghost" onClick={() => setNo(false)}>Back</button></div>
        </ActionForm>
      )}
    </div>
  );
}
