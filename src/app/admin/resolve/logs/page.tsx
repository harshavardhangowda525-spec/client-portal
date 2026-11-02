import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listAiLogs } from "@/server/resolve";
import { aiConfigured, aiModel, transcribeModel } from "@/server/ai";
import { Badge, Empty, Panel } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "AI activity" };
export const dynamic = "force-dynamic";

export default async function AiLogs() {
  const actor = await requireAdmin();
  const logs = await listAiLogs(actor);
  return (
    <div className="stack">
      <div className={`notice ${aiConfigured() ? "info" : "warn"}`}>
        {aiConfigured() ? <>Groq is configured. Chat model <code>{aiModel()}</code>, transcription <code>{transcribeModel()}</code>.</>
          : <>GROQ_API_KEY is not set. Requests still reach you, but without AI clarification, summaries or transcription.</>}
      </div>
      <Panel title="AI activity log" sub="Every AI call: what it was for, the result, speed and what the AI returned. “guarded” means a reply was blocked for promising price, time or free work.">
        {logs.length === 0 ? <Empty icon="sparkle" title="No AI activity yet" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Operation</th><th>Ticket</th><th>Result</th><th className="num">ms</th><th className="num">Tokens</th><th>Output / error</th></tr></thead>
            <tbody>{logs.map((l) => (
              <tr key={l.id}>
                <td className="small">{fmtDateTime(l.created_at)}</td>
                <td className="small">{l.operation}</td>
                <td className="small">{l.ticket_id ? <Link href={`/admin/resolve/${l.ticket_id}`}>{l.ticket_number}</Link> : "—"}</td>
                <td><Badge tone={l.status === "ok" ? "green" : l.status === "guarded" ? "violet" : l.status === "failed" ? "red" : "amber"}>{l.status.replace("_", " ")}</Badge></td>
                <td className="num small">{l.latency_ms ?? "—"}</td>
                <td className="num small">{l.input_tokens != null ? `${l.input_tokens}/${l.output_tokens}` : "—"}</td>
                <td className="small"><details><summary style={{ cursor: "pointer" }}>{(l.error ?? l.output ?? "").slice(0, 70) || "—"}</summary>
                  <pre className="tiny" style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>{l.error ? `${l.error}\n\n` : ""}{l.output}</pre></details></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}
