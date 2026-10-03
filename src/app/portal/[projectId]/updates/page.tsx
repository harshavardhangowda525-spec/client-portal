import { requireClient } from "@/lib/session";
import { listUpdates } from "@/server/content";
import { Badge, Empty, PageHead } from "@/components/ui";
import { Icon } from "@/components/icons";
import { CommentForm, CommentList } from "@/components/views/comments";
import { fmtDateTime, UPDATE_KINDS } from "@/lib/format";

export const metadata = { title: "Project updates" };

export default async function UpdatesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const updates = await listUpdates(actor, projectId);
  return (
    <div className="narrow-wrap">
      <PageHead eyebrow="Activity" title="Project updates" sub="News from the team, and a place to share your thoughts on each step." />
      {updates.length === 0 ? <div className="glass panel"><Empty icon="activity" title="No updates yet">We will post updates here as your project progresses.</Empty></div> : (
        <div className="feed">
          {updates.map((u) => (
            <article key={u.id} className="glass feed-item" id={`u-${u.id}`}>
              <div className="row" style={{ marginBottom: 6 }}>
                <Badge tone={u.requests_feedback ? "amber" : "blue"} plain>{UPDATE_KINDS[u.kind]}</Badge>
                {u.milestone_title && <span className="tiny faint">· {u.milestone_title}</span>}
                <span className="tiny faint" style={{ marginLeft: "auto" }}>{fmtDateTime(u.created_at)}{u.author_name ? ` · ${u.author_name}` : ""}</span>
              </div>
              <h2 style={{ fontSize: "1.05rem" }}>{u.title}</h2>
              {u.body && <p className="muted pre" style={{ marginTop: 6 }}>{u.body}</p>}
              {u.attachments.length > 0 && (
                <div className="row" style={{ marginTop: 10 }}>
                  {u.attachments.map((a) => <a key={a.id} className="btn btn-sm" href={`/api/documents/${a.id}`} target="_blank" rel="noopener"><Icon name="file" /> {a.name}</a>)}
                </div>
              )}
              <hr />
              <CommentList comments={u.comments} />
              <CommentForm projectId={projectId} targetType="update" targetId={u.id} placeholder={u.requests_feedback ? "Share your feedback…" : "Reply…"} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
