import Link from "next/link";
import { publishedShowcase } from "@/server/showcase";
import { getGrowthSettings } from "@/server/marketplace";
import { Empty } from "@/components/ui";
import { notFound } from "next/navigation";

export const metadata = { title: "Our work" };
export const dynamic = "force-dynamic";

export default async function ShowcasePage({ searchParams }: { searchParams: Promise<{ industry?: string }> }) {
  if (!(await getGrowthSettings()).showcase_enabled) notFound();
  const { industry } = await searchParams;
  const s = await publishedShowcase();
  const industries = [...new Set(s.items.map((i) => i.industry))].sort();
  const items = s.items.filter((i) => !industry || i.industry === industry);
  return (
    <div className="stack" style={{ gap: 32 }}>
      <section className="stack-sm" style={{ maxWidth: 720 }}>
        <span className="eyebrow">Our work</span>
        <h1 style={{ fontSize: "clamp(2rem, 4vw, 2.8rem)", letterSpacing: "-0.03em" }}>Work we&apos;re proud of, shared with our clients&apos; permission.</h1>
        <p className="muted" style={{ fontSize: "1.05rem" }}>Every name, screenshot, result and quote here was approved by the client before it went live.</p>
      </section>
      {industries.length > 1 && (
        <nav className="pill-row" aria-label="Filter by industry">
          <Link href="/showcase" className="pill" aria-current={!industry ? "true" : undefined}>All</Link>
          {industries.map((i) => <Link key={i} href={`/showcase?industry=${encodeURIComponent(i)}`} className="pill" aria-current={industry === i ? "true" : undefined}>{i}</Link>)}
        </nav>
      )}
      {items.length === 0 ? <div className="glass panel"><Empty icon="star" title="Case studies are on their way">We publish client stories only after they approve them.</Empty></div> : (
        <div className="grid grid-3 stagger">
          {items.map((i) => (
            <Link key={i.id} href={`/showcase/${i.slug}`} className="glass service-card" style={{ color: "var(--text)" }}>
              {i.has_after_image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/showcase/${i.id}/after`} alt={`${i.title} screenshot`} style={{ width: "100%", aspectRatio: "16/10", objectFit: "cover", borderRadius: 12 }} loading="lazy" />
                : <div style={{ aspectRatio: "16/10", borderRadius: 12, background: "linear-gradient(135deg, var(--blue), var(--violet))" }} aria-hidden="true" />}
              <div className="row"><span className="badge plain">{i.industry}</span><span className="badge plain">{i.service_type}</span></div>
              <h2 style={{ fontSize: "1.1rem" }}>{i.title}</h2>
              <p className="small muted" style={{ margin: 0 }}>{i.summary}</p>
              <span className="small" style={{ color: "var(--blue-2)", marginTop: "auto" }}>Read case study →</span>
            </Link>
          ))}
        </div>
      )}
      {s.testimonials.length > 0 && (
        <section className="stack" aria-labelledby="t-h">
          <h2 id="t-h">What clients say</h2>
          <div className="grid grid-3">
            {s.testimonials.map((t) => (
              <figure key={t.id} className="glass panel" style={{ margin: 0 }}>
                <blockquote style={{ margin: 0, fontSize: "1rem" }}>&ldquo;{t.quote}&rdquo;</blockquote>
                <figcaption className="small faint" style={{ marginTop: 12 }}>{t.display_name}{t.display_role ? `, ${t.display_role}` : ""}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
