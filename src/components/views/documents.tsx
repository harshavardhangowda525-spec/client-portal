import { Badge, Empty, Panel } from "../ui";
import { Icon } from "../icons";
import { DOC_CATEGORIES, fmtBytes, fmtDate } from "@/lib/format";
import type { ReactNode } from "react";

type Doc = { id: string; category: string; name: string; mime_type: string; size_bytes: number; visibility: string; created_at: Date; uploader: string | null; uploader_role: string | null };
type Row = { key: string; name: string; meta: string; href: string; badge?: ReactNode };

export function DocumentLibrary({ docs, quotes, invoices, payments, admin, renderActions }: {
  docs: Doc[];
  quotes: { number: string; versions: { id: string; version_no: number; status: string; created_at: Date }[] }[];
  invoices: { id: string; number: string; status: string; issue_date: string | null }[];
  payments: { id: string; receipt_number: string | null; paid_on: string | null; status: string }[];
  admin?: boolean; renderActions?: (d: Doc) => ReactNode;
}) {
  const groups: Record<string, Row[]> = {};
  const push = (cat: string, r: Row) => (groups[cat] ??= []).push(r);
  for (const q of quotes) for (const v of q.versions.filter((v) => admin || v.status !== "draft")) {
    push("quotation", { key: v.id, name: `Quotation ${q.number} — version ${v.version_no}`, meta: `${v.status === "accepted" ? "Accepted · " : ""}${fmtDate(v.created_at)}`, href: `/api/quotations/${v.id}/pdf` });
  }
  for (const i of invoices.filter((i) => i.status !== "draft" || admin)) push("invoice", { key: i.id, name: `Invoice ${i.number}`, meta: fmtDate(i.issue_date), href: `/api/invoices/${i.id}/pdf` });
  for (const p of payments.filter((p) => p.receipt_number && p.status === "confirmed")) push("invoice", { key: p.id, name: `Receipt ${p.receipt_number}`, meta: fmtDate(p.paid_on), href: `/api/payments/${p.id}/receipt` });
  const uploaded: Record<string, Doc[]> = {};
  for (const d of docs) (uploaded[d.category] ??= []).push(d);
  const cats = Object.keys(DOC_CATEGORIES).filter((c) => groups[c]?.length || uploaded[c]?.length);
  if (cats.length === 0) return <div className="glass panel"><Empty icon="folder" title="No documents yet">Quotations, invoices and project files will appear here.</Empty></div>;
  return (
    <div className="stack">
      {cats.map((c) => (
        <Panel key={c} title={DOC_CATEGORIES[c]}>
          <div className="list">
            {(groups[c] ?? []).map((r) => (
              <div key={r.key} className="list-item">
                <Icon name="file" style={{ color: "var(--blue-2)" }} />
                <div className="grow"><div className="small truncate" style={{ fontWeight: 500 }}>{r.name}</div><div className="tiny faint">{r.meta} · PDF</div></div>
                <a className="btn btn-sm" href={r.href} target="_blank" rel="noopener"><Icon name="download" /> Download</a>
              </div>
            ))}
            {(uploaded[c] ?? []).map((d) => (
              <div key={d.id} className="list-item">
                <Icon name={d.mime_type.startsWith("image/") ? "eye" : "file"} style={{ color: "var(--blue-2)" }} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small truncate" style={{ fontWeight: 500 }}>{d.name}</div>
                  <div className="tiny faint">{fmtBytes(d.size_bytes)} · {fmtDate(d.created_at)}{d.uploader ? ` · ${d.uploader_role === "client" ? "Uploaded by" : "Shared by"} ${d.uploader}` : ""}</div>
                </div>
                {admin && d.visibility === "internal" && <Badge tone="violet" plain>Internal</Badge>}
                <a className="btn btn-sm" href={`/api/documents/${d.id}?download=1`}><Icon name="download" /> Download</a>
                {renderActions?.(d)}
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
