import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getTicket, CATEGORIES, STATUSES, PRIORITIES, SCOPES } from "@/server/resolve";
import { GAP_LABELS, type GapKind } from "@/server/resolve-gaps";
import { listAdmins } from "@/server/clients";
import { Badge, Panel, PriorityBadge, ResolveStatusBadge, DeliveryBadge } from "@/components/ui";
import { ActionForm, ActionButton, Submit } from "@/components/forms";
import { Conversation, Attachments } from "@/components/resolve/conversation";
import { AutoRefresh } from "@/components/resolve/auto-refresh";
import { updateTicketAction, teamMessageAction, updateActionItemAction, createActionItemAction, closeGapAction, resendBriefingAction } from "@/app/actions/resolve";
import { AppError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Request" };
export const dynamic = "force-dynamic";

export default async function AdminTicket({ params }: { params: Promise<{ ticketId: string }> }) {
  const actor = await requireAdmin();
  const { ticketId } = await params;
  let d: Awaited<ReturnType<typeof getTicket>>;
  try { d = await getTicket(actor, ticketId); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const admins = await listAdmins(actor);
  const t = d.ticket;
  const details = t.details as Record<string, unknown>;
  const gaps = d.gaps as unknown as { id: string; kind: GapKind; severity: string; description: string; recommendation: string | null; status: string; detected_at: Date }[];
  const actions = d.actions as unknown as { id: string; description: string; priority: string; status: string; assigned_to: string | null; due_date: string | null; assignee_name: string | null; note: string | null }[];
  const briefings = d.briefings as unknown as { id: string; kind: string; subject: string; status: string; error: string | null; created_at: Date; recipient: string }[];
  return (
    <div className="stack">
      <AutoRefresh seconds={15} />
      <div className="row-between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <span className="eyebrow"><Link href="/admin/resolve">Requests</Link> · {t.number}</span>
          <h2 style={{ margin: "4px 0" }}>{t.title}</h2>
          <div className="row" style={{ flexWrap: "wrap" }}><ResolveStatusBadge status={t.status} admin /><PriorityBadge priority={t.priority} /><Badge plain>{CATEGORIES[t.category]}</Badge>
            <Badge plain>{SCOPES[t.scope_assessment]}</Badge>{t.ai_failed && <Badge tone="amber">AI unavailable</Badge>}
            <span className="small muted">{d.project.business_name} · <Link href={`/admin/projects/${t.project_id}`}>{d.project.name}</Link> · {t.source} · created {fmtDateTime(t.created_at)}</span></div>
        </div>
      </div>
      {t.duplicate_of && <div className="notice warn small">Looks like a repeat of <Link href={`/admin/resolve/${t.duplicate_of}`}>an earlier request</Link>.</div>}

      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Confirmed requirement" sub={t.confirmed_at ? `Confirmed by the client ${fmtDateTime(t.confirmed_at)}` : "Not confirmed by the client yet."}>
            <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{t.requirement ?? t.pending_summary?.requirement ?? t.original_message}</p>
            <dl className="kv">
              {details.page ? <div><dt>Page</dt><dd>{String(details.page)}</dd></div> : null}
              {details.section ? <div><dt>Section</dt><dd>{String(details.section)}</dd></div> : null}
              {details.page_url ? <div><dt>Page URL</dt><dd className="small" style={{ wordBreak: "break-all" }}>{String(details.page_url)}</dd></div> : null}
              {details.viewport ? <div><dt>Viewport</dt><dd>{(() => { const v = details.viewport as { width?: number; height?: number }; return `${v.width ?? "?"}×${v.height ?? "?"}`; })()}</dd></div> : null}
            </dl>
            {t.summary && <><h3 className="small" style={{ marginBottom: 4 }}>AI conversation summary</h3><p className="small muted" style={{ marginTop: 0 }}>{t.summary}</p></>}
            {(t.priority_reason || t.scope_reason) && <p className="tiny faint" style={{ margin: 0 }}>{t.priority_reason ? `Priority: ${t.priority_reason}. ` : ""}{t.scope_reason ? `Scope: ${t.scope_reason}` : ""}</p>}
            {Array.isArray(details.missing) && (details.missing as string[]).length > 0 && <p className="small" style={{ color: "var(--amber)" }}>Still unknown: {(details.missing as string[]).join("; ")}</p>}
          </Panel>
          <Panel title="Conversation" sub="Everything the assistant and your team said to the client, plus internal notes.">
            <Conversation messages={d.messages} admin clientName={d.project.business_name} />
            {d.files.length > 0 && <div style={{ marginTop: 14 }}><Attachments files={d.files} admin /></div>}
          </Panel>
          <Panel title="Reply">
            <ActionForm action={teamMessageAction.bind(null, t.id)} className="stack-sm" toast resetOnSuccess>
              <textarea name="body" className="textarea" required maxLength={10000} placeholder="Write to the client, or add an internal note…" aria-label="Message" />
              <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                <Submit className="btn" name="visibility" value="internal">Add internal note</Submit>
                <Submit className="btn btn-primary" name="visibility" value="client">Send to client</Submit>
              </div>
            </ActionForm>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Manage">
            <ActionForm action={updateTicketAction.bind(null, t.id)} className="stack-sm" toast>
              <label className="field"><span className="label">Status</span><select name="status" defaultValue={t.status} className="select">
                {Object.entries(STATUSES).filter(([k]) => k !== "ai_clarification" || t.status === k).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="field"><span className="label">Assign to</span><select name="assigned_to" defaultValue={t.assigned_to ?? ""} className="select">
                <option value="">Unassigned</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <div className="form-grid">
                <label className="field"><span className="label">Priority</span><select name="priority" defaultValue={t.priority} className="select">{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
                <label className="field"><span className="label">Target date</span><input type="date" name="target_date" defaultValue={t.target_date ?? ""} className="input" /></label>
              </div>
              <label className="field"><span className="label">Category</span><select name="category" defaultValue={t.category} className="select">{Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="field"><span className="label">Scope</span><select name="scope_assessment" defaultValue={t.scope_assessment} className="select">{Object.entries(SCOPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="field"><span className="label">Internal note (optional)</span><input name="note" className="input" maxLength={2000} /></label>
              <Submit>Save</Submit>
              <span className="tiny faint">The client is notified of status and target-date changes. “Resolved” is normally set by the client verifying the fix.</span>
            </ActionForm>
          </Panel>

          <Panel title="Action items" sub="Synced with the email briefing.">
            <div className="stack-sm">
              {actions.length === 0 && <p className="small muted" style={{ margin: 0 }}>No action items.</p>}
              {actions.map((a) => (
                <div key={a.id} className="row" style={{ alignItems: "flex-start", gap: 8 }}>
                  <div className="grow small" style={{ textDecoration: a.status === "done" ? "line-through" : undefined, color: a.status === "done" ? "var(--text-3)" : undefined }}>{a.description}
                    {a.assignee_name && <span className="tiny faint"> · {a.assignee_name}</span>}{a.status === "needs_info" && <Badge tone="amber" plain>needs info</Badge>}</div>
                  {a.status !== "done" && <ActionButton action={updateActionItemAction.bind(null, a.id)} fields={{ status: "done", assigned_to: a.assigned_to ?? "", due_date: a.due_date ?? "" }} className="btn btn-sm">Done</ActionButton>}
                </div>
              ))}
              <details><summary className="small" style={{ cursor: "pointer" }}>+ Add action item</summary>
                <ActionForm action={createActionItemAction.bind(null, t.id)} className="stack-sm" toast resetOnSuccess>
                  <input name="description" className="input" required maxLength={1000} placeholder="Task" aria-label="Task" />
                  <div className="row"><select name="priority" defaultValue="normal" className="select" aria-label="Priority">{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
                    <input type="date" name="due_date" className="input" aria-label="Due date" /></div>
                  <Submit className="btn btn-sm">Add</Submit>
                </ActionForm>
              </details>
            </div>
          </Panel>

          <Panel title="Communication gaps">
            {gaps.length === 0 ? <p className="small muted" style={{ margin: 0 }}>None detected.</p> : (
              <div className="stack-sm">{gaps.map((g) => (
                <div key={g.id} className="stack-sm" style={{ opacity: g.status === "open" ? 1 : 0.55 }}>
                  <div className="row"><Badge tone={g.severity === "high" || g.severity === "critical" ? "red" : "amber"} plain>{GAP_LABELS[g.kind]}</Badge><span className="tiny faint">{g.status}</span></div>
                  <span className="small">{g.description}</span>
                  {g.recommendation && <span className="tiny faint">→ {g.recommendation}</span>}
                  {g.status === "open" && <div className="row"><ActionButton action={closeGapAction.bind(null, g.id)} fields={{ status: "resolved" }} className="btn btn-sm">Resolved</ActionButton>
                    <ActionButton action={closeGapAction.bind(null, g.id)} fields={{ status: "dismissed" }} className="btn btn-sm btn-ghost">Dismiss</ActionButton></div>}
                </div>
              ))}</div>
            )}
          </Panel>

          <Panel title="Email briefings">
            {briefings.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No briefing sent yet. It's sent when the client confirms the request.</p> : (
              <div className="stack-sm">{briefings.map((b) => (
                <div key={b.id} className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  <Badge plain>{b.kind}</Badge><DeliveryBadge status={b.status} /><span className="tiny faint">{fmtDateTime(b.created_at)} · {b.recipient}</span>
                  <a className="btn btn-sm btn-ghost" href={`/api/admin/resolve/briefings/${b.id}`} target="_blank" rel="noopener">View</a>
                  <ActionButton action={resendBriefingAction.bind(null, b.id)} className="btn btn-sm btn-ghost">Resend</ActionButton>
                  {b.error && <div className="tiny faint" style={{ width: "100%" }}>{b.error}</div>}
                </div>
              ))}</div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
