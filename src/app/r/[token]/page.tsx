import { headers } from "next/headers";
import { landing, ENQUIRY_SERVICES } from "@/server/referral-public";
import { EnquiryForm } from "@/components/referrals/public-forms";
import { Toaster } from "@/components/forms";
import { company } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Infinity Web & Apps — a recommendation for your business" };

export default async function ReferralLanding({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const page = await landing(token, (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null);
  if (!page) {
    return (
      <div className="auth"><div className="glass auth-card" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "1.3rem" }}>This link isn&apos;t active</h1>
        <p className="muted small">The referral link may have expired or been turned off. You can still reach {company().name} directly{company().email ? <> at <a href={`mailto:${company().email}`}>{company().email}</a></> : ""}.</p>
      </div></div>
    );
  }
  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 16px 64px" }} className="stack">
      <Toaster />
      <div className="brand" style={{ justifyContent: "flex-start" }}><span className="brand-mark" aria-hidden="true">∞</span>
        <span><span className="brand-name">{page.company}</span><br /><span className="brand-sub">Websites · Apps · AI automation</span></span></div>
      <section className="glass hero" style={{ padding: "34px 30px" }}>
        <div style={{ position: "relative", zIndex: 1 }} className="stack-sm">
          <span className="eyebrow">Recommended by one of our clients</span>
          <h1 style={{ fontSize: "clamp(1.7rem, 4vw, 2.5rem)", margin: 0 }}>{page.headline}</h1>
          <p className="muted" style={{ maxWidth: 640, margin: 0 }}>{page.intro}</p>
          <div><a href="#enquiry" className="btn btn-primary btn-lg">Request a free consultation</a></div>
        </div>
      </section>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="glass panel"><h2 style={{ fontSize: "1.05rem" }}>What we build</h2>
          <ul style={{ paddingLeft: 18, lineHeight: 1.9, margin: 0 }}>{page.services.map((s) => <li key={s}>{s}</li>)}</ul></section>
        <section className="glass panel"><h2 style={{ fontSize: "1.05rem" }}>Problems we solve</h2>
          <ul style={{ paddingLeft: 18, lineHeight: 1.9, margin: 0 }}>{page.problems.map((s) => <li key={s}>{s}</li>)}</ul></section>
      </div>
      {page.testimonials.length > 0 && (
        <section className="stack-sm"><h2 style={{ fontSize: "1.05rem" }}>What our clients say</h2>
          <div className="grid grid-3">{page.testimonials.map((t, i) => (
            <figure key={i} className="glass panel" style={{ margin: 0 }}>
              <div aria-label={`${t.rating} out of 5 stars`} style={{ color: "var(--amber)" }}>{"★".repeat(t.rating)}<span className="faint">{"★".repeat(5 - t.rating)}</span></div>
              <blockquote style={{ margin: "8px 0" }} className="small">“{t.quote}”</blockquote>
              <figcaption className="tiny faint">{t.name}</figcaption>
            </figure>
          ))}</div>
        </section>
      )}
      <section id="enquiry" className="glass panel">
        <h2 style={{ fontSize: "1.15rem" }}>Tell us about your business</h2>
        <p className="small muted" style={{ marginTop: 0 }}>We&apos;ll reply within one working day. You can also book a free discovery call right after sending this.</p>
        <EnquiryForm token={token} services={ENQUIRY_SERVICES} />
      </section>
      <p className="tiny faint" style={{ textAlign: "center" }}>{page.company}. We only use your details to respond to your enquiry.</p>
    </main>
  );
}
