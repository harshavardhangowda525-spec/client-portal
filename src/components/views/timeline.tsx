import type { ReactNode } from "react";
import { Icon } from "../icons";
import { MilestoneBadge } from "../ui";
import { fmtDate, fmtDateTime, MILESTONE_STATUS } from "@/lib/format";
import { isOverdue } from "@/lib/progress";

type M = {
  id: string; title: string; description: string | null; status: string; start_date: string | null; due_date: string | null;
  completed_at: Date | null; blocked_reason: string | null; weight: number;
  history: { id: string; changes: Record<string, [unknown, unknown]>; note: string | null; created_at: Date; actor_name: string | null }[];
  attachments: { id: string; name: string; mime_type: string }[];
};

function describe(changes: Record<string, [unknown, unknown]>) {
  return Object.entries(changes).map(([k, [, to]]) => {
    if (k === "status") return `Status → ${MILESTONE_STATUS[String(to)] ?? to}`;
    if (k === "created") return "Milestone added";
    if (k === "due_date") return `Due date → ${fmtDate(to as string)}`;
    if (k === "start_date") return `Start date → ${fmtDate(to as string)}`;
    if (k === "weight") return `Weight → ${to}`;
    return `${k.replace(/_/g, " ")} updated`;
  }).join(" · ");
}

export function Timeline({ milestones, renderActions, showWeights }: { milestones: M[]; renderActions?: (m: M) => ReactNode; showWeights?: boolean }) {
  const doneIdx = milestones.reduce((acc, m, i) => (m.status === "completed" ? i : acc), -1);
  const fill = milestones.length > 1 ? Math.max(0, (doneIdx / (milestones.length - 1)) * 100) : 0;
  return (
    <ol className="timeline">
      <span className="fill" style={{ ["--fill" as string]: `calc(${fill}% - 16px)` }} aria-hidden="true" />
      {milestones.map((m, i) => {
        const overdue = isOverdue(m);
        return (
          <li key={m.id} className="t-item" data-status={m.status} style={{ ["--i" as string]: i }}>
            <span className="t-dot" aria-hidden="true">
              {m.status === "completed" && <Icon name="check" strokeWidth={3} />}
              {m.status === "blocked" && <Icon name="x" strokeWidth={3} />}
              {m.status === "awaiting_client" && <Icon name="clock" strokeWidth={2.5} />}
            </span>
            <div className="t-card">
              <div className="t-head">
                <div style={{ minWidth: 0 }}>
                  <div className="t-title">{i + 1}. {m.title}</div>
                  <div className="t-meta">
                    {m.start_date && <span>Start {fmtDate(m.start_date)}</span>}
                    {m.due_date && <span style={overdue ? { color: "var(--red)" } : undefined}>Due {fmtDate(m.due_date)}{overdue ? " · overdue" : ""}</span>}
                    {m.completed_at && <span>Completed {fmtDate(m.completed_at)}</span>}
                    {showWeights && <span>Weight {Number(m.weight)}</span>}
                  </div>
                </div>
                <div className="row"><MilestoneBadge status={m.status} />{renderActions?.(m)}</div>
              </div>
              {m.description && <p className="small muted" style={{ marginTop: 8 }}>{m.description}</p>}
              {m.status === "blocked" && m.blocked_reason && <p className="small" style={{ marginTop: 8, color: "#fca5a5" }}>Blocked: {m.blocked_reason}</p>}
              {m.attachments.length > 0 && (
                <div className="row" style={{ marginTop: 10 }}>
                  {m.attachments.map((a) => (
                    <a key={a.id} className="btn btn-sm" href={`/api/documents/${a.id}`} target="_blank" rel="noopener"><Icon name={a.mime_type.startsWith("image/") ? "eye" : "file"} /> {a.name}</a>
                  ))}
                </div>
              )}
              {m.history.length > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary className="tiny faint">Update history ({m.history.length})</summary>
                  <ul className="stack-sm" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                    {m.history.map((h) => (
                      <li key={h.id} className="small">
                        <span className="faint tiny">{fmtDateTime(h.created_at)}{h.actor_name ? ` · ${h.actor_name}` : ""}</span><br />
                        <span className="muted">{describe(h.changes)}</span>
                        {h.note && <span className="pre" style={{ display: "block" }}>{h.note}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
