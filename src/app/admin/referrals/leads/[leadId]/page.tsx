import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getLead, STAGES } from "@/server/referrals";
import { MEETING_TYPES, fmtCall } from "@/server/booking";
import { listAdmins } from "@/server/clients";
import { Badge, Money, Panel, ProposalBadge } from "@/components/ui";
import { ActionButton, ActionForm, Submit } from "@/components/forms";
import { changeStageAction, updateLeadAction, leadNoteAction, leadTaskAction, taskStatusAction, convertLeadAction, scheduleCallAction, callOutcomeAction,
  cancelCallAction, qualifyLeadAction, draftFollowUpAction, sendLeadEmailAction } from "@/app/actions/referrals";
import { AppError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { BookingLink } from "./booking-link";
import { stageTone } from "@/components/referrals/charts";

export const metadata = { title: "Lead" };
export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const actor = await requireAdmin();
  const { leadId } = await params;
  let d: Awaited<ReturnType<typeof getLead>>;
  try { d = await getLead(actor, leadId); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const admins = await listAdmins(actor);
  const l = d.lead;
  const ai = l.ai_assessment as { category?: string; fit?: string; reasons?: string[]; questions?: string[] } | null;
  const draft = d.activities.find((a) => a.kind === "ai_draft")?.data as { subject?: string; message?: string } | undefined;
  const canEmail = !!l.email && (!!l.contact_consent_at || l.contact_permission);
  const steps: [string, Date | null][] = [["Verified", l.verified_at], ["Qualified", l.qualified_at], ["Call booked", l.call_booked_at], ["Call completed", l.call_completed_at],
    ["Proposal sent", l.proposal_sent_at], ["Proposal accepted", l.proposal_accepted_at], ["Converted (paid)", l.converted_at]];
  return (
    <div className="stack">
      <div>
        <span className="eyebrow"><Link href="/admin/referrals/leads">Leads</Link></span>
        <h2 style={{ margin: "4px 0" }}>{l.business_name}</h2>
        <div className="row" style={{ flexWrap: "wrap" }}><Badge tone={stageTone(l.stage)}>{STAGES[l.stage]}</Badge>
          {l.flags.map((f) => <Badge key={f} tone="amber" plain>{f.replace(/_/g, " ")}</Badge>)}
          <span className="small muted">{l.source === "client_referral" ? "Client referral" : l.source} · created {fmtDateTime(l.created_at)}</span></div>
      </div>
      <ol className="row" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6, flexWrap: "wrap" }} aria-label="Progress">
        {steps.map(([s, at]) => <li key={s}><Badge tone={at ? "green" : ""} plain={!at}>{at ? "✓ " : ""}{s}</Badge></li>)}
      </ol>
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Attribution">
            {d.attribution ? <p className="small" style={{ margin: 0 }}>Referred by <Link href={`/admin/clients/${d.attribution.referrer_client_id}`}>{d.attribution.referrer_name}</Link>
              {d.attribution.project_name ? <> after <Link href={`/admin/projects/${d.attribution.project_id}`}>{d.attribution.project_name}</Link></> : null} via {d.attribution.method === "link" ? "their referral link" : "a direct introduction"} ({fmtDateTime(d.attribution.created_at)}). Locked — it can't be changed.</p>
              : <p className="small muted" style={{ margin: 0 }}>No referral attribution{l.flags.includes("self_referral") ? " (self-referral)" : l.flags.includes("existing_client") ? " (existing client)" : ""}.</p>}
            {d.revenue > 0 && <p className="small" style={{ marginBottom: 0 }}>Attributed revenue so far: <strong><Money value={d.revenue} /></strong></p>}
          </Panel>
          <Panel title="Details">
            <ActionForm action={updateLeadAction.bind(null, l.id)} className="form-grid" toast>
              <label className="field"><span className="label">Business</span><input name="business_name" className="input" defaultValue={l.business_name} required /></label>
              <label className="field"><span className="label">Contact</span><input name="contact_name" className="input" defaultValue={l.contact_name ?? ""} /></label>
              <label className="field"><span className="label">Email</span><input name="email" type="email" className="input" defaultValue={l.email ?? ""} /></label>
              <label className="field"><span className="label">Phone</span><input name="phone" className="input" defaultValue={l.phone ?? ""} /></label>
              <label className="field"><span className="label">Category</span><input name="business_category" className="input" defaultValue={l.business_category ?? ""} /></label>
              <label className="field"><span className="label">Service</span><input name="service" className="input" defaultValue={l.service ?? ""} /></label>
              <label className="field"><span className="label">Budget</span><input name="budget_range" className="input" defaultValue={l.budget_range ?? ""} /></label>
              <label className="field"><span className="label">Owner</span><select name="owner_id" className="select" defaultValue={l.owner_id ?? ""}><option value="">Unassigned</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label className="field full"><span className="label">Business problem</span><textarea name="problem" className="textarea" defaultValue={l.problem ?? ""} /></label>
              {l.intro_note && <p className="small muted full" style={{ margin: 0 }}>Introduction note: {l.intro_note}</p>}
              <p className="tiny faint full" style={{ margin: 0 }}>{l.contact_consent_at ? `Prospect agreed to be contacted on ${fmtDateTime(l.contact_consent_at)}.` : l.contact_permission ? "The referrer confirmed permission to share these contact details." : "No contact consent recorded — don't reach out directly; ask the referrer to connect you."}</p>
              <div className="form-actions full"><Submit className="btn btn-sm">Save details</Submit></div>
            </ActionForm>
          </Panel>
          <Panel title="Timeline">
            <ActionForm action={leadNoteAction.bind(null, l.id)} className="row" toast resetOnSuccess>
              <input name="body" className="input" style={{ flex: 1 }} required maxLength={5000} placeholder="Add a note" aria-label="Note" /><Submit className="btn btn-sm">Add</Submit>
            </ActionForm>
            <div className="list" style={{ marginTop: 10 }}>{d.activities.map((a) => (
              <div key={a.id} className="list-item" style={{ alignItems: "flex-start" }}><div className="grow"><div className="small">{a.body}</div>
                <div className="tiny faint">{a.kind} · {a.actor_name ?? "system"} · {fmtDateTime(a.created_at)}</div></div></div>
            ))}</div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title="Stage">
            <ActionForm action={changeStageAction.bind(null, l.id)} className="stack-sm" toast>
              <select name="stage" defaultValue={l.stage} className="select" aria-label="Stage">{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k} disabled={k === "won"}>{v}{k === "won" ? " (automatic)" : ""}</option>)}</select>
              <input name="reason" className="input" placeholder="Reason (required for lost / disqualified)" aria-label="Reason" maxLength={1000} />
              <Submit className="btn btn-sm">Update stage</Submit>
              <span className="tiny faint">Proposal stages update from the proposal builder; “Won” follows the first confirmed payment.</span>
            </ActionForm>
          </Panel>
          <Panel title="Discovery calls">
            <div className="stack-sm">
              {d.calls.map((c) => (
                <div key={c.id} className="stack-sm" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                  <div className="row" style={{ flexWrap: "wrap" }}><strong className="small">{fmtCall(c.starts_at)}</strong><Badge plain>{MEETING_TYPES[c.meeting_type as keyof typeof MEETING_TYPES]}</Badge><Badge tone={c.status === "completed" ? "green" : c.status === "scheduled" ? "blue" : ""}>{c.status.replace("_", " ")}</Badge></div>
                  {c.meeting_link && <a className="tiny" href={c.meeting_link} target="_blank" rel="noopener noreferrer">{c.meeting_link}</a>}
                  {c.outcome && <span className="tiny">Outcome: {c.outcome.replace(/_/g, " ")}{c.notes ? ` — ${c.notes}` : ""}</span>}
                  {c.status === "scheduled" && (
                    <div className="stack-sm">
                      <ActionForm action={callOutcomeAction.bind(null, c.id)} className="stack-sm" toast>
                        <select name="outcome" className="select" aria-label="Outcome" defaultValue="qualified">
                          <option value="qualified">Qualified</option><option value="proposal_requested">Proposal requested</option><option value="follow_up">Needs follow-up</option>
                          <option value="not_a_fit">Not a fit</option><option value="no_show">No-show</option></select>
                        <textarea name="notes" className="textarea" style={{ minHeight: 56 }} placeholder="Meeting notes" aria-label="Meeting notes" maxLength={5000} />
                        <Submit className="btn btn-sm">Record outcome</Submit>
                      </ActionForm>
                      <ActionButton action={cancelCallAction.bind(null, c.id)} className="btn btn-sm btn-ghost" confirm="Cancel this call?">Cancel call</ActionButton>
                    </div>
                  )}
                </div>
              ))}
              <details><summary className="small" style={{ cursor: "pointer" }}>+ Schedule a call</summary>
                <ActionForm action={scheduleCallAction.bind(null, l.id)} className="stack-sm" toast>
                  <input type="datetime-local" name="starts_at" className="input" required aria-label="Start (India time)" />
                  <div className="row"><select name="meeting_type" className="select" aria-label="Meeting type">{Object.entries(MEETING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="duration" type="number" min={10} max={240} defaultValue={30} className="input" style={{ width: 90 }} aria-label="Minutes" /></div>
                  <input name="meeting_link" className="input" placeholder="https://meet.google.com/…" aria-label="Meeting link" />
                  <Submit className="btn btn-sm">Schedule</Submit>
                </ActionForm>
              </details>
              <BookingLink leadId={l.id} />
            </div>
          </Panel>
          <Panel title="Proposal">
            {d.proposals.length > 0 ? <div className="list">{d.proposals.map((p) => <Link key={p.id} href={`/admin/proposals/${p.id}`} className="list-item"><span className="grow small">{p.number} · {p.title}</span><Money value={Number(p.total)} /><ProposalBadge status={p.status} /></Link>)}</div>
              : <p className="small muted" style={{ marginTop: 0 }}>No proposal yet.</p>}
            <ActionButton action={convertLeadAction.bind(null, l.id)} className="btn btn-sm btn-primary">{l.client_id ? "Create another proposal" : "Create client & proposal"}</ActionButton>
            <p className="tiny faint" style={{ marginBottom: 0 }}>Opens the proposal builder with your pricing settings. Sending and acceptance update this lead automatically.</p>
          </Panel>
          <Panel title="Tasks">
            <div className="stack-sm">{d.tasks.map((t) => (
              <div key={t.id} className="row small" style={{ opacity: t.status === "open" ? 1 : 0.5 }}><span className="grow">{t.description}{t.due_at ? <span className="tiny faint"> · {fmtDateTime(t.due_at)}</span> : null}</span>
                {t.status === "open" && <ActionButton action={taskStatusAction.bind(null, t.id, "done")} className="btn btn-sm">Done</ActionButton>}</div>
            ))}
              <ActionForm action={leadTaskAction.bind(null, l.id)} className="row" toast resetOnSuccess>
                <input name="description" className="input" style={{ flex: 1 }} required maxLength={1000} placeholder="New task" aria-label="New task" />
                <input name="due_date" type="date" className="input" style={{ width: 150 }} aria-label="Due date" /><Submit className="btn btn-sm">Add</Submit>
              </ActionForm>
            </div>
          </Panel>
          <Panel title="AI assistance (optional)" sub="Suggestions only. Nothing is sent or changed automatically.">
            <div className="stack-sm">
              <div className="row" style={{ flexWrap: "wrap" }}><ActionButton action={qualifyLeadAction.bind(null, l.id)} className="btn btn-sm">Suggest qualification</ActionButton>
                <ActionButton action={draftFollowUpAction.bind(null, l.id)} className="btn btn-sm">Draft follow-up email</ActionButton></div>
              {ai && <div className="small"><Badge tone="violet" plain>{ai.category}</Badge> {ai.fit}
                {ai.reasons?.length ? <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{ai.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
                {ai.questions?.length ? <><span className="tiny faint">Ask on the call:</span><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{ai.questions.map((r) => <li key={r}>{r}</li>)}</ul></> : null}</div>}
              {canEmail ? (
                <ActionForm action={sendLeadEmailAction.bind(null, l.id)} className="stack-sm" toast>
                  <input name="subject" className="input" defaultValue={draft?.subject ?? ""} placeholder="Subject" aria-label="Email subject" />
                  <textarea name="body" className="textarea" style={{ minHeight: 120 }} defaultValue={draft?.message ?? ""} placeholder="Write or paste an approved message" aria-label="Email message" />
                  <Submit className="btn btn-sm" confirm={`Send this email to ${l.email}?`}>Send email</Submit>
                </ActionForm>
              ) : <span className="tiny faint">Email sending needs an email address and the prospect's consent.</span>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
