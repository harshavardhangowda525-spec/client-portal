import { formatMoney } from "@/lib/money";

/**
 * Small, dependency-free charts. Single-series charts use one hue (no legend; the title names it);
 * the two-series chart uses validated slots 1–2 with a legend. Each mark has a native tooltip,
 * values are text (never colour alone), and every chart has a table view.
 */
export const SERIES = ["#3987e5", "#d95926"] as const; // validated on the portal's dark surface (dataviz validator)

type Row = { label: string; value: number; hint?: string };

export function BarList({ title, rows, money, emptyText = "No data yet." }: { title: string; rows: Row[]; money?: boolean; emptyText?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fmt = (v: number) => (money ? formatMoney(v) : v.toLocaleString("en-IN"));
  return (
    <figure style={{ margin: 0 }} aria-label={title}>
      {rows.every((r) => !r.value) ? <p className="small muted" style={{ margin: 0 }}>{emptyText}</p> : (
        <div className="stack-sm">{rows.map((r) => (
          <div key={r.label} className="chart-row" title={`${r.label}: ${fmt(r.value)}${r.hint ? ` — ${r.hint}` : ""}`}>
            <span className="small chart-label">{r.label}</span>
            <span className="chart-track"><span className="chart-bar" style={{ width: `${(r.value / max) * 100}%`, background: SERIES[0] }} /></span>
            <span className="small mono chart-value">{fmt(r.value)}{r.hint ? <span className="tiny faint"> {r.hint}</span> : null}</span>
          </div>
        ))}</div>
      )}
      <TableView headers={["", title]} rows={rows.map((r) => [r.label, fmt(r.value)])} />
    </figure>
  );
}

export function Columns({ title, data, series, money }: { title: string; data: { label: string; values: number[] }[]; series: string[]; money?: boolean }) {
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const fmt = (v: number) => (money ? formatMoney(v) : v.toLocaleString("en-IN"));
  return (
    <figure style={{ margin: 0 }} aria-label={title}>
      {series.length > 1 && (
        <div className="row tiny" style={{ gap: 14, marginBottom: 8 }}>{series.map((s, i) => (
          <span key={s} className="row" style={{ gap: 6 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: SERIES[i] }} />{s}</span>
        ))}</div>
      )}
      {data.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No data in this period.</p> : (
        <div className="chart-cols" role="img" aria-label={`${title} by month`}>
          {data.map((d) => (
            <div key={d.label} className="chart-col">
              <div className="chart-col-bars">{d.values.map((v, i) => (
                <span key={i} className="chart-colbar" title={`${d.label} · ${series[i]}: ${fmt(v)}`} style={{ height: `${(v / max) * 100}%`, background: SERIES[i] }} />
              ))}</div>
              <span className="tiny faint">{d.label}</span>
            </div>
          ))}
        </div>
      )}
      <TableView headers={["Month", ...series]} rows={data.map((d) => [d.label, ...d.values.map(fmt)])} />
    </figure>
  );
}

function TableView({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (!rows.length) return null;
  return (
    <details style={{ marginTop: 8 }}><summary className="tiny faint" style={{ cursor: "pointer" }}>View as table</summary>
      <table className="table" style={{ marginTop: 6 }}><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num small" : "small"}>{c}</td>)}</tr>)}</tbody></table>
    </details>
  );
}

export const stageTone = (s: string) => (s === "won" ? "green" : s === "lost" || s === "disqualified" ? "" : s === "verification_pending" ? "amber" : s.startsWith("call") ? "violet" : "blue") as "green" | "" | "amber" | "violet" | "blue";
