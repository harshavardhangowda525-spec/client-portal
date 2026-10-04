"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { saveProposalAction } from "@/app/actions/proposals";
import { computeProposal, type PackageSnapshot } from "@/lib/proposal-calc";
import { formatMoney } from "@/lib/money";
import { PROJECT_TYPE_LABELS } from "@/lib/format";
import type { PackageRow, ServiceRow, ExternalRow, PlanRow } from "@/server/pricing";
import type { TaxConfig } from "@/lib/proposal-calc";
import type { WizardState, Catalog, ClientOpt, Addon, Custom, External, Maint, Milestone } from "./wizard-state";

const STEPS = ["Client & project", "Website pricing", "App pricing", "External costs", "Maintenance", "Scope & timeline", "Payment & summary", "Review"];
const isWeb = (t: string) => ["website", "website_app", "custom_software"].includes(t);
const isApp = (t: string) => ["android_app", "ios_app", "cross_platform_app", "website_app", "custom_software"].includes(t);
const UNIT: Record<string, string> = { fixed: "", per_page: "per page", per_screen: "per screen", per_item: "per item" };
const num = (v: string) => (v === "" ? null : Number(v));
const lines = (a: string[]) => a.join("\n");
const unlines = (v: string) => v.split("\n");

function snapshot(p: PackageRow): PackageSnapshot {
  return { id: p.id, kind: p.kind, name: p.name, price: Number(p.price), scope_limits: p.scope_limits as PackageSnapshot["scope_limits"],
    items: p.items.map((i) => ({ name: i.name, description: i.description, amount: Number(i.amount) })) };
}

