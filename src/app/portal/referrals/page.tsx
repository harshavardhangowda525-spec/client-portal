import { requireClient } from "@/lib/session";
import { myReferrals } from "@/server/referrals";
import { Badge, Empty, PageHead, Panel } from "@/components/ui";
import { ActionButton, ActionForm, Submit } from "@/components/forms";
import { ShareTools } from "@/components/referrals/share";
import { createLinkAction, manageLinkAction, dismissInvitationAction, emailPreferenceAction, introductionAction } from "@/app/actions/referrals";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "My Referrals" };
export const dynamic = "force-dynamic";

const tone = (l: string) => (l === "Successful referral" ? "green" : l === "Closed" ? "" : l === "Enquiry submitted" ? "blue" : "violet") as "green" | "" | "blue" | "violet";

export default async function MyReferrals() {
  const actor = await requireClient();
  const r = await myReferrals(actor);
  return (
    <>
      <PageHead eyebrow="Refer a Business" title="My Referrals"
        sub="Enjoyed working with Infinity Web & Apps? Know another business that could benefit from better technology? We'd appreciate an introduction." />
      {!r.eligible && !r.link ? (
        <Panel><Empty icon="users" title="Not available yet">Referrals open after a completed project, once you&apos;ve shared your feedback. Thank you for working with us!</Empty></Panel>
      ) : (
        <>
          <div className="grid grid-3" style={{ marginBottom: 16 }}>
            <div className="panel"><span className="tiny faint">Verified introductions</span><div className="stat-value">{r.stats.verified}</div></div>
            <div className="panel"><span className="tiny faint">Successful referrals</span><div className="stat-value">{r.stats.successful}</div></div>
            <div className="panel"><span className="tiny faint">Link visits</span><div className="stat-value">{r.stats.visits}</div><span className="tiny faint">A visit isn&apos;t counted as a referral</span></div>
          </div>
          <div className="grid grid-main" style={{ alignItems: "start" }}>
            <div className="stack">
              <Panel title="Your referral link" sub="Share it with businesses who could use a website, an app or automation."
                actions={r.link ? <Badge tone={r.link.status === "active" ? "green" : "amber"}>{r.link.status}</Badge> : undefined}>
                {!r.link ? (
                  <div className="stack-sm"><p className="small muted" style={{ margin: 0 }}>Create your personal link. Anyone who enquires through it is credited to you.</p>
                    <div className="row"><ActionButton action={createLinkAction} className="btn btn-primary">Create my link</ActionButton>
                      {r.invitation === "available" && <ActionButton action={dismissInvitationAction} className="btn btn-ghost">Not now</ActionButton>}</div></div>
                ) : (
                  <div className="stack">
                    {r.link.status === "active" ? <ShareTools url={r.link.url} template={r.shareTemplate} /> : <div className="notice warn small">This link is {r.link.status}. Turn it back on or create a new one.</div>}
                    <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-start", gap: 16 }}>
                      {r.link.status === "active" && <div className="stack-sm"><span className="tiny faint">QR code</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/api/referrals/qr" alt="QR code for your referral link" className="qr-box" style={{ width: 160, height: 160 }} /></div>}
                      <div className="stack-sm">
                        {r.link.expires_at && <span className="tiny faint">Valid until {fmtDate(r.link.expires_at)}</span>}
                        <div className="row" style={{ flexWrap: "wrap" }}>
                          <ActionButton action={manageLinkAction.bind(null, "regenerate")} className="btn btn-sm" confirm="Create a new link? Your current link will stop working.">New link</ActionButton>
                          {r.link.status === "active" ? <ActionButton action={manageLinkAction.bind(null, "disable")} className="btn btn-sm btn-ghost">Turn off</ActionButton>
                            : <ActionButton action={manageLinkAction.bind(null, "enable")} className="btn btn-sm btn-ghost">Turn on</ActionButton>}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Panel>
              {r.eligible && (
                <Panel title="Introduce a business" sub="Tell us about a business that could use our help. We never contact anyone without permission.">
                  <ActionForm action={introductionAction} className="form-grid" toast resetOnSuccess>
                    <label className="field"><span className="label">Business name</span><input name="business_name" className="input" required minLength={2} maxLength={200} /></label>
                    <label className="field"><span className="label">Business category</span><input name="business_category" className="input" maxLength={100} /></label>
                    <label className="field"><span className="label">Contact person (optional)</span><input name="contact_name" className="input" maxLength={200} /></label>
                    <label className="field full"><span className="label">What do they need help with?</span><textarea name="challenge" className="textarea" required minLength={5} maxLength={2000} /></label>
                    <label className="field full"><span className="label">Introduction note (optional)</span><textarea name="note" className="textarea" maxLength={2000} /></label>
                    <label className="check full"><input type="checkbox" name="contact_permission" /> <span>They&apos;ve given me permission to share their contact details</span></label>
                    <label className="field"><span className="label">Their email (only with permission)</span><input name="contact_email" type="email" className="input" maxLength={320} /></label>
                    <label className="field"><span className="label">Their phone (only with permission)</span><input name="contact_phone" className="input" maxLength={40} /></label>
                    <div className="form-actions full"><Submit>Send introduction</Submit></div>
                    <p className="tiny faint full" style={{ margin: 0 }}>Without permission we only keep the business name and need; you can forward your link to them instead.</p>
                  </ActionForm>
                </Panel>
              )}
            </div>
            <div className="stack">
              <Panel title="Referral history">
                {r.history.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No referrals yet.</p> : (
                  <div className="list">{r.history.map((h) => (
                    <div key={h.id} className="list-item"><div className="grow"><div className="small" style={{ fontWeight: 500 }}>{h.name}</div><div className="tiny faint">{fmtDate(h.date)}</div></div>
                      <Badge tone={tone(h.label)}>{h.label}</Badge></div>
                  ))}</div>
                )}
                <p className="tiny faint" style={{ marginBottom: 0 }}>For their privacy we only show progress, never their details or discussions.</p>
              </Panel>
              <Panel title="Email preferences">
                <ActionForm action={emailPreferenceAction} toast className="stack-sm">
                  <input type="hidden" name="opt_out" value={r.optOut ? "0" : "1"} />
                  <span className="small muted">{r.optOut ? "You won't receive feedback or referral emails. Notices still appear here in the portal." : "You receive feedback reminders and referral updates by email."}</span>
                  <div><Submit className="btn btn-sm">{r.optOut ? "Turn emails back on" : "Stop these emails"}</Submit></div>
                </ActionForm>
              </Panel>
            </div>
          </div>
        </>
      )}
    </>
  );
}
