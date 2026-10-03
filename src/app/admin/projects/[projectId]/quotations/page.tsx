import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listProjectQuotations, listTemplates } from "@/server/quotations";
import { Empty, Money, Panel, QuoteBadge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { NewQuotationForm } from "./new-quotation";

export const dynamic = "force-dynamic";

export default async function QuotationsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const [quotes, templates] = await Promise.all([listProjectQuotations(actor, projectId), listTemplates(actor)]);
  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <Panel title="Quotations">
        {quotes.length === 0 ? <Empty icon="file" title="No quotations yet">Create one from a template on the right.</Empty> : (
          <div className="list">
            {quotes.map((q) => {
              const latest = q.versions[0];
              return (
                <Link key={q.id} href={`/admin/projects/${projectId}/quotations/${q.id}`} className="list-item">
                  <div className="grow"><div style={{ fontWeight: 500 }}>{q.number} · {q.title}</div>
                    <div className="tiny faint">{q.versions.length} version(s) · latest v{latest.version_no} · {fmtDate(latest.sent_at ?? latest.created_at)}{latest.view_count ? ` · viewed ${latest.view_count}×` : ""}</div></div>
                  <Money value={latest.total} currency={latest.currency} />
                  <QuoteBadge status={latest.status} />
                </Link>
              );
            })}
          </div>
        )}
      </Panel>
      <Panel title="New quotation"><NewQuotationForm projectId={projectId} templates={templates.map((t) => ({ id: t.id, name: t.name }))} /></Panel>
    </div>
  );
}
