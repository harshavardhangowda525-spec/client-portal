import Link from "next/link";
import { requireClient } from "@/lib/session";
import { projectOverview, clientActivity } from "@/server/dashboards";
import { getBilling } from "@/server/billing";
import { getPaymentDetails } from "@/server/maintenance";
import { topRecommendation } from "@/server/marketplace";
import { Badge, Empty, MilestoneBadge, Money, Panel, ProgressBar, ProgressRing, ProjectBadge } from "@/components/ui";
import { PayBox } from "@/components/views/pay-box";
import { Icon } from "@/components/icons";
import { fmtDate, PROJECT_TYPES, timeAgo, UPDATE_KINDS } from "@/lib/format";
import { ApprovalResponse } from "./approval-response";
import { getFeedbackRequest } from "@/server/referrals";

export const metadata = { title: "Overview" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function Overview({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const base = `/portal/${projectId}`;
  const [o, fbReq, activity, billing, pd, rec] = await Promise.all([
    projectOverview(actor, projectId), getFeedbackRequest(actor, projectId).catch((e) => { console.error("[feedback request]", e); return null; }), clientActivity(actor, projectId),
    getBilling(actor, projectId), getPaymentDetails(), topRecommendation(actor),
  ]);
  const unpaid = billing.invoices.filter((i) => ["issued", "partially_paid"].includes(i.status) && i.balance > 0)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const nextInvoice = unpaid[0] ?? null;
  const reportedIds = new Set(billing.payments.filter((p) => p.status === "pending" && p.invoice_id).map((p) => p.invoice_id));
  const nextStep = o.pendingActions[0] ?? null;
  const quick: { href: string; label: string; icon: Parameters<typeof Icon>[0]["name"]; tint: string }[] = [
    { href: `${base}/preview`, label: "Preview website", icon: "monitor", tint: "blue" },
    { href: `${base}/proposal`, label: "Review proposal", icon: "file", tint: "violet" },
    { href: `${base}/preview`, label: "Approve design", icon: "check", tint: "green" },
    { href: `${base}/preview#feedback`, label: "Request revision", icon: "pen", tint: "amber" },
    { href: `${base}/payments`, label: "Make payment", icon: "wallet", tint: "blue" },
    { href: `${base}/resolve`, label: "Contact support", icon: "chat", tint: "violet" },
    { href: "/portal/services", label: "Explore services", icon: "store", tint: "green" },
    { href: "/portal/referrals", label: "Refer a business", icon: "gift", tint: "amber" },
  ];
  const askFeedback = fbReq?.workflow?.status === "awaiting_feedback" && !fbReq.feedback;
  const previewReady = o.latestPreview && o.latestPreview.status !== "superseded";
  const stage = o.project.current_stage ?? o.current?.title ?? "Getting started";

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="glass hero">
        <div className="row-between" style={{ alignItems: "flex-start", gap: 24, position: "relative", zIndex: 1 }}>
          <div className="stack-sm" style={{ maxWidth: 560 }}>
            <span className="eyebrow">{greeting()}, {o.client.owner_name.split(" ")[0]}</span>
            <h1>{o.project.name}</h1>
            <p className="muted">{o.client.business_name} · {PROJECT_TYPES[o.project.project_type]}</p>
            <div className="row" style={{ marginTop: 8 }}>
              <ProjectBadge status={o.project.status} />
              <span className="small muted">Current stage: <strong style={{ color: "var(--text)" }}>{stage}</strong></span>
            </div>
            <div className="row" style={{ marginTop: 16 }}>
              {previewReady ? (
                <Link href={`${base}/preview`} className="btn btn-primary btn-lg"><Icon name="eye" /> View website preview</Link>
              ) : (
                <span className="btn btn-lg" aria-disabled="true" title="Your preview will appear here once it is published"><Icon name="eye" /> Preview not ready yet</span>
              )}
              <Link href={`${base}/timeline`} className="btn btn-lg btn-ghost">See timeline</Link>
            </div>
          </div>
          <ProgressRing value={o.progress} />
        </div>
      </section>

      {o.project.status === "cancelled" && <div className="notice error">This project has been cancelled.{o.project.cancel_reason ? ` Reason: ${o.project.cancel_reason}` : ""}</div>}
      {o.project.status === "on_hold" && <div className="notice warn">This project is currently on hold. We will update you when work resumes.</div>}
      {o.project.status === "awaiting_client" && <div className="notice warn">We are waiting for your input before we can continue. Please check the actions below.</div>}

      {askFeedback && (
        <section className="glass panel row-between" style={{ flexWrap: "wrap", gap: 12, borderColor: "rgba(61,139,255,.4)" }}>
          <div><strong>Your project is complete!</strong><div className="small muted">We&apos;d love to hear about your experience with Infinity Web &amp; Apps. It takes about a minute.</div></div>
          <Link href={`${base}/feedback`} className="btn btn-primary">Share feedback</Link>
        </section>
      )}
      {nextStep && (
        <section className="glass panel next-step row-between" aria-label="Your next step" style={{ gap: 16 }}>
          <div className="row" style={{ alignItems: "flex-start", gap: 14, flex: "1 1 360px" }}>
            <span className="tint blue" aria-hidden="true"><Icon name={nextStep.kind === "invoice" ? "wallet" : nextStep.kind === "proposal" ? "file" : "eye"} /></span>
            <div className="stack-sm">
              <span className="eyebrow" style={{ margin: 0 }}>Your next step</span>
              <strong style={{ fontSize: "1.1rem" }}>{nextStep.title}</strong>
              {nextStep.due && <span className="small muted">Due {fmtDate(nextStep.due)}</span>}
            </div>
          </div>
          {nextStep.kind === "invoice" && nextInvoice
            ? <PayBox invoice={{ id: nextInvoice.id, number: nextInvoice.number, balance: nextInvoice.balance }} pd={pd} reported={reportedIds.has(nextInvoice.id)} />
            : <Link href={nextStep.href} className="btn btn-primary">Open <Icon name="external" /></Link>}
        </section>
      )}

      <section aria-labelledby="qa-h">
        <h2 id="qa-h" style={{ marginBottom: 12 }}>Quick actions</h2>
        <div className="quick-grid stagger">
          {quick.map((q) => (
            <Link key={q.label} href={q.href} className="quick"><span className={`tint ${q.tint}`} aria-hidden="true"><Icon name={q.icon} /></span>{q.label}</Link>
          ))}
        </div>
      </section>

      {o.pendingActions.length > 0 && (
        <Panel title={<><Icon name="alert" style={{ color: "var(--amber)" }} /> Needs your attention</>} sub="These items are waiting on you.">
          <div className="list">
            {o.pendingActions.map((a) => (
              <div key={a.id} className="list-item" id={`action-${a.id}`} style={{ alignItems: "flex-start" }}>
                <div className="grow stack-sm">
                  <div className="row">
                    <strong style={{ fontWeight: 500 }}>{a.title}</strong>
                    <Badge tone="amber" plain>{{ proposal: "Proposal", approval: "Response needed", preview: "Preview", invoice: "Payment" }[a.kind]}</Badge>
                  </div>
                  {a.detail && <p className="small muted pre">{a.detail}</p>}
                  {a.due && <span className="tiny faint">Due {fmtDate(a.due)}</span>}
                  {a.kind === "approval" && <ApprovalResponse requestId={a.id} />}
                </div>
                {a.kind !== "approval" && <Link href={a.href} className="btn btn-sm">Open</Link>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid grid-main">
        <Panel title="Project at a glance">
          <dl className="kv">
            <div><dt>Progress</dt><dd>{o.progress}% · {o.completedCount} of {o.total} milestones</dd></div>
            <div><dt>Start date</dt><dd>{fmtDate(o.project.start_date)}</dd></div>
            <div><dt>Estimated delivery</dt><dd>{o.project.target_delivery_date ? fmtDate(o.project.target_delivery_date) : "Based on the agreed schedule"}</dd></div>
            {o.manager && <div><dt>Project manager</dt><dd>{o.manager.name}</dd></div>}
          </dl>
          <hr />
          <div className="grid grid-2">
            <div className="stack-sm">
              <span className="tiny faint">Working on now</span>
              {o.current ? <><strong style={{ fontWeight: 500 }}>{o.current.title}</strong><MilestoneBadge status={o.current.status} /></> : <span className="muted small">Nothing in progress right now.</span>}
            </div>
            <div className="stack-sm">
              <span className="tiny faint">Next milestone</span>
              {o.next ? <><strong style={{ fontWeight: 500 }}>{o.next.title}</strong><span className="small muted">{o.next.due_date ? `Expected ${fmtDate(o.next.due_date)}` : "Date to be confirmed"}</span></> : <span className="muted small">All milestones are complete.</span>}
            </div>
          </div>
        </Panel>
        <Panel title="Latest update" actions={<Link href={`${base}/updates`} className="btn btn-sm btn-ghost">All updates</Link>}>
          {o.latestUpdate ? (
            <div className="stack-sm">
              <div className="row"><Badge tone="blue" plain>{UPDATE_KINDS[o.latestUpdate.kind]}</Badge><span className="tiny faint">{timeAgo(o.latestUpdate.created_at)}</span></div>
              <strong style={{ fontWeight: 500 }}>{o.latestUpdate.title}</strong>
              {o.latestUpdate.body && <p className="small muted pre" style={{ display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{o.latestUpdate.body}</p>}
            </div>
          ) : <Empty icon="activity" title="No updates yet">We will post progress updates here as work moves forward.</Empty>}
        </Panel>
      </div>

      <div className="grid grid-main">
        <Panel title="Recent activity" actions={<Link href={`${base}/timeline`} className="btn btn-sm btn-ghost">Timeline</Link>}>
          {activity.length ? (
            <ol className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {activity.map((a, i) => (
                <li key={i} className="list-item" style={{ alignItems: "flex-start" }}>
                  <span className="activity-dot" style={{ background: `var(--${a.tone === "violet" ? "violet" : a.tone})` }} aria-hidden="true" />
                  <div className="grow"><div style={{ fontWeight: 500 }}>{a.title}</div><div className="small faint">{a.meta}</div></div>
                  <span className="tiny faint" style={{ whiteSpace: "nowrap" }}>{timeAgo(a.at)}</span>
                </li>
              ))}
            </ol>
          ) : <Empty icon="activity" title="Nothing yet">Milestones, payments and reviews will show up here.</Empty>}
        </Panel>
        <div className="stack" style={{ gap: 16 }}>
          <Panel title="Payments" actions={nextInvoice?.due_date ? <Badge tone={nextInvoice.overdue ? "red" : "amber"} plain>{nextInvoice.overdue ? "Overdue" : `Due ${fmtDate(nextInvoice.due_date)}`}</Badge> : undefined}>
            {billing.contractTotal == null && !billing.invoices.length ? (
              <p className="small muted" style={{ margin: 0 }}>Payment details appear here once your proposal is accepted.</p>
            ) : (
              <div className="stack">
                <dl className="kv" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <div><dt>Total</dt><dd className="mono"><Money value={billing.contractTotal ?? billing.invoices.reduce((s, i) => s + Number(i.amount), 0)} /></dd></div>
                  <div><dt>Paid</dt><dd className="mono" style={{ color: "var(--green)" }}><Money value={billing.paidTotal} /></dd></div>
                  <div><dt>Balance</dt><dd className="mono"><Money value={billing.remaining ?? billing.outstandingInvoiced} /></dd></div>
                </dl>
                {billing.contractTotal ? <ProgressBar value={Math.min(100, Math.round((billing.paidTotal / billing.contractTotal) * 100))} label="Paid so far" /> : null}
                {nextInvoice ? (
                  <div className="row-between">
                    <span className="small muted">{nextInvoice.number}: <strong style={{ color: "var(--text)" }}><Money value={nextInvoice.balance} /></strong></span>
                    <PayBox invoice={{ id: nextInvoice.id, number: nextInvoice.number, balance: nextInvoice.balance }} pd={pd} reported={reportedIds.has(nextInvoice.id)} />
                  </div>
                ) : <span className="small muted">Nothing to pay right now.</span>}
                <span className="tiny faint">Payments show as paid only after we confirm them.</span>
              </div>
            )}
          </Panel>
          {rec && (
            <Panel title={<><Badge tone="violet" plain>Recommended</Badge> {rec.service.name}</>}>
              <div className="stack-sm">
                <p className="small muted" style={{ margin: 0 }}>{rec.service.summary}</p>
                <p className="tiny faint" style={{ margin: 0 }}>Why you&apos;re seeing this: {rec.reason}</p>
                <div className="row" style={{ marginTop: 6 }}><Link href="/portal/services" className="btn btn-sm">View details</Link><Link href="/portal/advisor" className="btn btn-sm btn-ghost">Ask the AI advisor</Link></div>
              </div>
            </Panel>
          )}
          <Panel title="Know a business that needs a website?">
            <p className="small muted" style={{ margin: "0 0 10px" }}>Share your referral link and follow every step of their journey here.</p>
            <Link href="/portal/referrals" className="btn btn-sm btn-primary"><Icon name="gift" /> Refer a business</Link>
          </Panel>
        </div>
      </div>
    </div>
  );
}
