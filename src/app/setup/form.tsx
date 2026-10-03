"use client";

import { ActionForm, Submit } from "@/components/forms";
import { setupAdminAction } from "@/app/actions/auth";

export function SetupForm() {
  return (
    <ActionForm action={setupAdminAction} className="stack">
      <div className="field"><label htmlFor="setup_token">Setup token</label><input id="setup_token" name="setup_token" type="password" className="input" required /></div>
      <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" className="input" required /></div>
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" className="input" required minLength={10} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" className="input" required autoComplete="new-password" /></div>
      <Submit className="btn btn-primary btn-lg btn-block" pendingText="Creating…">Create admin</Submit>
    </ActionForm>
  );
}
