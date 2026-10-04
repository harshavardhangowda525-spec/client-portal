import { ActionForm, Submit } from "../forms";
import { Badge, initials } from "../ui";
import { proposalCommentAction } from "@/app/actions/proposals";
import { fmtDateTime } from "@/lib/format";

type Comment = { id: string; kind: string; body: string; created_at: Date; author_name: string | null; author_role: string | null };
const KIND: Record<string, string> = { question: "Question", change_request: "Change request", rejection: "Declined", comment: "" };

export function ProposalComments({ proposalId, comments, meRole }: { proposalId: string; comments: Comment[]; meRole: "admin" | "client" }) {
  return (
    <div className="stack">
      {comments.length === 0 ? <p className="small muted">No messages yet.</p> : comments.map((c) => (
        <div className="comment" key={c.id} style={{ padding: 0 }}>
          <span className="avatar" aria-hidden="true">{initials(c.author_name ?? "?")}</span>
          <div className="bubble">
            <div className="tiny faint row" style={{ gap: 6 }}>{c.author_name ?? "Former user"}{c.author_role === "admin" ? " · Infinity Web & Apps" : ""} · {fmtDateTime(c.created_at)}
              {KIND[c.kind] && <Badge plain tone={c.kind === "change_request" ? "amber" : c.kind === "rejection" ? "red" : "blue"}>{KIND[c.kind]}</Badge>}</div>
            <p className="small pre" style={{ marginTop: 2 }}>{c.body}</p>
          </div>
        </div>
      ))}
      <ActionForm action={proposalCommentAction.bind(null, proposalId)} resetOnSuccess className="stack-sm" toast>
        {meRole === "client" && (
          <div className="seg" role="radiogroup" aria-label="Message type">
            <label className="row" style={{ gap: 4, padding: "4px 10px" }}><input type="radio" name="kind" value="question" defaultChecked /> Question</label>
            <label className="row" style={{ gap: 4, padding: "4px 10px" }}><input type="radio" name="kind" value="comment" /> Comment</label>
          </div>
        )}
        <label htmlFor={`pc-${proposalId}`} className="sr-only">Message</label>
        <textarea id={`pc-${proposalId}`} name="body" className="textarea" style={{ minHeight: 64 }} required maxLength={10000}
          placeholder={meRole === "client" ? "Ask a question about this proposal…" : "Reply to the client…"} />
        <div className="row" style={{ justifyContent: "flex-end" }}><Submit className="btn btn-sm btn-primary" pendingText="Sending…">Send</Submit></div>
      </ActionForm>
    </div>
  );
}
