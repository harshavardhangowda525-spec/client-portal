import { ActionForm, Submit } from "../forms";
import { addCommentAction } from "@/app/actions/shared";
import { fmtDateTime } from "@/lib/format";
import { initials } from "../ui";
import type { CommentRow } from "@/server/content";

export function CommentList({ comments }: { comments: CommentRow[] }) {
  if (!comments.length) return null;
  return (
    <div>
      {comments.map((c) => (
        <div className="comment" key={c.id}>
          <span className="avatar" aria-hidden="true" style={c.author_role === "admin" ? undefined : { background: "rgba(167,139,250,.18)", color: "#c4b5fd" }}>{initials(c.author_name ?? "?")}</span>
          <div className="bubble">
            <div className="tiny faint">{c.author_name ?? "Former user"}{c.author_role === "admin" ? " · Infinity Web & Apps" : ""} · {fmtDateTime(c.created_at)}</div>
            <p className="small pre" style={{ marginTop: 2 }}>{c.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CommentForm({ projectId, targetType, targetId, placeholder = "Write a comment…", label = "Comment" }: {
  projectId: string; targetType: string; targetId?: string; placeholder?: string; label?: string;
}) {
  const id = `c-${targetType}-${targetId ?? "thread"}`;
  return (
    <ActionForm action={addCommentAction.bind(null, projectId)} resetOnSuccess className="stack-sm" toast>
      <input type="hidden" name="target_type" value={targetType} />
      {targetId && <input type="hidden" name="target_id" value={targetId} />}
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea id={id} name="body" className="textarea" style={{ minHeight: 64 }} placeholder={placeholder} required maxLength={10000} />
      <div className="row" style={{ justifyContent: "flex-end" }}><Submit className="btn btn-sm btn-primary" pendingText="Sending…">Send</Submit></div>
    </ActionForm>
  );
}