// ---------------------------------------------------------------------------
export function ProposalWizard({ catalog, clients, admins, initial, proposalId: initialId, number, initialStep = 0 }: {
  catalog: Catalog; clients: ClientOpt[]; admins: { id: string; name: string }[]; initial: WizardState; proposalId: string | null; number?: string; initialStep?: number;
}) {
  const [s, setS] = useState<WizardState>(initial);
  const [step, setStep] = useState(initialStep);
  const [proposalId, setProposalId] = useState(initialId);
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [saving, startSave] = useTransition();
  const router = useRouter();

  const set = <K extends keyof WizardState>(k: K, v: WizardState[K]) => setS((p) => ({ ...p, [k]: v }));
  const setIn = <K extends keyof WizardState>(k: K, patch: Partial<WizardState[K]>) => setS((p) => ({ ...p, [k]: { ...(p[k] as object), ...patch } }));

  // Live calculation with the same engine the server uses.
  const calc = useMemo(() => {
    const pkgs = s.pricing.mode === "package" ? s.pricing.package_ids.map((id) => catalog.packages.find((p) => p.id === id)).filter(Boolean).map((p) => snapshot(p!)) : [];
    const rule = s.discount.rule_id ? catalog.discounts.find((d) => d.id === s.discount.rule_id) : null;
    return computeProposal({
      mode: s.pricing.mode, pkgs, addons: s.pricing.addons, custom: s.pricing.custom, externals: s.externals, maintenance: s.maintenance,
      discount: rule ? { type: rule.type, value: Number(rule.value), max_amount: rule.max_amount == null ? null : Number(rule.max_amount) } : s.discount,
      discount_applies_to_external: catalog.defaults.discount_applies_to_external, tax: catalog.tax, milestones: s.milestones,
      scope: { platforms: s.scope_details.platforms, pages: s.scope_details.pages, screens: s.scope_details.screens, integrations: s.scope_details.integrations,
        roles: s.scope_details.roles, backend: s.scope_details.backend as never },
    });
  }, [s, catalog]);

  function save(next?: number, thenPreview?: boolean) {
    setMsg(null);
    startSave(async () => {
      const r = await saveProposalAction(proposalId, s);
      if (!r?.ok) { setMsg({ error: r?.error ?? "Could not save." }); return; }
      const id = r.data!.proposalId as string;
      // A newly created client is now an existing one — never create it twice.
      if (s.client.mode === "new") setS((p) => ({ ...p, client: { mode: "existing", client_id: r.data!.clientId as string } }));
      // The URL is left unchanged on purpose: changing it re-renders the route and resets the wizard.
      // Saved drafts are always reachable from the Proposals list.
      if (!proposalId) setProposalId(id);
      if (thenPreview) { router.push(`/admin/proposals/${id}`); return; }
      setMsg({ ok: `Draft saved · ${r.data!.number}` });
      if (next != null) { setStep(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
  }

  function changeType(t: string) {
    setS((p) => {
      let ids = p.pricing.package_ids;
      if (p.pricing.mode === "package") {
        const web = catalog.packages.find((x) => x.kind === "website" && x.is_active)?.id;
        const app = catalog.packages.find((x) => x.kind === "app" && x.is_active)?.id;
        const wanted = t === "website" ? [web] : t === "website_app" ? [web, app] : t === "custom_software" ? [] : [app];
        ids = wanted.filter((x): x is string => !!x);
      }
      const platforms = t === "android_app" ? ["android"] : t === "ios_app" ? ["ios"] : t === "cross_platform_app" ? ["android", "ios"] : p.scope_details.platforms;
      return { ...p, project_type: t, pricing: { ...p.pricing, package_ids: ids }, scope_details: { ...p.scope_details, platforms } };
    });
  }

  const m = (n: number) => formatMoney(n);
  const stepState = (i: number) => (i === 1 && !isWeb(s.project_type)) || (i === 2 && !isApp(s.project_type)) ? "skip" : i < step ? "done" : i === step ? "current" : "todo";

  return (
    <div className="grid grid-main" style={{ alignItems: "start" }}>
      <div className="stack">
        <nav aria-label="Proposal steps" className="glass" style={{ padding: 10, overflowX: "auto" }}>
          <ol className="row" style={{ listStyle: "none", margin: 0, padding: 0, gap: 4, flexWrap: "nowrap" }}>
            {STEPS.map((label, i) => {
              const st = stepState(i);
              return (
                <li key={label}>
                  <button type="button" onClick={() => setStep(i)} aria-current={st === "current" ? "step" : undefined}
                    className="btn btn-sm" style={{ whiteSpace: "nowrap", background: st === "current" ? "rgba(61,139,255,.2)" : "transparent",
                      borderColor: st === "current" ? "rgba(61,139,255,.5)" : "transparent", opacity: st === "skip" ? 0.45 : 1 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 11,
                      background: st === "done" ? "var(--blue)" : "rgba(255,255,255,.08)" }}>{st === "done" ? <Icon name="check" width={12} height={12} /> : i + 1}</span>
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="progress" style={{ marginTop: 8, height: 4 }}><span style={{ ["--value" as string]: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
        </nav>

        {msg?.error && <div role="alert" className="notice error">{msg.error}</div>}
        {msg?.ok && <div role="status" className="notice success">{msg.ok}</div>}

        <section className="glass panel page-anim" key={step}>
          <h2 style={{ marginBottom: 16 }}>Step {step + 1} · {STEPS[step]}</h2>
          {step === 0 && <StepClient s={s} setS={setS} set={set} setIn={setIn} clients={clients} admins={admins} changeType={changeType} locked={!!proposalId} />}
          {step === 1 && (isWeb(s.project_type)
            ? <StepPricing kind="website" s={s} setS={setS} catalog={catalog} />
            : <Skip text={`Website pricing is not needed for a ${PROJECT_TYPE_LABELS[s.project_type]} project.`} />)}
          {step === 2 && (isApp(s.project_type)
            ? <StepPricing kind="app" s={s} setS={setS} catalog={catalog} />
            : <Skip text={`App pricing is not needed for a ${PROJECT_TYPE_LABELS[s.project_type]} project.`} />)}
          {step === 3 && <StepExternals s={s} set={set} catalog={catalog} />}
          {step === 4 && <StepMaintenance s={s} set={set} setIn={setIn} catalog={catalog} />}
          {step === 5 && <StepScope s={s} setIn={setIn} />}
          {step === 6 && <StepPayment s={s} set={set} setIn={setIn} catalog={catalog} calc={calc} />}
          {step === 7 && <StepReview s={s} calc={calc} />}
        </section>

        <div className="glass row-between" style={{ padding: "10px 12px", position: "sticky", bottom: 10, zIndex: 5 }}>
          <button type="button" className="btn btn-ghost" disabled={step === 0 || saving} onClick={() => setStep(step - 1)}><Icon name="up" style={{ transform: "rotate(-90deg)" }} /> Back</button>
          <div className="row">
            <button type="button" className="btn" disabled={saving} onClick={() => save()}>{saving && <span className="spinner" />}Save draft</button>
            {step < STEPS.length - 1
              ? <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save(step + 1)}>Save &amp; continue</button>
              : <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save(undefined, true)}>Save &amp; preview</button>}
          </div>
        </div>
      </div>

      <aside className="stack" style={{ position: "sticky", top: 80 }} aria-label="Live price calculation">
        <section className="glass panel">
          <div className="panel-head"><h2>Live calculation</h2>{number && <span className="badge plain">{number}</span>}</div>
          <div className="totals" style={{ width: "100%", marginTop: 0 }}>
            {calc.base > 0 && <Row l="Base package" v={m(calc.base)} />}
            {calc.addons > 0 && <Row l="Additional features" v={m(calc.addons)} />}
            {calc.custom > 0 && <Row l="Custom development" v={m(calc.custom)} />}
            {calc.external > 0 && <Row l="External (one-time)" v={m(calc.external)} />}
            <Row l="One-time subtotal" v={m(calc.subtotal)} />
            {calc.discountAmount > 0 && <Row l={`Discount (${calc.discountPercent}%)`} v={`− ${m(calc.discountAmount)}`} />}
            {catalog.tax.enabled && <><Row l="Taxable amount" v={m(calc.taxable)} /><Row l={`${catalog.tax.label} (${catalog.tax.rate}%)`} v={m(calc.taxAmount)} /></>}
            <div className="row-between grand"><span>Final one-time total</span><span className="mono">{m(calc.total)}</span></div>
            {(calc.recurringMonthly > 0 || calc.recurringAnnual > 0) && (
              <div className="stack-sm" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border-strong)" }}>
                <span className="tiny faint">Recurring (not in one-time total)</span>
                {calc.recurringMonthly > 0 && <Row l="Monthly" v={`${m(calc.recurringMonthly)}/mo`} />}
                {calc.recurringAnnual > 0 && <Row l="Annual" v={`${m(calc.recurringAnnual)}/yr`} />}
              </div>
            )}
            {calc.milestones.length > 0 && <Row l="Initial amount payable" v={m(calc.initialPayable)} />}
          </div>
          {!catalog.tax.enabled && <p className="tiny faint" style={{ marginTop: 8 }}>Tax is off in Pricing configuration.</p>}
        </section>
        {calc.warnings.length > 0 && (
          <div className="notice warn stack-sm"><strong className="small">Check before sending</strong>{calc.warnings.map((w, i) => <span key={i} className="small">• {w}</span>)}</div>
        )}
        {calc.errors.length > 0 && step >= 6 && (
          <div className="notice error stack-sm"><strong className="small">Needed before sending</strong>{calc.errors.map((w, i) => <span key={i} className="small">• {w}</span>)}</div>
        )}
      </aside>
    </div>
  );
}

const Row = ({ l, v }: { l: string; v: string }) => <div className="row-between"><span>{l}</span><span className="mono">{v}</span></div>;
const Skip = ({ text }: { text: string }) => <p className="muted">{text} Continue to the next step.</p>;

function Field({ label, children, full, hint, id }: { label: string; children: React.ReactNode; full?: boolean; hint?: string; id?: string }) {
  return <div className={`field${full ? " full" : ""}`}><label htmlFor={id}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>;
}

// ---------------------------------------------------------------------------
type Setter = React.Dispatch<React.SetStateAction<WizardState>>;
type SetK = <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
type SetIn = <K extends keyof WizardState>(k: K, patch: Partial<WizardState[K]>) => void;

function StepClient({ s, setS, set, setIn, clients, admins, changeType, locked }: { s: WizardState; setS: Setter; set: SetK; setIn: SetIn; clients: ClientOpt[];
  admins: { id: string; name: string }[]; changeType: (t: string) => void; locked: boolean }) {
  type NewClient = Extract<WizardState["client"], { mode: "new" }>;
  const setNew = (patch: Partial<NewClient>, contact?: Partial<WizardState["contact"]>) =>
    setS((p) => ({ ...p, client: { ...(p.client as NewClient), ...patch }, contact: contact ? { ...p.contact, ...contact } : p.contact }));
  const pick = (id: string) => {
    const c = clients.find((x) => x.id === id);
    setS((p) => ({ ...p, client: { mode: "existing", client_id: id }, business_category: c?.business_category ?? p.business_category,
      contact: c && !p.contact.email ? { name: c.owner_name, email: c.email, phone: c.phone } : p.contact }));
  };
  return (
    <div className="form-grid">
      <div className="field full">
        <span className="label">Client</span>
        <div className="seg" role="group" aria-label="Client source">
          <button type="button" aria-pressed={s.client.mode === "existing"} disabled={locked} onClick={() => set("client", { mode: "existing", client_id: "" })}>Existing client</button>
          <button type="button" aria-pressed={s.client.mode === "new"} disabled={locked} onClick={() => set("client", { mode: "new", business_name: "", owner_name: "", email: "", phone: null, business_category: null })}>New client</button>
        </div>
      </div>
      {s.client.mode === "existing" ? (
        <Field label="Select client" full id="w-client">
          <select id="w-client" className="select" value={s.client.client_id} onChange={(e) => pick(e.target.value)} required>
            <option value="" disabled>Choose a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.business_name} — {c.owner_name}</option>)}
          </select>
        </Field>
      ) : (
        <>
          <Field label="Business name" id="w-bn"><input id="w-bn" className="input" value={s.client.business_name} onChange={(e) => setNew({ business_name: e.target.value })} /></Field>
          <Field label="Business category" id="w-bc"><input id="w-bc" className="input" value={s.client.business_category ?? ""} onChange={(e) => setNew({ business_category: e.target.value })} placeholder="Cafe / restaurant" /></Field>
          <Field label="Owner name" id="w-on"><input id="w-on" className="input" value={s.client.owner_name} onChange={(e) => setNew({ owner_name: e.target.value }, { name: e.target.value })} /></Field>
          <Field label="Client email" id="w-ce"><input id="w-ce" type="email" className="input" value={s.client.email} onChange={(e) => setNew({ email: e.target.value }, { email: e.target.value })} /></Field>
        </>
      )}
      <Field label="Contact person" id="w-cn"><input id="w-cn" className="input" value={s.contact.name} onChange={(e) => setIn("contact", { name: e.target.value })} required /></Field>
      <Field label="Contact email" id="w-cm"><input id="w-cm" type="email" className="input" value={s.contact.email} onChange={(e) => setIn("contact", { email: e.target.value })} required /></Field>
      <Field label="Phone / WhatsApp" id="w-cp"><input id="w-cp" className="input" value={s.contact.phone ?? ""} onChange={(e) => setIn("contact", { phone: e.target.value || null })} /></Field>
      <Field label="Business category" id="w-cat"><input id="w-cat" className="input" value={s.business_category ?? ""} onChange={(e) => set("business_category", e.target.value || null)} /></Field>
      <Field label="Project title" full id="w-title"><input id="w-title" className="input" value={s.title} onChange={(e) => set("title", e.target.value)} placeholder="Cafe website development" required /></Field>
      <Field label="Project type" id="w-type">
        <select id="w-type" className="select" value={s.project_type} onChange={(e) => changeType(e.target.value)}>
          {Object.entries(PROJECT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Target launch date (estimate)" id="w-launch"><input id="w-launch" type="date" className="input" value={s.target_launch_date ?? ""} onChange={(e) => set("target_launch_date", e.target.value || null)} /></Field>
      <Field label="Assigned team member" id="w-as">
        <select id="w-as" className="select" value={s.assigned_to ?? ""} onChange={(e) => set("assigned_to", e.target.value || null)}>
          <option value="">Unassigned</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Project description" full id="w-desc"><textarea id="w-desc" className="textarea" value={s.description ?? ""} onChange={(e) => set("description", e.target.value || null)} /></Field>
      <Field label="Client requirements" full id="w-req"><textarea id="w-req" className="textarea" value={s.requirements ?? ""} onChange={(e) => set("requirements", e.target.value || null)} placeholder="What the client asked for, in their words" /></Field>
      <Field label="Executive summary (shown first in the proposal)" full id="w-exec"><textarea id="w-exec" className="textarea" value={s.executive_summary ?? ""} onChange={(e) => set("executive_summary", e.target.value || null)} /></Field>
      <Field label="Recommended solution" full id="w-sol"><textarea id="w-sol" className="textarea" value={s.recommended_solution ?? ""} onChange={(e) => set("recommended_solution", e.target.value || null)} /></Field>
      <Field label="Internal notes (never shown to the client)" full id="w-int"><textarea id="w-int" className="textarea" value={s.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value || null)} /></Field>
    </div>
  );
}

function StepPricing({ kind, s, setS, catalog }: { kind: "website" | "app"; s: WizardState; setS: Setter; catalog: Catalog }) {
  const pkgs = catalog.packages.filter((p) => p.kind === kind && p.is_active);
  const services = catalog.services.filter((x) => x.is_active && (x.category === kind || x.category === "both"));
  const p = s.pricing;
  const setP = (patch: Partial<WizardState["pricing"]>) => setS((x) => ({ ...x, pricing: { ...x.pricing, ...patch } }));
  const togglePkg = (id: string) => {
    const others = p.package_ids.filter((x) => catalog.packages.find((k) => k.id === x)?.kind !== kind);
    setP({ package_ids: p.package_ids.includes(id) ? others : [...others, id] });
  };
  const selectedAddon = (svc: ServiceRow) => p.addons.findIndex((a) => a.service_id === svc.id);
  const toggleAddon = (svc: ServiceRow) => {
    const i = selectedAddon(svc);
    if (i >= 0) setP({ addons: p.addons.filter((_, j) => j !== i) });
    else setP({ addons: [...p.addons, { service_id: svc.id, name: svc.name, description: svc.description, unit: UNIT[svc.unit] || null, quantity: 1,
      unit_price: svc.default_price == null ? null : Number(svc.default_price), range_min: svc.min_price == null ? null : Number(svc.min_price),
      range_max: svc.max_price == null ? null : Number(svc.max_price), open_ended: svc.open_ended }] });
  };
  const updAddon = (i: number, patch: Partial<Addon>) => setP({ addons: p.addons.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const updCustom = (i: number, patch: Partial<Custom>) => setP({ custom: p.custom.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const loadBreakdown = (pkg: PackageRow) => setP({ custom: [...p.custom, ...pkg.items.map((i) => ({ name: i.name, description: i.description, quantity: 1, unit_price: Number(i.amount) }))] });
  const range = (svc: { min_price: number | null; max_price: number | null; open_ended: boolean }) =>
    svc.min_price == null ? "Custom quote" : `${formatMoney(Number(svc.min_price))}–${formatMoney(Number(svc.max_price ?? svc.min_price))}${svc.open_ended ? "+" : ""}`;
  const sd = s.scope_details;
  const setSD = (patch: Partial<WizardState["scope_details"]>) => setS((x) => ({ ...x, scope_details: { ...x.scope_details, ...patch } }));

  return (
    <div className="stack">
      <div className="row-between">
        <div className="seg" role="group" aria-label="Pricing mode">
          <button type="button" aria-pressed={p.mode === "package"} onClick={() => setP({ mode: "package" })}>Package pricing</button>
          <button type="button" aria-pressed={p.mode === "itemized"} onClick={() => setP({ mode: "itemized" })}>Itemized custom pricing</button>
        </div>
        <span className="tiny faint">{p.mode === "package" ? "Package price + add-ons. Breakdown items are included, not charged again." : "Build the price from individual line items."}</span>
      </div>

      {kind === "app" && (
        <div className="form-grid">
          <div className="field full"><span className="label">Target platforms</span>
            <div className="row">{["android", "ios", "web"].map((pl) => (
              <label key={pl} className="check"><input type="checkbox" checked={sd.platforms.includes(pl)} onChange={(e) => setSD({ platforms: e.target.checked ? [...sd.platforms, pl] : sd.platforms.filter((x) => x !== pl) })} />
                {pl === "ios" ? "iOS" : pl === "android" ? "Android" : "Web / admin panel"}</label>
            ))}</div></div>
          <Field label="Number of screens" id="sd-scr"><input id="sd-scr" type="number" min={0} className="input" value={sd.screens ?? ""} onChange={(e) => setSD({ screens: num(e.target.value) })} /></Field>
          <Field label="Third-party integrations" id="sd-int"><input id="sd-int" type="number" min={0} className="input" value={sd.integrations ?? ""} onChange={(e) => setSD({ integrations: num(e.target.value) })} /></Field>
          <Field label="Backend complexity" id="sd-be">
            <select id="sd-be" className="select" value={sd.backend ?? ""} onChange={(e) => setSD({ backend: e.target.value || null })}>
              <option value="">Not specified</option><option value="simple">Simple</option><option value="moderate">Moderate</option><option value="complex">Complex</option>
            </select></Field>
          <Field label="User roles" id="sd-roles"><input id="sd-roles" type="number" min={0} className="input" value={sd.roles ?? ""} onChange={(e) => setSD({ roles: num(e.target.value) })} /></Field>
          <Field label="Authentication" id="sd-auth"><input id="sd-auth" className="input" value={sd.authentication ?? ""} onChange={(e) => setSD({ authentication: e.target.value || null })} placeholder="Phone OTP, Google sign-in…" /></Field>
          <Field label="Storage / media" id="sd-st"><input id="sd-st" className="input" value={sd.storage ?? ""} onChange={(e) => setSD({ storage: e.target.value || null })} placeholder="Product images, user uploads…" /></Field>
        </div>
      )}
      {kind === "website" && (
        <div className="form-grid"><Field label="Number of pages" id="sd-pages"><input id="sd-pages" type="number" min={0} className="input" value={sd.pages ?? ""} onChange={(e) => setSD({ pages: num(e.target.value) })} /></Field></div>
      )}

      <div>
        <h3 className="small" style={{ marginBottom: 8 }}>{kind === "website" ? "Website" : "App"} starting package</h3>
        <div className="stack-sm">
          {pkgs.map((pkg) => (
            <div key={pkg.id} className="glass" style={{ padding: 12, background: "rgba(0,0,0,.15)" }}>
              <div className="row-between">
                <label className="check" style={{ color: "var(--text)" }}>
                  <input type="checkbox" checked={p.mode === "package" && p.package_ids.includes(pkg.id)} disabled={p.mode !== "package"} onChange={() => togglePkg(pkg.id)} />
                  <span><strong style={{ fontWeight: 500 }}>{pkg.name}</strong> · {formatMoney(Number(pkg.price))}</span>
                </label>
                {p.mode === "itemized" && <button type="button" className="btn btn-sm" onClick={() => loadBreakdown(pkg)}>Use breakdown as line items</button>}
              </div>
              <details style={{ marginTop: 6 }}><summary className="tiny faint">Breakdown ({pkg.items.length} items)</summary>
                <ul className="tiny muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{pkg.items.map((i) => <li key={i.id}>{i.name} — {formatMoney(Number(i.amount))}</li>)}</ul>
              </details>
            </div>
          ))}
          {pkgs.length === 0 && <p className="small muted">No active {kind} packages. Add one in Pricing configuration.</p>}
        </div>
      </div>

      {p.mode === "itemized" && (
        <div>
          <div className="row-between" style={{ marginBottom: 8 }}><h3 className="small">Line items</h3>
            <button type="button" className="btn btn-sm" onClick={() => setP({ custom: [...p.custom, { name: "", description: null, quantity: 1, unit_price: null }] })}><Icon name="plus" /> Add line</button></div>
          <div className="stack-sm">
            {p.custom.map((c, i) => (
              <div key={i} className="form-grid" style={{ gridTemplateColumns: "minmax(0,3fr) 80px 130px auto", alignItems: "end" }}>
                <Field label="Item" id={`c-n-${i}`}><input id={`c-n-${i}`} className="input" value={c.name} onChange={(e) => updCustom(i, { name: e.target.value })} /></Field>
                <Field label="Qty" id={`c-q-${i}`}><input id={`c-q-${i}`} type="number" min="0.01" step="0.01" className="input" value={c.quantity} onChange={(e) => updCustom(i, { quantity: Number(e.target.value) })} /></Field>
                <Field label="Unit price (₹)" id={`c-p-${i}`}><input id={`c-p-${i}`} type="number" min="0" step="0.01" className="input" value={c.unit_price ?? ""} onChange={(e) => updCustom(i, { unit_price: num(e.target.value) })} /></Field>
                <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove line" onClick={() => setP({ custom: p.custom.filter((_, j) => j !== i) })}><Icon name="trash" /></button>
              </div>
            ))}
            {p.custom.length === 0 && <p className="small muted">No line items yet.</p>}
          </div>
        </div>
      )}

      <div>
        <h3 className="small" style={{ marginBottom: 8 }}>Optional {kind === "website" ? "website" : "app"} services</h3>
        <div className="stack-sm">
          {services.map((svc) => {
            const i = selectedAddon(svc);
            const a = i >= 0 ? p.addons[i] : null;
            return (
              <div key={svc.id} className="glass" style={{ padding: 10, background: a ? "rgba(61,139,255,.07)" : "rgba(0,0,0,.12)" }}>
                <div className="row-between">
                  <label className="check" style={{ color: "var(--text)" }}><input type="checkbox" checked={!!a} onChange={() => toggleAddon(svc)} />
                    <span>{svc.name} <span className="tiny faint">· {range(svc)} {UNIT[svc.unit]}</span></span></label>
                </div>
                {a && (
                  <div className="row" style={{ marginTop: 8, paddingLeft: 26 }}>
                    <label className="small muted" htmlFor={`a-q-${svc.id}`}>Qty</label>
                    <input id={`a-q-${svc.id}`} type="number" min="1" step="1" className="input" style={{ width: 80 }} value={a.quantity} onChange={(e) => updAddon(i, { quantity: Number(e.target.value) })} />
                    <label className="small muted" htmlFor={`a-p-${svc.id}`}>Quoted price (₹)</label>
                    <input id={`a-p-${svc.id}`} type="number" min="0" step="1" className="input" style={{ width: 130 }} value={a.unit_price ?? ""} placeholder="Enter price" onChange={(e) => updAddon(i, { unit_price: num(e.target.value) })} />
                    {a.unit_price != null && <span className="small mono">= {formatMoney(a.unit_price * a.quantity)}</span>}
                    {a.unit_price == null && <span className="tiny" style={{ color: "var(--amber)" }}>Choose the actual quoted price</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <button type="button" className="btn btn-sm" onClick={() => setP({ addons: [...p.addons, { service_id: null, name: "Custom feature", description: null, unit: null, quantity: 1, unit_price: null, range_min: null, range_max: null, open_ended: false }] })}>
          <Icon name="plus" /> Add a custom feature</button>
        <div className="stack-sm" style={{ marginTop: 8 }}>
          {p.addons.map((a, i) => a.service_id ? null : (
            <div key={i} className="form-grid" style={{ gridTemplateColumns: "minmax(0,3fr) 80px 130px auto", alignItems: "end" }}>
              <Field label="Feature" id={`ca-n-${i}`}><input id={`ca-n-${i}`} className="input" value={a.name} onChange={(e) => updAddon(i, { name: e.target.value })} /></Field>
              <Field label="Qty" id={`ca-q-${i}`}><input id={`ca-q-${i}`} type="number" min="1" className="input" value={a.quantity} onChange={(e) => updAddon(i, { quantity: Number(e.target.value) })} /></Field>
              <Field label="Price (₹)" id={`ca-p-${i}`}><input id={`ca-p-${i}`} type="number" min="0" className="input" value={a.unit_price ?? ""} onChange={(e) => updAddon(i, { unit_price: num(e.target.value) })} /></Field>
              <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove feature" onClick={() => setP({ addons: p.addons.filter((_, j) => j !== i) })}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepExternals({ s, set, catalog }: { s: WizardState; set: SetK; catalog: Catalog }) {
  const upd = (i: number, patch: Partial<External>) => set("externals", s.externals.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const add = (e?: ExternalRow) => set("externals", [...s.externals, {
    catalog_id: e?.id ?? null, name: e?.name ?? "", category: e?.category ?? "other", billing: e?.billing ?? "recurring", period: e?.period ?? "annual",
    provider_cost: e?.provider_cost == null ? null : Number(e.provider_cost), selling_price: e?.selling_price == null ? null : Number(e.selling_price),
    included_in_package: false, payer: "client", renewal_date: null }]);
  return (
    <div className="stack">
      <p className="small muted">Third-party fees are listed separately from development. Leave the client price empty to mark it “To be confirmed” — it is then shown but not counted.</p>
      <div className="row">
        {catalog.externals.filter((e) => e.is_active).map((e) => (
          <button key={e.id} type="button" className="btn btn-sm" onClick={() => add(e)}><Icon name="plus" /> {e.name}</button>
        ))}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => add()}><Icon name="plus" /> Other</button>
      </div>
      {s.externals.length === 0 && <p className="small muted">No external costs added.</p>}
      {s.externals.map((e, i) => (
        <div key={i} className="glass" style={{ padding: 12, background: "rgba(0,0,0,.15)" }}>
          <div className="form-grid">
            <Field label="Service" id={`e-n-${i}`}><input id={`e-n-${i}`} className="input" value={e.name} onChange={(x) => upd(i, { name: x.target.value })} /></Field>
            <Field label="Billing" id={`e-b-${i}`}>
              <select id={`e-b-${i}`} className="select" value={e.billing === "one_time" ? "one_time" : e.period ?? "annual"}
                onChange={(x) => upd(i, x.target.value === "one_time" ? { billing: "one_time", period: null } : { billing: "recurring", period: x.target.value as "monthly" | "annual" })}>
                <option value="one_time">One-time</option><option value="monthly">Recurring · monthly</option><option value="annual">Recurring · annual</option>
              </select></Field>
            <Field label="Actual provider cost (₹, internal)" id={`e-pc-${i}`} hint="Never shown to the client">
              <input id={`e-pc-${i}`} type="number" min="0" className="input" value={e.provider_cost ?? ""} placeholder="To be confirmed" onChange={(x) => upd(i, { provider_cost: num(x.target.value) })} /></Field>
            <Field label="Client price (₹)" id={`e-sp-${i}`} hint={e.selling_price == null ? "Empty = To be confirmed" : undefined}>
              <input id={`e-sp-${i}`} type="number" min="0" className="input" value={e.selling_price ?? ""} placeholder="To be confirmed" onChange={(x) => upd(i, { selling_price: num(x.target.value) })} /></Field>
            <Field label="Who pays the provider" id={`e-py-${i}`}>
              <select id={`e-py-${i}`} className="select" value={e.payer} onChange={(x) => upd(i, { payer: x.target.value as "agency" | "client" })}>
                <option value="client">Client pays the provider directly</option><option value="agency">We pay and bill the client</option>
              </select></Field>
            <Field label="Renewal date" id={`e-rd-${i}`}><input id={`e-rd-${i}`} type="date" className="input" value={e.renewal_date ?? ""} onChange={(x) => upd(i, { renewal_date: x.target.value || null })} /></Field>
            <label className="check full"><input type="checkbox" checked={e.included_in_package} onChange={(x) => upd(i, { included_in_package: x.target.checked })} /> Included in the package (not charged separately)</label>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => set("externals", s.externals.filter((_, j) => j !== i))}><Icon name="trash" /> Remove</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StepMaintenance({ s, set, setIn, catalog }: { s: WizardState; set: SetK; setIn: SetIn; catalog: Catalog }) {
  const kind = isApp(s.project_type) && !isWeb(s.project_type) ? "app" : isWeb(s.project_type) && !isApp(s.project_type) ? "website" : null;
  const plans = catalog.plans.filter((p) => p.is_active && (!kind || p.kind === kind));
  const choose = (p: PlanRow | null, custom = false) => {
    if (!p && !custom) return set("maintenance", null);
    set("maintenance", p ? { plan_id: p.id, name: `${p.kind === "app" ? "App" : "Website"} ${p.name}`, kind: p.kind, billing: "monthly", monthly_price: Number(p.monthly_price),
      annual_price: p.annual_price == null ? null : Number(p.annual_price), included_hours: p.included_hours, bug_fix_coverage: p.bug_fix_coverage,
      update_frequency: p.update_frequency, backup_monitoring: p.backup_monitoring, support_channel: p.support_channel, response_time: p.response_time, exclusions: p.exclusions }
      : { plan_id: null, name: "Custom", kind: null, billing: "monthly", monthly_price: 0, annual_price: null, included_hours: null, bug_fix_coverage: null,
        update_frequency: null, backup_monitoring: null, support_channel: null, response_time: null, exclusions: null });
  };
  const mt = s.maintenance;
  const upd = (patch: Partial<Maint>) => set("maintenance", { ...mt!, ...patch });
  return (
    <div className="stack">
      <div className="stack-sm" role="radiogroup" aria-label="Maintenance plan">
        <label className="check"><input type="radio" name="plan" checked={!mt} onChange={() => choose(null)} /> No maintenance plan</label>
        {plans.map((p) => (
          <label key={p.id} className="check"><input type="radio" name="plan" checked={mt?.plan_id === p.id} onChange={() => choose(p)} />
            <span>{p.kind === "app" ? "App" : "Website"} {p.name} — {formatMoney(Number(p.monthly_price))}/month <span className="tiny faint">· {p.response_time}</span></span></label>
        ))}
        <label className="check"><input type="radio" name="plan" checked={!!mt && !mt.plan_id} onChange={() => choose(null, true)} /> Custom plan</label>
      </div>
      {mt && (
        <div className="form-grid">
          <Field label="Plan name" id="mt-n"><input id="mt-n" className="input" value={mt.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
          <Field label="Billing" id="mt-b"><select id="mt-b" className="select" value={mt.billing} onChange={(e) => upd({ billing: e.target.value as "monthly" | "annual" })}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></Field>
          <Field label="Monthly price (₹)" id="mt-mp"><input id="mt-mp" type="number" min="0" className="input" value={mt.monthly_price} onChange={(e) => upd({ monthly_price: Number(e.target.value) })} /></Field>
          <Field label="Annual price (₹)" id="mt-ap" hint="Empty = 12 × monthly"><input id="mt-ap" type="number" min="0" className="input" value={mt.annual_price ?? ""} onChange={(e) => upd({ annual_price: num(e.target.value) })} /></Field>
          {([["included_hours", "Included hours / tasks"], ["bug_fix_coverage", "Bug-fix coverage"], ["update_frequency", "Update frequency"], ["backup_monitoring", "Backup & monitoring"],
            ["support_channel", "Support channel"], ["response_time", "Response time"], ["exclusions", "Exclusions"]] as const).map(([k, l]) => (
            <Field key={k} label={l} id={`mt-${k}`}><input id={`mt-${k}`} className="input" value={mt[k] ?? ""} onChange={(e) => upd({ [k]: e.target.value || null } as Partial<Maint>)} /></Field>
          ))}
          <p className="tiny faint full">Plans are suggested defaults, not guaranteed entitlements, until agreed in the accepted proposal.</p>
        </div>
      )}
      <hr />
      <div className="form-grid">
        <Field label="Post-launch warranty (days)" id="w-days"><input id="w-days" type="number" min="0" className="input" value={s.warranty.days} onChange={(e) => setIn("warranty", { days: Number(e.target.value) })} /></Field>
        <Field label="Warranty terms" full id="w-terms" hint="Keep warranty bug fixes separate from new features, third-party failures and maintenance.">
          <textarea id="w-terms" className="textarea" value={s.warranty.terms ?? ""} onChange={(e) => setIn("warranty", { terms: e.target.value || null })} /></Field>
      </div>
    </div>
  );
}

function StepScope({ s, setIn }: { s: WizardState; setIn: SetIn }) {
  const sc = s.scope;
  const up = (patch: Partial<WizardState["scope"]>) => setIn("scope", patch);
  const listField = (k: "features" | "pages_screens" | "deliverables" | "client_responsibilities" | "exclusions" | "assumptions", label: string) => (
    <Field label={`${label} (one per line)`} id={`sc-${k}`}><textarea id={`sc-${k}`} className="textarea" style={{ minHeight: 110 }} value={lines(sc[k])} onChange={(e) => up({ [k]: unlines(e.target.value) })} /></Field>
  );
  return (
    <div className="form-grid">
      <Field label="Project objectives" full id="sc-obj"><textarea id="sc-obj" className="textarea" value={sc.objectives ?? ""} onChange={(e) => up({ objectives: e.target.value || null })} /></Field>
      {listField("features", "Features included")}
      {listField("pages_screens", "Pages or screens included")}
      <Field label="Design and functionality requirements" full id="sc-des"><textarea id="sc-des" className="textarea" value={sc.design_requirements ?? ""} onChange={(e) => up({ design_requirements: e.target.value || null })} /></Field>
      {listField("deliverables", "Deliverables")}
      {listField("client_responsibilities", "Client responsibilities")}
      <Field label="Content and asset requirements" full id="sc-con"><textarea id="sc-con" className="textarea" value={sc.content_requirements ?? ""} onChange={(e) => up({ content_requirements: e.target.value || null })} /></Field>
      <Field label="Revision rounds" id="sc-rev"><input id="sc-rev" type="number" min="0" className="input" value={sc.revisions} onChange={(e) => up({ revisions: Number(e.target.value) })} /></Field>
      <div className="field full">
        <div className="row-between"><span className="label">Project milestones &amp; time estimates</span>
          <button type="button" className="btn btn-sm" onClick={() => up({ milestones: [...sc.milestones, { title: "", estimate: null }] })}><Icon name="plus" /> Add</button></div>
        {sc.milestones.map((mm, i) => (
          <div key={i} className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input" aria-label="Milestone" placeholder="e.g. Design approval" value={mm.title} onChange={(e) => up({ milestones: sc.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <input className="input" aria-label="Estimate" placeholder="e.g. Week 1–2" style={{ maxWidth: 180 }} value={mm.estimate ?? ""} onChange={(e) => up({ milestones: sc.milestones.map((x, j) => (j === i ? { ...x, estimate: e.target.value || null } : x)) })} />
            <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove" onClick={() => up({ milestones: sc.milestones.filter((_, j) => j !== i) })}><Icon name="trash" /></button>
          </div>
        ))}
      </div>
      <Field label="Estimated delivery timeline" full id="sc-tl" hint="Your estimate — no completion date is guaranteed."><textarea id="sc-tl" className="textarea" value={sc.timeline ?? ""} onChange={(e) => up({ timeline: e.target.value || null })} placeholder="About 3–4 weeks from advance payment and receipt of content" /></Field>
      <Field label="Testing and acceptance criteria" full id="sc-acc"><textarea id="sc-acc" className="textarea" value={sc.acceptance_criteria ?? ""} onChange={(e) => up({ acceptance_criteria: e.target.value || null })} /></Field>
      {listField("exclusions", "Exclusions")}
      {listField("assumptions", "Assumptions")}
    </div>
  );
}

function StepPayment({ s, set, setIn, catalog, calc }: { s: WizardState; set: SetK; setIn: SetIn; catalog: Catalog; calc: ReturnType<typeof computeProposal> }) {
  const updM = (i: number, patch: Partial<Milestone>) => set("milestones", s.milestones.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const d = s.discount;
  const m = (n: number) => formatMoney(n);
  return (
    <div className="stack">
      <h3 className="small">Discount</h3>
      <div className="form-grid">
        <Field label="Discount rule" id="d-rule">
          <select id="d-rule" className="select" value={d.rule_id ?? ""} onChange={(e) => setIn("discount", { rule_id: e.target.value || null })}>
            <option value="">Manual / none</option>
            {catalog.discounts.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.type === "percent" ? `${Number(x.value)}%` : m(Number(x.value))}{x.max_amount != null ? `, max ${m(Number(x.max_amount))}` : ""})</option>)}
          </select></Field>
        {!d.rule_id && <>
          <Field label="Type" id="d-type"><select id="d-type" className="select" value={d.type} onChange={(e) => setIn("discount", { type: e.target.value as "none" })}>
            <option value="none">No discount</option><option value="percent">Percentage</option><option value="amount">Fixed amount</option></select></Field>
          {d.type !== "none" && <>
            <Field label={d.type === "percent" ? "Percentage (%)" : "Amount (₹)"} id="d-val"><input id="d-val" type="number" min="0" step="0.01" className="input" value={d.value} onChange={(e) => setIn("discount", { value: Number(e.target.value) })} /></Field>
            <Field label="Maximum discount (₹, optional)" id="d-max"><input id="d-max" type="number" min="0" className="input" value={d.max_amount ?? ""} onChange={(e) => setIn("discount", { max_amount: num(e.target.value) })} /></Field>
          </>}
        </>}
      </div>
      <p className="tiny faint">Discounts apply to development charges{catalog.defaults.discount_applies_to_external ? " and one-time external fees" : " only"}. Tax: {catalog.tax.enabled ? `${catalog.tax.label} ${catalog.tax.rate}%${catalog.tax.apply_to_external ? ", including external fees" : " on development charges"}` : "off"}.</p>

      <hr />
      <div className="row-between"><h3 className="small">Payment milestones</h3>
        <div className="row">
          {catalog.templates.map((t) => <button key={t.id} type="button" className="btn btn-sm" onClick={() => set("milestones", t.items.map((x) => ({ label: x.label, mode: x.mode, value: Number(x.value), due: x.due })))}>Use “{t.name}”</button>)}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => set("milestones", [...s.milestones, { label: "", mode: "percent", value: 0, due: null }])}><Icon name="plus" /> Add</button>
        </div></div>
      {s.milestones.length === 0 && <p className="small muted">Choose a template or add milestones. Nothing is applied automatically.</p>}
      {s.milestones.map((x, i) => (
        <div key={i} className="form-grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) 120px 110px minmax(0,1.2fr) 120px auto", alignItems: "end" }}>
          <Field label="Milestone" id={`m-l-${i}`}><input id={`m-l-${i}`} className="input" value={x.label} onChange={(e) => updM(i, { label: e.target.value })} /></Field>
          <Field label="By" id={`m-m-${i}`}><select id={`m-m-${i}`} className="select" value={x.mode} onChange={(e) => updM(i, { mode: e.target.value as "percent" | "amount" })}><option value="percent">Percent</option><option value="amount">Amount</option></select></Field>
          <Field label={x.mode === "percent" ? "%" : "₹"} id={`m-v-${i}`}><input id={`m-v-${i}`} type="number" min="0" step="0.01" className="input" value={x.value} onChange={(e) => updM(i, { value: Number(e.target.value) })} /></Field>
          <Field label="When due" id={`m-d-${i}`}><input id={`m-d-${i}`} className="input" value={x.due ?? ""} onChange={(e) => updM(i, { due: e.target.value || null })} /></Field>
          <div className="small mono" style={{ paddingBottom: 10 }}>{m(calc.milestones[i]?.amount ?? 0)}</div>
          <button type="button" className="btn btn-ghost icon-btn" aria-label="Remove milestone" onClick={() => set("milestones", s.milestones.filter((_, j) => j !== i))}><Icon name="trash" /></button>
        </div>
      ))}
      {s.milestones.length > 0 && (
        <p className="small" style={{ color: calc.milestoneDiff !== 0 ? "var(--amber)" : "var(--text-2)" }}>
          Milestones total {m(calc.milestones.reduce((a, x) => a + x.amount, 0))} of {m(calc.total)}
          {calc.milestoneDiff !== 0 ? ` — ${m(Math.abs(calc.milestoneDiff))} ${calc.milestoneDiff > 0 ? "unallocated" : "over"}` : " ✓"}
          {calc.roundingAdjustment !== 0 && ` (includes a rounding adjustment of ${m(calc.roundingAdjustment)} on the last milestone)`}
        </p>
      )}
      <hr />
      <div className="form-grid">
        <Field label="Proposal valid until" id="p-valid"><input id="p-valid" type="date" className="input" value={s.valid_until} onChange={(e) => set("valid_until", e.target.value)} /></Field>
        <Field label="Terms and conditions" full id="p-terms"><textarea id="p-terms" className="textarea" style={{ minHeight: 140 }} value={s.terms ?? ""} onChange={(e) => set("terms", e.target.value || null)} /></Field>
      </div>
      <hr />
      <h3 className="small">Pricing summary</h3>
      <Summary calc={calc} tax={catalog.tax} />
    </div>
  );
}

function Summary({ calc, tax }: { calc: ReturnType<typeof computeProposal>; tax: TaxConfig }) {
  const m = (n: number) => formatMoney(n);
  const rows: [string, string][] = [
    ["1. Base package price", m(calc.base)], ["2. Additional feature costs", m(calc.addons)], ["3. Custom development charges", m(calc.custom)],
    ["4. Domain, hosting & external (one-time, billed by us)", m(calc.external)], ["5. One-time subtotal", m(calc.subtotal)],
    ["6. Discount", `${m(calc.discountAmount)} (${calc.discountPercent}%)`], ["7. Taxable amount", tax.enabled ? m(calc.taxable) : "Tax off"],
    [`8. ${tax.label}${tax.enabled ? ` (${tax.rate}%)` : ""}`, m(calc.taxAmount)], ["9. Final one-time total", m(calc.total)],
    ["10. Recurring monthly total", m(calc.recurringMonthly)], ["11. Recurring annual total", m(calc.recurringAnnual)],
    ["12. Initial amount payable", m(calc.initialPayable)],
    ["13. Remaining milestone payments", m(calc.milestones.slice(1).reduce((a, x) => a + x.amount, 0))],
  ];
  return <dl className="stack-sm" style={{ margin: 0 }}>{rows.map(([k, v]) => <div key={k} className="row-between small"><dt className="muted">{k}</dt><dd className="mono" style={{ margin: 0 }}>{v}</dd></div>)}</dl>;
}

function StepReview({ s, calc }: { s: WizardState; calc: ReturnType<typeof computeProposal> }) {
  return (
    <div className="stack">
      <p className="muted">Save to open the full proposal preview, where you can download the PDF, mark it ready and send it to the client.</p>
      <dl className="kv">
        <div><dt>Project</dt><dd>{s.title || "—"}</dd></div>
        <div><dt>Type</dt><dd>{PROJECT_TYPE_LABELS[s.project_type]}</dd></div>
        <div><dt>Contact</dt><dd>{s.contact.name || "—"}</dd></div>
        <div><dt>One-time total</dt><dd>{formatMoney(calc.total)}</dd></div>
        <div><dt>Recurring</dt><dd>{formatMoney(calc.recurringMonthly)}/mo · {formatMoney(calc.recurringAnnual)}/yr</dd></div>
        <div><dt>Valid until</dt><dd>{s.valid_until}</dd></div>
      </dl>
      {calc.errors.length === 0 ? <div className="notice success">Ready to preview. Pricing and payment milestones are consistent.</div>
        : <div className="notice error stack-sm"><strong className="small">Fix before sending (you can still save the draft)</strong>{calc.errors.map((e, i) => <span key={i} className="small">• {e}</span>)}</div>}
    </div>
  );
}
