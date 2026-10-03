import { requireAdmin } from "@/lib/session";
import { listUpdates } from "@/server/content";
import { listMilestones } from "@/server/milestones";
import { Badge, Empty, Panel } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { CommentForm, CommentList } from "@/components/views/comments";
import { deleteUpdateAction } from "@/app/actions/admin";
import { fmtDateTime, UPDATE_KINDS } from "@/lib/format";
import { PostUpdateForm } from "./post";

export const dynamic = "force-dynamic";

export default async function AdminUpdates({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const [updates, ms] = await Promise.all([listUpdates(actor, projectId), listMilestones(actor, projectId)]);
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <div className="feed">
        {updates.length === 0 ? <div className="glass panel"><Empty icon="activity" title="No updates yet">Post the first update to keep your client in the loop.</Empty></div> : updates.map((u) => (
          <article key={u.id} className="glass feed-item">
            <div className="row" style={{ marginBottom: 6 }}>
              <Badge tone="blue" plain>{UPDATE_KINDS[u.kind]}</Badge>
              {u.visibility === "internal" && <Badge tone="violet"><Icon name="shield" /> Internal only</Badge>}
              {u.requests_feedback && <Badge tone="amber" plain>Feedback requested</Badge>}
              <span className="tiny faint" style={{ marginLeft: "auto" }}>{fmtDateTime(u.created_at)} · {u.author_name}</span>
              <ActionButton action={deleteUpdateAction.bind(null, u.id)} className="btn btn-sm btn-ghost icon-btn" confirm="Delete this update?"><Icon name="trash" /><span className="sr-only">Delete</span></ActionButton>
            </div>
            <h2 style={{ fontSize: "1.05rem" }}>{u.title}</h2>
            {u.milestone_title && <span className="tiny faint">Milestone: {u.milestone_title}</span>}
            {u.body && <p className="muted pre" style={{ marginTop: 6 }}>{u.body}</p>}
            {u.attachments.length > 0 && <div className="row" style={{ marginTop: 8 }}>{u.attachments.map((a) => <a key={a.id} className="btn btn-sm" href={`/api/documents/${a.id}`} target="_blank" rel="noopener"><Icon name="file" /> {a.name}</a>)}</div>}
            {u.visibility === "client" && <><hr /><CommentList comments={u.comments} /><CommentForm projectId={projectId} targetType="update" targetId={u.id} placeholder="Reply…" /></>}
          </article>
        ))}
      </div>
      <Panel title="Post an update"><PostUpdateForm projectId={projectId} milestones={ms.map((m) => ({ id: m.id, title: m.title }))} /></Panel>
    </div>
  );
}
