import { CommentForm } from "./comments";
import { Empty } from "../ui";
import { fmtDateTime } from "@/lib/format";
import type { CommentRow } from "@/server/content";
import { ScrollToEnd } from "./scroll-to-end";

export function Chat({ projectId, messages, meId }: { projectId: string; messages: CommentRow[]; meId: string }) {
  return (
    <div className="glass panel">
      {messages.length === 0 ? <Empty icon="chat" title="No messages yet">Ask a question or share an idea — the team will reply here.</Empty> : (
        <div className="chat" aria-live="polite" id="chat-log">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.author_id === meId ? "mine" : ""}`}>
              <div className="who">{m.author_id === meId ? "You" : m.author_name ?? "Former user"}{m.author_role === "admin" && m.author_id !== meId ? " · Infinity Web & Apps" : ""} · {fmtDateTime(m.created_at)}</div>
              <div className="pre small">{m.body}</div>
            </div>
          ))}
          <ScrollToEnd />
        </div>
      )}
      <hr />
      <CommentForm projectId={projectId} targetType="thread" placeholder="Write a message…" label="Message" />
    </div>
  );
}
