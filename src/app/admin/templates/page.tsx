import { requireAdmin } from "@/lib/session";
import { listTemplates } from "@/server/quotations";
import { PageHead, Panel } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { deleteTemplateAction } from "@/app/actions/admin";
import { formatMoney, computeTotals } from "@/lib/money";
import { fmtDate } from "@/lib/format";
import { TemplateEditor } from "./editor";

export const metadata = { title: "Quotation templates" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const actor = await requireAdmin();
  const templates = await listTemplates(actor);
  return (
    <>
      <PageHead title="Quotation templates" sub="Reusable starting points. Tip: open any quotation and use “Save as reusable template”." />
      <div className="stack">
        {templates.map((t) => {
          const total = computeTotals(t.content.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price })), "none", 0, t.content.tax_rate).total;
          return (
            <Panel key={t.id} title={t.name} sub={`${t.description ?? ""} · ${t.content.items.length} items · ${formatMoney(total)} · updated ${fmtDate(t.updated_at)}`}
              actions={templates.length > 1 ? <ActionButton action={deleteTemplateAction.bind(null, t.id)} className="btn btn-sm btn-ghost" confirm={`Delete template "${t.name}"?`}>Delete</ActionButton> : undefined}>
              <details><summary className="btn btn-sm">Edit template</summary>
                <div style={{ marginTop: 12 }}><TemplateEditor id={t.id} name={t.name} description={t.description} content={t.content} /></div>
              </details>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
