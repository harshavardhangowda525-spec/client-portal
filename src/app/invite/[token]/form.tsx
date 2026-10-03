"use client";

import { ActionForm, Submit } from "@/components/forms";
import { acceptInviteAction } from "@/app/actions/auth";

export function InviteForm({ token, email, ownerName, hasAccount }: { token: string; email: string; ownerName: string; hasAccount: boolean }) {
  return (
    <ActionForm action={acceptInviteAction.bind(null, token)} className="stack">
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" value={email} readOnly autoComplete="username" />
      </div>
      {!hasAccount && (
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" className="input" defaultValue={ownerName} required maxLength={200} autoComplete="name" />
        </div>
      )}
      <div className="field">
        <label htmlFor="password">{hasAccount ? "Your password" : "Create a password"}</label>
        <input id="password" name="password" type="password" className="input" required minLength={hasAccount ? 1 : 10}
          autoComplete={hasAccount ? "current-password" : "new-password"} />
        {!hasAccount && <span className="hint">At least 10 characters, with letters and numbers.</span>}
      </div>
      {!hasAccount && (
        <div className="field">
          <label htmlFor="confirm">Confirm password</label>
          <input id="confirm" name="confirm" type="password" className="input" required autoComplete="new-password" />
        </div>
      )}
      <Submit className="btn btn-primary btn-lg btn-block" pendingText="Setting up…">{hasAccount ? "Continue" : "Create account & open portal"}</Submit>
    </ActionForm>
  );
}
