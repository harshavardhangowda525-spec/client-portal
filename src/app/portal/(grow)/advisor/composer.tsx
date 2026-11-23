"use client";

import { useRef } from "react";
import { ActionForm, Submit } from "@/components/forms";
import { askAdvisorAction } from "@/app/actions/growth";

export function AdvisorComposer({ starters }: { starters: string[] }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "12px 18px 16px" }}>
      {starters.length > 0 && (
        <div className="pill-row" style={{ marginBottom: 10 }}>
          {starters.map((s) => <button key={s} type="button" className="pill" onClick={() => { if (input.current) { input.current.value = s; input.current.focus(); } }}>{s}</button>)}
        </div>
      )}
      <ActionForm action={askAdvisorAction} className="row" resetOnSuccess>
        <label htmlFor="advisor-q" className="sr-only">Your message</label>
        <input ref={input} id="advisor-q" name="q" className="input" required minLength={2} maxLength={1500} autoComplete="off"
          placeholder="Describe your business or a problem you want to solve…" style={{ flex: 1, minWidth: 0 }} />
        <Submit pendingText="Thinking…">Send</Submit>
      </ActionForm>
    </div>
  );
}
