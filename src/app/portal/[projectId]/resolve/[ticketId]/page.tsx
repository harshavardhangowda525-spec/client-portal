import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/session";
import { getTicket, getResolveSettings, CATEGORIES } from "@/server/resolve";
import { PageHead, Panel, ResolveStatusBadge } from "@/components/ui";
import { Conversation, Attachments } from "@/components/resolve/conversation";
import { AutoRefresh } from "@/components/resolve/auto-refresh";
import { ReplyForm, ConfirmSummary, CommentForm, VerifyForm } from "../client-forms";
import { AppError } from "@/lib/errors";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Request" };

export default async function ClientTicket({ params }: { params: Promise<{ projectId: string; ticketId: string }> }) {
  const actor = await requireClient();
  const { projectId, ticketId } = await params;
  let data: Awaited<ReturnType<typeof getTicket>>;
  try { data = await getTicket(actor, ticketId); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  if (data.ticket.project_id !== projectId) notFound();
  const settings = await getResolveSettings();
  const t = data.ticket;
  const clarifying = !t.confirmed_at && (t.status === "awaiting_client" || t.status === "ai_clarification");
  const summary = clarifying ? t.pending_summary : null;
  return (
    <>
      <AutoRefresh seconds={8} />
      <PageHead eyebrow={<Link href={`/portal/${projectId}/resolve?tab=requests`}>Infinity Resolve</Link>} title={t.title}
        sub={<>{t.number} · {CATEGORIES[t.category]} · <ResolveStatusBadge status={t.status} />{t.target_date ? ` · target ${fmtDate(t.target_date)}` : ""}</>} />
      <div className="grid grid-main" style={{ alignItems: "start" }}>
        <div className="stack">
          <Panel title="Conversation">
            <Conversation messages={data.messages} />
            {data.files.length > 0 && <div style={{ marginTop: 14 }}><Attachments files={data.files} /></div>}
          </Panel>
          {summary && (
            <section className="summary-card stack-sm" aria-label="Summary to confirm">
              <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Is this right?</h2>
              <dl className="kv">
                <div><dt>Request</dt><dd>{summary.title}</dd></div>
                {summary.page && <div><dt>Page / screen</dt><dd>{summary.page}</dd></div>}
                {summary.section && <div><dt>Section</dt><dd>{summary.section}</dd></div>}
              </dl>
              <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{summary.requirement}</p>
              {summary.missing.length > 0 && <p className="tiny faint" style={{ margin: 0 }}>Still unknown: {summary.missing.join("; ")}. You can add these below, or confirm and the team will ask.</p>}
              <ConfirmSummary ticketId={t.id} requirement={summary.requirement} />
              <p className="tiny faint" style={{ margin: 0 }}>Not quite right? Reply below and the assistant will update the summary.</p>
            </section>
          )}
          {clarifying && <Panel title={summary ? "Add or correct details" : "Your answer"}><ReplyForm ticketId={t.id} projectId={projectId} retentionDays={settings.voice_retention_days} /></Panel>}
          {t.status === "awaiting_client_verification" && (
            <Panel title="Is it fixed?" sub="Please check the change on your website or app."><VerifyForm ticketId={t.id} /></Panel>
          )}
          {!clarifying && t.status !== "closed" && <Panel title="Message the team"><CommentForm ticketId={t.id} /></Panel>}
        </div>
        <div className="stack">
          <Panel title="Status">
            <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
              {[["Details collected", !!t.confirmed_at || t.status === "new"], ["Team review", ["approved", "in_progress", "awaiting_client_verification", "resolved", "closed"].includes(t.status)],
                ["Work in progress", ["in_progress", "awaiting_client_verification", "resolved", "closed"].includes(t.status)], ["You verify", ["resolved", "closed"].includes(t.status)],
                ["Resolved", ["resolved", "closed"].includes(t.status)]].map(([l, done]) => (
                <li key={String(l)} style={{ color: done ? "var(--text)" : "var(--text-3)" }}>{done ? "✓ " : ""}{l}</li>
              ))}
            </ol>
          </Panel>
          <p className="tiny faint">Prices, timelines and anything outside your agreed scope are always confirmed by our team, never by the assistant.</p>
        </div>
      </div>
    </>
  );
}
