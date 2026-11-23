import Link from "next/link";
import { notFound } from "next/navigation";
import { publishedItem } from "@/server/showcase";
import { Compare } from "../compare";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const i = await publishedItem((await params).slug);
  return { title: i ? i.title : "Case study" };
}

export default async function CaseStudy({ params }: { params: Promise<{ slug: string }> }) {
  const i = await publishedItem((await params).slug);
  if (!i) notFound();
  return (
    <article className="stack" style={{ gap: 24, maxWidth: 900 }}>
      <Link href="/showcase" className="small">← All work</Link>
      <div className="row"><span className="badge violet plain">{i.industry}</span><span className="badge plain">{i.service_type}</span></div>
      <h1 style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)", letterSpacing: "-0.02em" }}>{i.title}</h1>
      <p className="muted" style={{ fontSize: "1.05rem", margin: 0 }}>{i.client_label} · {i.summary}</p>
      {i.has_before_image && i.has_after_image ? <Compare before={`/api/showcase/${i.id}/before`} after={`/api/showcase/${i.id}/after`} label={i.title} />
        // eslint-disable-next-line @next/next/no-img-element
        : i.has_after_image ? <img src={`/api/showcase/${i.id}/after`} alt={`${i.title} screenshot`} style={{ width: "100%", borderRadius: 14 }} /> : null}
      {i.metrics.length > 0 && (
        <div className="grid grid-3">{i.metrics.map((m) => (
          <div key={m.label} className="glass panel"><div className="stat-value">{m.value}</div><div className="small faint">{m.label}</div></div>
        ))}</div>
      )}
      {i.story && <div className="glass panel"><p className="pre" style={{ margin: 0, lineHeight: 1.7 }}>{i.story}</p></div>}
      <div className="row">
        {i.live_url && <a className="btn" href={i.live_url} target="_blank" rel="noopener noreferrer">Visit the live site</a>}
        <Link href="/login" className="btn btn-primary">Start your project</Link>
      </div>
      <p className="tiny faint">Shared with the client&apos;s permission.</p>
    </article>
  );
}
