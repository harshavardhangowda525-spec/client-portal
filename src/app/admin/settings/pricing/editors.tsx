"use client";

import { useState } from "react";
import { ActionButton, ActionForm, Modal, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui";
import { saveSettingAction, saveLogoAction, savePackageAction, saveCatalogItemAction, deleteCatalogItemAction } from "@/app/actions/proposals";
import { formatMoney, toPaise } from "@/lib/money";
import type { Business, PackageRow, ProposalDefaults, TemplateRow } from "@/server/pricing";
import type { TaxConfig } from "@/lib/proposal-calc";

const F = ({ label, children, full, hint }: { label: string; children: React.ReactNode; full?: boolean; hint?: string }) => (
  <label className={`field${full ? " full" : ""}`}><span className="label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>
);

export function BusinessForm({ biz }: { biz: Business }) {
  return (
    <ActionForm action={saveSettingAction.bind(null, "business")} className="form-grid" toast>
      <F label="Business name"><input name="name" className="input" defaultValue={biz.name} required /></F>
      <F label="Tagline"><input name="tagline" className="input" defaultValue={biz.tagline} /></F>
      <F label="Email"><input name="email" type="email" className="input" defaultValue={biz.email} /></F>
      <F label="Phone"><input name="phone" className="input" defaultValue={biz.phone} /></F>
      <F label="Website"><input name="website" className="input" defaultValue={biz.website} /></F>
      <F label="GSTIN / tax ID"><input name="tax_id" className="input" defaultValue={biz.tax_id} /></F>
      <F label="Address" full><textarea name="address" className="textarea" style={{ minHeight: 60 }} defaultValue={biz.address} /></F>
      <div className="form-actions full"><Submit>Save business details</Submit></div>
    </ActionForm>
  );
}

export function LogoForm({ hasLogo }: { hasLogo: boolean }) {
  return (
    <div className="stack">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {hasLogo && <img src={`/api/brand/logo?t=${Date.now()}`} alt="Current logo" style={{ maxHeight: 56, width: "auto", alignSelf: "flex-start", background: "#fff", borderRadius: 8, padding: 4 }} />}
      <ActionForm action={saveLogoAction} className="row" toast resetOnSuccess>
        <input name="logo" type="file" accept="image/png,image/jpeg" className="input" style={{ flex: 1 }} aria-label="Logo file" required />
        <Submit className="btn btn-sm">Upload</Submit>
      </ActionForm>
      {hasLogo && <ActionButton action={saveLogoAction} fields={{ remove: "1" }} className="btn btn-sm btn-ghost" confirm="Remove the logo?">Remove logo</ActionButton>}
    </div>
  );
}

export function TaxForm({ tax }: { tax: TaxConfig }) {
  return (
    <ActionForm action={saveSettingAction.bind(null, "tax")} className="form-grid" toast>
      <label className="check full"><input type="checkbox" name="enabled" defaultChecked={tax.enabled} /> Charge tax on proposals</label>
      <F label="Tax label"><input name="label" className="input" defaultValue={tax.label} required /></F>
      <F label="Rate (%)"><input name="rate" type="number" min="0" max="100" step="0.01" className="input" defaultValue={tax.rate} required /></F>
      <label className="check full"><input type="checkbox" name="apply_to_external" defaultChecked={tax.apply_to_external} /> Also apply tax to external fees we bill (domain, hosting…)</label>
      <p className="tiny faint full">Confirm GST treatment with your accountant. Tax is applied after discounts.</p>
      <div className="form-actions full"><Submit>Save tax settings</Submit></div>
    </ActionForm>
  );
}

export function DefaultsForm({ d }: { d: ProposalDefaults }) {
  return (
    <ActionForm action={saveSettingAction.bind(null, "proposal_defaults")} className="form-grid" toast>
      <F label="Proposal validity (days)"><input name="validity_days" type="number" min="1" max="365" className="input" defaultValue={d.validity_days} /></F>
      <F label="Revision rounds"><input name="revisions" type="number" min="0" className="input" defaultValue={d.revisions} /></F>
      <F label="Warranty period (days)"><input name="warranty_days" type="number" min="0" className="input" defaultValue={d.warranty_days} /></F>
      <label className="check"><input type="checkbox" name="discount_applies_to_external" defaultChecked={d.discount_applies_to_external} /> Discounts may also reduce one-time external fees</label>
      <F label="Warranty terms" full><textarea name="warranty_terms" className="textarea" defaultValue={d.warranty_terms} /></F>
      <F label="Default terms and conditions" full><textarea name="terms" className="textarea" style={{ minHeight: 160 }} defaultValue={d.terms} /></F>
      <div className="form-actions full"><Submit>Save defaults</Submit></div>
    </ActionForm>
  );
}

export function PackageEditor({ pkg }: { pkg: PackageRow | null }) {
  const [p, setP] = useState(() => ({
    kind: pkg?.kind ?? "website", name: pkg?.name ?? "", description: pkg?.description ?? "", price: pkg ? Number(pkg.price) : 0, is_active: pkg?.is_active ?? true,
    scope_limits: (pkg?.scope_limits ?? {}) as Record<string, number | string>,
    items: pkg?.items.map((i) => ({ name: i.name, description: i.description, amount: Number(i.amount) })) ?? [{ name: "", description: null as string | null, amount: 0 }],
  }));
  const sum = p.items.reduce((s, i) => s + toPaise(i.amount || 0), 0);
  const ok = sum === toPaise(p.price || 0);
  const lim = (k: string, v: string) => setP({ ...p, scope_limits: Object.fromEntries(Object.entries({ ...p.scope_limits, [k]: k === "backend" ? v : v === "" ? "" : Number(v) }).filter(([, x]) => x !== "")) });
  return (
    <div className="glass" style={{ padding: 14, background: "rgba(0,0,0,.15)" }}>
      <ActionForm action={savePackageAction.bind(null, pkg?.id ?? null)} className="stack" toast>
        <input type="hidden" name="payload" value={JSON.stringify(p)} />
        <div className="form-grid" style={{ gridTemplateColumns: "140px minmax(0,2fr) 160px" }}>
          <F label="Type"><select className="select" value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as "website" | "app" })}><option value="website">Website</option><option value="app">Mobile app</option></select></F>
          <F label="Package name"><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} required /></F>
          <F label="Price (₹)"><input type="number" min="0" step="0.01" className="input" value={p.price} onChange={(e) => setP({ ...p, price: Number(e.target.value) })} /></F>
        </div>
        <F label="Description"><input className="input" value={p.description ?? ""} onChange={(e) => setP({ ...p, description: e.target.value })} /></F>
        <div className="row">
          <span className="small muted">Scope limits (for warnings):</span>
          {(p.kind === "website" ? [["pages", "Pages"]] : [["screens", "Screens"], ["integrations", "Integrations"], ["roles", "Roles"]]).map(([k, l]) => (
            <label key={k} className="row small" style={{ gap: 4 }}>{l}<input type="number" min="0" className="input" style={{ width: 80 }} value={(p.scope_limits[k] as number) ?? ""} onChange={(e) => lim(k, e.target.value)} /></label>
          ))}
          {p.kind === "app" && <label className="row small" style={{ gap: 4 }}>Backend<select className="select" style={{ width: 130 }} value={(p.scope_limits.backend as string) ?? ""} onChange={(e) => lim("backend", e.target.value)}>
            <option value="">Any</option><option value="simple">Simple</option><option value="moderate">Moderate</option></select></label>}
        </div>
        <div className="stack-sm">
          <span className="small muted">Breakdown</span>
          {p.items.map((it, i) => (
            <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
              <input className="input" aria-label="Item name" value={it.name} onChange={(e) => setP({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input type="number" min="0" step="0.01" className="input" aria-label="Amount" style={{ width: 130 }} value={it.amount} onChange={(e) => setP({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)) })} />
              <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove item" onClick={() => setP({ ...p, items: p.items.filter((_, j) => j !== i) })}><Icon name="trash" /></button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setP({ ...p, items: [...p.items, { name: "", description: null, amount: 0 }] })}><Icon name="plus" /> Add item</button>
        </div>
        <div className="row-between">
          <span className="small" style={{ color: ok ? "#6ee7b7" : "var(--amber)" }}>Breakdown total {formatMoney(sum / 100)} {ok ? "= package price ✓" : `≠ package price ${formatMoney(p.price || 0)}`}</span>
          <div className="row">
            <label className="check"><input type="checkbox" checked={p.is_active} onChange={(e) => setP({ ...p, is_active: e.target.checked })} /> Active</label>
            <Submit className="btn btn-sm btn-primary" disabled={!ok}>Save package</Submit>
          </div>
        </div>
      </ActionForm>
      {pkg && <div style={{ marginTop: 8 }}><ActionButton action={deleteCatalogItemAction.bind(null, "package", pkg.id)} className="btn btn-sm btn-ghost" confirm={`Delete package "${pkg.name}"? Existing proposals keep their copy.`}>Delete package</ActionButton></div>}
    </div>
  );
}

// ---- generic catalog tables ----
type Kind = "service" | "external" | "plan" | "discount";
type FieldDef = { name: string; label: string; type?: "text" | "number" | "select" | "check" | "textarea"; options?: [string, string][]; hint?: string };
const FIELDS: Record<Kind, FieldDef[]> = {
  service: [
    { name: "name", label: "Service" }, { name: "category", label: "For", type: "select", options: [["website", "Website"], ["app", "App"], ["both", "Both"]] },
    { name: "unit", label: "Priced", type: "select", options: [["fixed", "Fixed"], ["per_page", "Per page"], ["per_screen", "Per screen"], ["per_item", "Per item"]] },
    { name: "min_price", label: "Min (₹)", type: "number" }, { name: "max_price", label: "Max (₹)", type: "number" },
    { name: "open_ended", label: "Open-ended (shows “+”)", type: "check" }, { name: "default_price", label: "Default price (₹)", type: "number", hint: "Optional. Leave empty to require a quoted price." },
    { name: "description", label: "Description", type: "textarea" }, { name: "is_active", label: "Active", type: "check" },
  ],
  external: [
    { name: "name", label: "Service" },
    { name: "category", label: "Category", type: "select", options: [["domain", "Domain"], ["hosting", "Hosting"], ["cloud", "Cloud & database"], ["email", "Email"], ["ssl", "SSL"], ["app_store", "App store"], ["messaging", "SMS / WhatsApp"], ["api", "Third-party API"], ["payment_fees", "Payment fees"], ["other", "Other"]] },
    { name: "billing", label: "Billing", type: "select", options: [["recurring", "Recurring"], ["one_time", "One-time"]] },
    { name: "period", label: "Period", type: "select", options: [["annual", "Annual"], ["monthly", "Monthly"]] },
    { name: "provider_cost", label: "Provider cost (₹)", type: "number", hint: "Empty = to be confirmed" }, { name: "selling_price", label: "Client price (₹)", type: "number", hint: "Empty = to be confirmed" },
    { name: "notes", label: "Notes", type: "textarea" }, { name: "is_active", label: "Active", type: "check" },
  ],
  plan: [
    { name: "kind", label: "For", type: "select", options: [["website", "Website"], ["app", "App"]] }, { name: "name", label: "Plan name" },
    { name: "monthly_price", label: "Monthly (₹)", type: "number" }, { name: "annual_price", label: "Annual (₹)", type: "number", hint: "Empty = 12 × monthly" },
    { name: "included_hours", label: "Included hours / tasks" }, { name: "bug_fix_coverage", label: "Bug-fix coverage" }, { name: "update_frequency", label: "Update frequency" },
    { name: "backup_monitoring", label: "Backup & monitoring" }, { name: "support_channel", label: "Support channel" }, { name: "response_time", label: "Response time" },
    { name: "exclusions", label: "Exclusions", type: "textarea" }, { name: "is_active", label: "Active", type: "check" },
  ],
  discount: [
    { name: "name", label: "Name" }, { name: "type", label: "Type", type: "select", options: [["percent", "Percentage"], ["amount", "Fixed amount"]] },
    { name: "value", label: "Value", type: "number" }, { name: "max_amount", label: "Maximum discount (₹)", type: "number", hint: "Optional cap" }, { name: "is_active", label: "Active", type: "check" },
  ],
};
const COLS: Record<Kind, [string, (r: Record<string, unknown>) => React.ReactNode][]> = {
  service: [["Service", (r) => r.name as string], ["For", (r) => r.category as string],
    ["Range", (r) => (r.min_price == null ? "Custom" : `${formatMoney(Number(r.min_price))}–${formatMoney(Number(r.max_price ?? r.min_price))}${r.open_ended ? "+" : ""}`)]],
  external: [["Service", (r) => r.name as string], ["Billing", (r) => (r.billing === "one_time" ? "One-time" : `Recurring · ${r.period}`)],
    ["Client price", (r) => (r.selling_price == null ? <Badge tone="amber" plain>To be confirmed</Badge> : formatMoney(Number(r.selling_price)))]],
  plan: [["Plan", (r) => `${r.kind === "app" ? "App" : "Website"} · ${r.name}`], ["Monthly", (r) => formatMoney(Number(r.monthly_price))], ["Response", (r) => r.response_time as string]],
  discount: [["Name", (r) => r.name as string], ["Value", (r) => (r.type === "percent" ? `${Number(r.value)}%` : formatMoney(Number(r.value)))], ["Cap", (r) => (r.max_amount == null ? "—" : formatMoney(Number(r.max_amount)))]],
};

function ItemForm({ kind, row, onDone }: { kind: Kind; row: Record<string, unknown> | null; onDone: () => void }) {
  return (
    <ActionForm action={saveCatalogItemAction.bind(null, kind, (row?.id as string) ?? null)} className="form-grid" toast onDone={onDone}>
      {FIELDS[kind].map((f) => f.type === "check" ? (
        <label key={f.name} className="check full"><input type="checkbox" name={f.name} defaultChecked={row ? !!row[f.name] : f.name === "is_active"} /> {f.label}</label>
      ) : (
        <F key={f.name} label={f.label} full={f.type === "textarea"} hint={f.hint}>
          {f.type === "select" ? <select name={f.name} className="select" defaultValue={(row?.[f.name] as string) ?? f.options![0][0]}>{f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            : f.type === "textarea" ? <textarea name={f.name} className="textarea" defaultValue={(row?.[f.name] as string) ?? ""} />
            : <input name={f.name} type={f.type === "number" ? "number" : "text"} step="0.01" min={f.type === "number" ? 0 : undefined} className="input" defaultValue={row?.[f.name] == null ? "" : String(row[f.name])} required={f.name === "name" || f.name === "value" || f.name === "monthly_price"} />}
        </F>
      ))}
      <div className="form-actions full"><Submit>Save</Submit></div>
    </ActionForm>
  );
}

export function CatalogTable({ kind, rows }: { kind: Kind; rows: unknown[] }) {
  const data = rows as Record<string, unknown>[];
  return (
    <div className="stack">
      <div className="table-wrap"><table className="table">
        <thead><tr>{COLS[kind].map(([h]) => <th key={h}>{h}</th>)}<th>Status</th><th /></tr></thead>
        <tbody>{data.map((r) => (
          <tr key={r.id as string} style={{ opacity: r.is_active ? 1 : 0.55 }}>
            {COLS[kind].map(([h, fn]) => <td key={h} className="small">{fn(r)}</td>)}
            <td>{r.is_active ? <Badge tone="green" plain>Active</Badge> : <Badge plain>Hidden</Badge>}</td>
            <td><div className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
              <Modal title={`Edit ${String(r.name)}`} trigger={<><Icon name="edit" /><span className="sr-only">Edit</span></>} triggerClass="btn btn-sm btn-ghost icon-btn">
                {(close) => <ItemForm kind={kind} row={r} onDone={close} />}
              </Modal>
              <ActionButton action={deleteCatalogItemAction.bind(null, kind, r.id as string)} className="btn btn-sm btn-ghost icon-btn" confirm={`Delete "${String(r.name)}"?`}><Icon name="trash" /><span className="sr-only">Delete</span></ActionButton>
            </div></td>
          </tr>
        ))}</tbody>
      </table></div>
      <Modal title="Add" trigger={<><Icon name="plus" /> Add</>} triggerClass="btn btn-sm">{(close) => <ItemForm kind={kind} row={null} onDone={close} />}</Modal>
    </div>
  );
}

export function TemplateEditor({ t }: { t: TemplateRow | null }) {
  const [name, setName] = useState(t?.name ?? "");
  const [items, setItems] = useState(t?.items.map((i) => ({ ...i, value: Number(i.value) })) ?? [{ label: "Initial advance", mode: "percent" as const, value: 50, due: "On acceptance" }]);
  const pct = items.filter((i) => i.mode === "percent").reduce((s, i) => s + (i.value || 0), 0);
  const allPct = items.every((i) => i.mode === "percent");
  return (
    <div className="glass" style={{ padding: 12, background: "rgba(0,0,0,.15)" }}>
      <ActionForm action={saveCatalogItemAction.bind(null, "template", t?.id ?? null)} className="stack-sm" toast>
        <input type="hidden" name="payload" value={JSON.stringify({ name, items })} />
        <input className="input" aria-label="Template name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" required />
        {items.map((it, i) => (
          <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input" aria-label="Milestone" value={it.label} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <select className="select" aria-label="By" style={{ width: 110 }} value={it.mode} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, mode: e.target.value as "percent" | "amount" } : x)))}><option value="percent">%</option><option value="amount">₹</option></select>
            <input type="number" min="0" className="input" aria-label="Value" style={{ width: 100 }} value={it.value} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} />
            <input className="input" aria-label="When due" value={it.due ?? ""} placeholder="When due" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
            <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}><Icon name="trash" /></button>
          </div>
        ))}
        <div className="row-between">
          <button type="button" className="btn btn-sm" onClick={() => setItems([...items, { label: "", mode: "percent", value: 0, due: "" }])}><Icon name="plus" /> Add milestone</button>
          <div className="row">
            {allPct && <span className="small" style={{ color: Math.abs(pct - 100) < 1e-6 ? "#6ee7b7" : "var(--amber)" }}>{pct}%{Math.abs(pct - 100) < 1e-6 ? " ✓" : " (must be 100%)"}</span>}
            <Submit className="btn btn-sm btn-primary">Save template</Submit>
          </div>
        </div>
      </ActionForm>
      {t && <ActionButton action={deleteCatalogItemAction.bind(null, "template", t.id)} className="btn btn-sm btn-ghost" confirm={`Delete template "${t.name}"?`}>Delete template</ActionButton>}
    </div>
  );
}
