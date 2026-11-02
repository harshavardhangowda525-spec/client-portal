import type { ResolveMessage } from "@/server/resolve";
import { fmtDateTime } from "@/lib/format";

/** Conversation thread. Clients never receive internal messages (filtered server-side and by RLS). */
export function Conversation({ messages, admin, clientName }: { messages: ResolveMessage[]; admin?: boolean; clientName?: string }) {
  return (
    <div className="chat" aria-live="polite">
      {messages.map((m) => {
        const cls = m.visibility === "internal" ? "internal" : m.author_type;
        const who = m.author_type === "client" ? (admin ? (m.author_name ?? clientName ?? "Client") : "You")
          : m.author_type === "ai" ? "Infinity Resolve assistant" : m.author_type === "team" ? `${m.author_name ?? "Team"} · Infinity Web & Apps` : "";
        return (
          <div key={m.id} className={`chat-msg ${cls}`}>
            {m.author_type !== "system" && <div className="chat-meta">{who}{m.visibility === "internal" ? " · Internal note (never shown to the client)" : ""} · {fmtDateTime(m.created_at)}{m.kind === "transcript" ? " · voice transcript" : ""}</div>}
            {m.body}
          </div>
        );
      })}
    </div>
  );
}

export function Attachments({ files, admin }: { files: { id: string; name: string; mime_type: string; category: string; expires_at: Date | null }[]; admin?: boolean }) {
  if (!files.length) return null;
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
      {files.map((f) => f.mime_type.startsWith("image/") ? (
        <a key={f.id} href={`/api/documents/${f.id}`} target="_blank" rel="noopener" className="glass" style={{ display: "block", width: 220, overflow: "hidden", borderRadius: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/documents/${f.id}`} alt={f.name} style={{ width: "100%", display: "block" }} loading="lazy" />
        </a>
      ) : f.mime_type.startsWith("audio/") ? (
        <div key={f.id} className="stack-sm"><audio controls preload="none" src={`/api/documents/${f.id}?download`} aria-label={f.name} />
          {f.expires_at && <span className="tiny faint">Recording kept until {fmtDateTime(f.expires_at)}{admin ? "" : ""}</span>}</div>
      ) : (
        <a key={f.id} className="btn btn-sm" href={`/api/documents/${f.id}`} target="_blank" rel="noopener">{f.name}</a>
      ))}
    </div>
  );
}
