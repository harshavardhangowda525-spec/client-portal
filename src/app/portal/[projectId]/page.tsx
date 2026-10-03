import Link from "next/link";
import { requireClient } from "@/lib/session";
import { projectOverview } from "@/server/dashboards";
import { Badge, Empty, MilestoneBadge, Panel, ProgressRing, ProjectBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate, PROJECT_TYPES, timeAgo, UPDATE_KINDS } from "@/lib/format";
import { ApprovalResponse } from "./approval-response";

export const metadata = { title: "Overview" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function Overview({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const o = await projectOverview(actor, projectId);
  const base = `/portal/${projectId}`;
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

      {o.pendingActions.length > 0 && (
        <Panel title={<><Icon name="alert" style={{ color: "var(--amber)" }} /> Needs your attention</>} sub="These items are waiting on you.">
          <div className="list">
            {o.pendingActions.map((a) => (
              <div key={a.id} className="list-item" id={`action-${a.id}`} style={{ alignItems: "flex-start" }}>
                <div className="grow stack-sm">
                  <div className="row">
                    <strong style={{ fontWeight: 500 }}>{a.title}</strong>
                    <Badge tone="amber" plain>{{ quotation: "Quotation", approval: "Response needed", preview: "Preview", invoice: "Payment" }[a.kind]}</Badge>
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
    </div>
  );
}
