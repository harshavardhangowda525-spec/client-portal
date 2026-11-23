import Link from "next/link";
import { requireClient } from "@/lib/session";
import { marketplace, SERVICE_CATEGORIES, INQUIRY_STATUSES, type ServiceCategory } from "@/server/marketplace";
import { Badge, Empty, PageHead, Panel } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ActionButton } from "@/components/forms";
import { hideRecommendationsAction } from "@/app/actions/growth";
import { RequestUpgrade } from "./request";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Services" };

const ICONS: Record<string, string> = { globe: "globe", cart: "cart", phone: "phone", users: "users", receipt: "receipt", calendar: "calendar", headset: "headset",
  sparkles: "sparkle", message: "message", wrench: "wrench", layout: "layout", code: "code", grid: "grid" };
const TINTS = ["blue", "violet", "green", "amber"];

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const actor = await requireClient();
  const { c } = await searchParams;
  const m = await marketplace(actor);
  const cat = c && c in SERVICE_CATEGORIES ? (c as ServiceCategory) : null;
  const shown = m.services.filter((s) => !cat || s.category === cat);
  const openReq = new Map(m.inquiries.filter((i) => i.status === "received" || i.status === "in_review").map((i) => [i.service_id, i]));
  const recIds = new Set(m.recommendations.map((r) => r.service.id));
  return (
    <>
      <PageHead eyebrow="Services" title="Grow your business with us" sub="Everything Infinity Web & Apps builds, in one place. Requesting a service never charges you."
        actions={<Link href="/portal/advisor" className="btn"><Icon name="sparkle" /> Not sure? Ask the AI advisor</Link>} />

      {m.recommendations.length > 0 && (
        <section className="glass panel next-step" aria-labelledby="rec-h" style={{ marginBottom: 18 }}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 id="rec-h">Picked for {m.category ? `your ${m.category.toLowerCase()} business` : "you"}</h2>
            <ActionButton action={hideRecommendationsAction.bind(null, true)} className="btn btn-sm btn-ghost">Hide suggestions</ActionButton>
          </div>
          <div className="grid grid-3 stagger">
            {m.recommendations.map((r) => (
              <div key={r.service.id} className="glass panel" style={{ padding: 14 }}>
                <strong>{r.service.name}</strong>
                <p className="small muted" style={{ margin: "4px 0 0" }}>{r.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      {m.hidden && <div className="row" style={{ marginBottom: 14 }}><span className="small faint">Suggestions are hidden.</span><ActionButton action={hideRecommendationsAction.bind(null, false)} className="btn btn-sm btn-ghost">Show suggestions</ActionButton></div>}

      <nav className="pill-row" aria-label="Filter by category" style={{ marginBottom: 16 }}>
        <Link href="/portal/services" className="pill" aria-current={!cat ? "true" : undefined}>All</Link>
        {(Object.keys(SERVICE_CATEGORIES) as ServiceCategory[]).map((k) => (
          <Link key={k} href={`/portal/services?c=${k}`} className="pill" aria-current={cat === k ? "true" : undefined}>{SERVICE_CATEGORIES[k]}</Link>
        ))}
      </nav>

      {shown.length === 0 ? <div className="glass panel"><Empty icon="store" title="No services in this category yet" /></div> : (
        <div className="grid grid-3 stagger" style={{ alignItems: "stretch" }}>
          {shown.map((s, i) => {
            const req = openReq.get(s.id);
            const owned = m.owned.includes(s.slug);
            return (
              <article key={s.id} className="glass service-card">
                <div className="row-between" style={{ alignItems: "flex-start" }}>
                  <span className={`tint ${TINTS[i % 4]}`} aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12 }}><Icon name={ICONS[s.icon] ?? "grid"} /></span>
                  {owned ? <Badge tone="green" plain>You have this</Badge> : recIds.has(s.id) ? <Badge tone="violet" plain>For you</Badge> : null}
                </div>
                <div><h3>{s.name}</h3><p className="small muted" style={{ margin: "4px 0 0" }}>{s.summary}</p></div>
                {s.benefits.length > 0 && <ul className="benefits">{s.benefits.map((b) => <li key={b}>{b}</li>)}</ul>}
                <p style={{ margin: "auto 0 0", fontWeight: 600 }}>{s.price_label || "Quote on request"}</p>
                <div className="row" style={{ gap: 8 }}>
                  {s.details && <details className="small" style={{ flexBasis: "100%" }}><summary className="btn btn-sm btn-ghost">View details</summary><p className="muted pre" style={{ marginTop: 8 }}>{s.details}</p></details>}
                  {req ? <span className="badge blue plain">Requested · {INQUIRY_STATUSES[req.status]}</span> : <RequestUpgrade serviceId={s.id} name={s.name} />}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Panel title="Your requests" className="section" sub="We reply within one working day. Nothing is charged until you accept a proposal.">
        {m.inquiries.length === 0 ? <p className="small muted" style={{ margin: 0 }}>You haven&apos;t requested anything yet.</p> : (
          <div className="list">
            {m.inquiries.map((q) => (
              <div key={q.id} className="list-item">
                <div className="grow"><div style={{ fontWeight: 500 }}>{q.service_name}</div><div className="small faint">Requested {fmtDate(q.created_at)}{q.note ? ` · “${q.note.slice(0, 80)}”` : ""}</div></div>
                <Badge tone={q.status === "proposal_sent" ? "green" : q.status === "closed" ? "" : "blue"} plain>{INQUIRY_STATUSES[q.status]}</Badge>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
