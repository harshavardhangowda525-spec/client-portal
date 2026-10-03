"use client";

import { ActionForm, Submit } from "@/components/forms";
import { loginAction } from "@/app/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} className="stack">
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      <Submit className="btn btn-primary btn-lg btn-block" pendingText="Signing in…">Sign in</Submit>
    </ActionForm>
  );
}
