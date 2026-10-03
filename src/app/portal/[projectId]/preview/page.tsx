import { requireClient } from "@/lib/session";
import { listPreviews } from "@/server/content";
import { Empty, PageHead, Panel, PreviewBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { PreviewViewer } from "@/components/views/preview-viewer";
import { CommentForm, CommentList } from "@/components/views/comments";
import { PreviewReview } from "./review";
import { fmtDate } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "Website preview" };

export default async function PreviewPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ v?: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const { v } = await searchParams;
  const previews = await listPreviews(actor, projectId);
  if (previews.length === 0) {
    return (
      <>
        <PageHead eyebrow="Website preview" title="Preview not ready" />
        <div className="glass panel">
          <Empty icon="monitor" title="Your website preview is not ready yet">
            As soon as the first version of your website is available, it will appear here for you to review on desktop, tablet and mobile.
          </Empty>
        </div>
      </>
    );
  }
  const current = previews.find((p) => p.id === v) ?? previews[0];
  const open = current.status === "ready_for_review" || (current.status === "changes_requested" && current.id === previews[0].id);
  return (
    <>
      <PageHead eyebrow="Website preview" title={current.title || `Preview version ${current.version_no}`}
        sub={<>Version {current.version_no} · published {fmtDate(current.published_at)} · <PreviewBadge status={current.status} /></>}
        actions={<a className="btn btn-primary" href={current.url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open in new tab</a>} />
      <PreviewViewer url={current.url} embedBlocked={current.embed_blocked} />
      <div className="grid grid-main section" style={{ alignItems: "start" }}>
        <div className="stack">
          {current.notes && <Panel title="Notes from the team"><p className="muted pre">{current.notes}</p></Panel>}
          {current.screenshots.length > 0 && (
            <Panel title="Screenshots">
              <div className="grid grid-2">
                {current.screenshots.map((s) => (
                  <a key={s.id} href={`/api/documents/${s.id}`} target="_blank" rel="noopener" className="glass" style={{ overflow: "hidden", display: "block" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/documents/${s.id}`} alt={s.name} style={{ width: "100%", display: "block", aspectRatio: "16/10", objectFit: "cover" }} loading="lazy" />
                  </a>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Feedback on this version" sub="Comments are shared with the Infinity Web & Apps team.">
            <CommentList comments={current.comments} />
            <CommentForm projectId={projectId} targetType="preview" targetId={current.id} placeholder="Share feedback on this version…" />
          </Panel>
        </div>
        <div className="stack">
          {open && <Panel title="Your review"><PreviewReview previewId={current.id} /></Panel>}
          {current.status === "approved" && <div className="notice success">You approved this version{current.reviewed_at ? ` on ${fmtDate(current.reviewed_at)}` : ""}.</div>}
          <Panel title="Version history">
            <div className="list">
              {previews.map((p) => (
                <Link key={p.id} href={`?v=${p.id}`} className="list-item" style={p.id === current.id ? { background: "rgba(61,139,255,.08)" } : undefined}>
                  <div className="grow"><div className="small" style={{ fontWeight: 500 }}>Version {p.version_no}</div><div className="tiny faint">{fmtDate(p.published_at)}</div></div>
                  <PreviewBadge status={p.status} />
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
