import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { getCatalog, getBusiness } from "@/server/pricing";
import { PageHead, Panel } from "@/components/ui";
import { BusinessForm, TaxForm, DefaultsForm, LogoForm, PackageEditor, CatalogTable, TemplateEditor } from "./editors";

export const metadata = { title: "Pricing configuration" };
export const dynamic = "force-dynamic";

const SECTIONS = [["business", "Business"], ["tax", "Tax"], ["defaults", "Proposal defaults"], ["packages", "Packages"], ["services", "Optional services"],
  ["external", "External costs"], ["maintenance", "Maintenance plans"], ["discounts", "Discounts"], ["milestones", "Payment milestones"]];

export default async function PricingConfig() {
  const actor = await requireAdmin();
  const [c, biz] = await Promise.all([getCatalog(actor), getBusiness()]);
  return (
    <>
      <PageHead eyebrow={<Link href="/admin/settings">Settings</Link>} title="Pricing configuration"
        sub="Central prices and terms used by the proposal builder. Changes apply to new proposals — sent proposals keep their own copy." />
      <nav className="tabs" aria-label="Pricing sections">{SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}</nav>
      <div className="stack" style={{ gap: 18 }}>
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <Panel title="Business details" id="business"><BusinessForm biz={biz} /></Panel>
          <div className="stack">
            <Panel title="Logo" sub="PNG or JPEG, up to 1 MB. Shown on proposals and PDFs."><LogoForm hasLogo={biz.hasLogo} /></Panel>
            <Panel title="Tax / GST" id="tax"><TaxForm tax={c.tax} /></Panel>
          </div>
        </div>
        <Panel title="Proposal defaults" id="defaults"><DefaultsForm d={c.defaults} /></Panel>

        <Panel title="Packages" id="packages" sub="Breakdown items must add up exactly to the package price. They are shown as inclusions and never charged twice.">
          <div className="stack">
            {c.packages.map((p) => <PackageEditor key={p.id} pkg={p} />)}
            <details><summary className="btn btn-sm">+ New package</summary><div style={{ marginTop: 12 }}><PackageEditor pkg={null} /></div></details>
          </div>
        </Panel>

        <Panel title="Optional services" id="services" sub="Leave the default price empty so you always enter the actual quoted price per proposal.">
          <CatalogTable kind="service" rows={c.services} />
        </Panel>
        <Panel title="Domain, hosting & third-party costs" id="external" sub="Leave prices empty until you have a real quote — they show as “To be confirmed”.">
          <CatalogTable kind="external" rows={c.externals} />
        </Panel>
        <Panel title="Maintenance plans" id="maintenance" sub="Suggested defaults — not guaranteed entitlements until agreed in a proposal.">
          <CatalogTable kind="plan" rows={c.plans} />
        </Panel>
        <Panel title="Discount rules" id="discounts"><CatalogTable kind="discount" rows={c.discounts} /></Panel>
        <Panel title="Payment milestone templates" id="milestones" sub="Templates are offered in the wizard; nothing is applied automatically.">
          <div className="stack">
            {c.templates.map((t) => <TemplateEditor key={t.id} t={t} />)}
            <details><summary className="btn btn-sm">+ New template</summary><div style={{ marginTop: 12 }}><TemplateEditor t={null} /></div></details>
          </div>
        </Panel>
      </div>
    </>
  );
}
