import { requireAdmin } from "@/lib/session";
import { listPreviews } from "@/server/content";
import { Empty, Panel, PreviewBadge } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { CommentForm, CommentList } from "@/components/views/comments";
import { UploadForm } from "@/components/views/upload-form";
import { setPreviewEmbedAction } from "@/app/actions/admin";
import { fmtDateTime } from "@/lib/format";
import { PublishPreviewForm } from "./publish";

export const dynamic = "force-dynamic";

export default async function AdminPreviews({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const previews = await listPreviews(actor, projectId);
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <div className="stack">
        {previews.length === 0 ? <div className="glass panel"><Empty icon="monitor" title="No previews published">The client sees a “Preview not ready” message until you publish a real preview URL.</Empty></div> :
          previews.map((p) => (
            <Panel key={p.id} title={`Version ${p.version_no}${p.title ? ` · ${p.title}` : ""}`} actions={<PreviewBadge status={p.status} />}>
              <div className="stack-sm">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="small truncate"><Icon name="external" /> {p.url}</a>
                <span className="tiny faint">Published {fmtDateTime(p.published_at)}{p.reviewed_at ? ` · reviewed ${fmtDateTime(p.reviewed_at)}` : ""}</span>
                {p.notes && <p className="small muted pre">{p.notes}</p>}
                <div className="row">
                  <span className="small muted">{p.embed_blocked ? "Opens in a new tab for the client (embedding blocked)." : "Embedded in the client portal."}</span>
                  <ActionButton action={setPreviewEmbedAction.bind(null, p.id, !p.embed_blocked)} className="btn btn-sm btn-ghost">{p.embed_blocked ? "Try embedding" : "Use external link only"}</ActionButton>
                </div>
                {p.screenshots.length > 0 && <div className="row">{p.screenshots.map((s) => <a key={s.id} className="btn btn-sm" href={`/api/documents/${s.id}`} target="_blank" rel="noopener"><Icon name="eye" /> {s.name}</a>)}</div>}
              </div>
              <hr />
              <h3 className="small" style={{ marginBottom: 4 }}>Feedback</h3>
              <CommentList comments={p.comments} />
              <CommentForm projectId={projectId} targetType="preview" targetId={p.id} placeholder="Reply to the client…" />
            </Panel>
          ))}
      </div>
      <div className="stack">
        <Panel title="Publish a preview" sub="Each publish creates a new version and notifies the client."><PublishPreviewForm projectId={projectId} /></Panel>
        {previews.length > 0 && (
          <Panel title="Add screenshot to a version">
            <UploadForm projectId={projectId} categories={[["screenshot", "Screenshot"]]}
              extra={<div className="field full"><label htmlFor="pv">Preview version</label><select id="pv" name="preview_id" className="select">{previews.map((p) => <option key={p.id} value={p.id}>Version {p.version_no}</option>)}</select></div>} />
          </Panel>
        )}
      </div>
    </div>
  );
}
