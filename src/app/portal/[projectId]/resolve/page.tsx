import Link from "next/link";
import { requireClient } from "@/lib/session";
import { listClientTickets, clientResolveSummary, getResolveSettings, CATEGORIES } from "@/server/resolve";
import { listPreviews } from "@/server/content";
import { Empty, PageHead, Panel, ResolveStatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { VisualFeedback } from "@/components/resolve/annotator";
import { startRequestAction } from "@/app/actions/resolve";
import { AskForm, VoiceRequest } from "./client-forms";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Infinity Resolve" };

const TABS = [["ask", "Ask AI Assistant"], ["voice", "Record Voice Request"], ["visual", "Visual Feedback"], ["requests", "My Requests"], ["awaiting", "Awaiting your reply"]] as const;

export default async function ResolveHub({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ tab?: string; preview?: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const sp = await searchParams;
  const [tickets, counts, settings, previews] = await Promise.all([listClientTickets(actor, projectId), clientResolveSummary(actor, projectId), getResolveSettings(), listPreviews(actor, projectId)]);
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : counts.awaiting ? "awaiting" : "ask";
  const preview = previews.find((p) => p.id === sp.preview) ?? previews[0] ?? null;
  const list = tab === "awaiting" ? tickets.filter((t) => t.status === "awaiting_client" || t.status === "awaiting_client_verification") : tickets;
  return (
    <>
      <PageHead eyebrow="Support" title="Infinity Resolve" sub="Explain what you need: type it, say it or mark it on a screenshot. Our assistant asks the right questions, then sends a clear request to the team. No phone call needed." />
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Link href="?tab=requests" className="panel" style={{ display: "block" }}><span className="tiny faint">Open requests</span><div className="stat-value">{counts.open}</div></Link>
        <Link href="?tab=awaiting" className="panel" style={{ display: "block" }}><span className="tiny faint">Waiting for your reply</span><div className="stat-value" style={counts.awaiting ? { color: "var(--amber)" } : undefined}>{counts.awaiting}</div></Link>
        <Link href="?tab=awaiting" className="panel" style={{ display: "block" }}><span className="tiny faint">Fixes to verify</span><div className="stat-value">{counts.verify}</div></Link>
      </div>
      <nav className="tabs" aria-label="Infinity Resolve">
        {TABS.map(([k, l]) => <Link key={k} href={`?tab=${k}`} aria-current={k === tab ? "page" : undefined}>{l}{k === "awaiting" && counts.awaiting + counts.verify ? ` (${counts.awaiting + counts.verify})` : ""}</Link>)}
      </nav>

      {tab === "ask" && <Panel title="Ask the AI assistant"><AskForm projectId={projectId} /></Panel>}
      {tab === "voice" && (
        <Panel title="Record a voice request" sub="Speak in English or your preferred Indian language (up to 3 minutes). You'll see the text before anything is sent.">
          <VoiceRequest projectId={projectId} retentionDays={settings.voice_retention_days} />
        </Panel>
      )}
      {tab === "visual" && (
        <Panel title="Visual feedback" sub={preview ? `Mark up a screenshot of your website preview (version ${preview.version_no}).` : "Mark up a screenshot of your website or app."}>
          <VisualFeedback projectId={projectId} previewId={preview?.id ?? null} previewUrl={preview?.url ?? null} retentionDays={settings.voice_retention_days} action={startRequestAction.bind(null, projectId)} />
        </Panel>
      )}
      {(tab === "requests" || tab === "awaiting") && (
        <Panel>
          {list.length === 0 ? <Empty icon="inbox" title={tab === "awaiting" ? "Nothing is waiting for you" : "No requests yet"}
            action={<Link className="btn btn-primary" href="?tab=ask">Ask the assistant</Link>}>{tab === "awaiting" ? "When the assistant or team needs your input, it appears here." : "Your requests and their progress appear here."}</Empty> : (
            <div className="list">{list.map((t) => (
              <Link key={t.id} href={`/portal/${projectId}/resolve/${t.id}`} className="list-item">
                <div className="grow"><div style={{ fontWeight: 500 }}>{t.title}</div>
                  <div className="tiny faint">{t.number} · {CATEGORIES[t.category]} · updated {fmtDateTime(t.updated_at)}{t.source !== "text" ? ` · ${t.source}` : ""}</div></div>
                <ResolveStatusBadge status={t.status} /><Icon name="external" />
              </Link>
            ))}</div>
          )}
        </Panel>
      )}
    </>
  );
}
