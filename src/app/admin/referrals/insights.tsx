"use client";

import { useState, useTransition } from "react";
import { insightsAction } from "@/app/actions/referrals";
import type { AnalyticsFilter } from "@/server/referral-analytics";

export function Insights({ filter }: { filter: AnalyticsFilter }) {
  const [r, setR] = useState<{ summary: string; bottlenecks: string[]; suggestions: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="stack-sm">
      <div><button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
        setErr(null); const res = await insightsAction(filter);
        if (res?.ok) setR(res.data as never); else setErr(res?.error ?? "Failed");
      })}>{pending && <span className="spinner" aria-hidden="true" />} Summarise with AI</button></div>
      {err && <div className="notice warn small">{err}</div>}
      {r && <div className="stack-sm small"><p style={{ margin: 0 }}>{r.summary}</p>
        {r.bottlenecks.length > 0 && <div><strong>Bottlenecks</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{r.bottlenecks.map((b) => <li key={b}>{b}</li>)}</ul></div>}
        {r.suggestions.length > 0 && <div><strong>Suggestions</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{r.suggestions.map((b) => <li key={b}>{b}</li>)}</ul></div>}
        <span className="tiny faint">AI summary of the numbers above. The numbers come from the database.</span></div>}
    </div>
  );
}
