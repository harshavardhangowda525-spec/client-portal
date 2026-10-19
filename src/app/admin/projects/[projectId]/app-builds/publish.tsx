"use client";

import { ActionForm, Submit } from "@/components/forms";
import { publishAppBuildAction } from "@/app/actions/admin";

export function PublishAppBuildForm({ projectId }: { projectId: string }) {
  return (
    <ActionForm action={publishAppBuildAction.bind(null, projectId)} className="stack" resetOnSuccess>
      <div className="form-grid">
        <div className="field"><label htmlFor="ab-platform">Platform</label>
          <select id="ab-platform" name="platform" className="select" defaultValue="android">
            <option value="android">Android</option><option value="ios">iOS</option><option value="both">Android &amp; iOS</option>
          </select></div>
        <div className="field"><label htmlFor="ab-label">Version / build</label><input id="ab-label" name="build_label" className="input" maxLength={60} placeholder="1.0.3 (42)" /></div>
      </div>
      <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Ways to test (at least one)</legend>
        <div className="field"><label htmlFor="ab-apk">Android APK file</label><input id="ab-apk" name="apk" type="file" accept=".apk,application/vnd.android.package-archive" className="input" />
          <span className="hint">Up to about 4 MB when hosted on Vercel (its upload limit). For bigger APKs, upload to Google Drive or Firebase App Distribution and paste the link below.</span></div>
        <div className="field"><label htmlFor="ab-android">Android link</label><input id="ab-android" name="android_url" type="url" className="input" placeholder="https://play.google.com/apps/internaltest/… or APK download link" /></div>
        <div className="field"><label htmlFor="ab-ios">TestFlight link</label><input id="ab-ios" name="ios_url" type="url" className="input" placeholder="https://testflight.apple.com/join/…" /></div>
        <div className="field"><label htmlFor="ab-test">Expo / web demo link</label><input id="ab-test" name="test_url" type="url" className="input" placeholder="https://expo.dev/… or https://demo.example.com" /></div>
      </fieldset>
      <div className="field"><label htmlFor="ab-shots">Screenshots (up to 8)</label><input id="ab-shots" name="screenshots" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="input" /></div>
      <div className="field"><label htmlFor="ab-notes">What&apos;s new / what to test</label><textarea id="ab-notes" name="notes" className="textarea" maxLength={5000} placeholder="New: login with OTP, cart screen. Please test checkout on your phone." /></div>
      <Submit pendingText="Publishing…">Publish build</Submit>
      <span className="tiny faint">Publishing creates a new version, marks older open versions as superseded and notifies the client.</span>
    </ActionForm>
  );
}
