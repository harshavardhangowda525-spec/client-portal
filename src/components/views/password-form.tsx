"use client";

import { ActionForm, Submit } from "../forms";
import { changePasswordAction } from "@/app/actions/auth";

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="stack" >
      <div className="field"><label htmlFor="current">Current password</label><input id="current" name="current" type="password" className="input" required autoComplete="current-password" /></div>
      <div className="form-grid">
        <div className="field"><label htmlFor="next">New password</label><input id="next" name="next" type="password" className="input" required minLength={10} autoComplete="new-password" /><span className="hint">At least 10 characters with letters and numbers.</span></div>
        <div className="field"><label htmlFor="confirm">Confirm new password</label><input id="confirm" name="confirm" type="password" className="input" required autoComplete="new-password" /></div>
      </div>
      <div className="form-actions"><Submit pendingText="Saving…">Update password</Submit></div>
    </ActionForm>
  );
}
