import { bookingContext, fmtCall, MEETING_TYPES } from "@/server/booking";
import { SlotPicker, CancelBooking } from "@/components/referrals/public-forms";
import { Toaster } from "@/components/forms";
import { AppError } from "@/lib/errors";
import { company } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a discovery call" };

export default async function BookCall({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  const { token } = await params;
  const fresh = (await searchParams).new === "1";
  let ctx: Awaited<ReturnType<typeof bookingContext>>;
  try { ctx = await bookingContext(token); } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return <div className="auth"><div className="glass auth-card" style={{ textAlign: "center" }}><h1 style={{ fontSize: "1.3rem" }}>Link not valid</h1><p className="muted small">{e.message}</p></div></div>;
  }
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "28px 16px 64px" }} className="stack">
      <Toaster />
      <div className="brand"><span className="brand-mark" aria-hidden="true">∞</span><span><span className="brand-name">{company().name}</span><br /><span className="brand-sub">Free discovery call</span></span></div>
      {fresh && <div className="notice success">Thanks{ctx.lead.first_name ? `, ${ctx.lead.first_name}` : ""}! We&apos;ve received your enquiry for {ctx.lead.business_name}. We&apos;ll be in touch soon. Want to talk sooner? Pick a time below.</div>}
      {ctx.call && (
        <section className="glass panel stack-sm">
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Your call is booked</h2>
          <p style={{ margin: 0 }}><strong>{fmtCall(ctx.call.starts_at)}</strong> (India time) · {MEETING_TYPES[ctx.call.meeting_type]}</p>
          {ctx.call.meeting_link && <a href={ctx.call.meeting_link} target="_blank" rel="noopener noreferrer" className="small">{ctx.call.meeting_link}</a>}
          <div><CancelBooking token={token} /></div>
        </section>
      )}
      <section className="glass panel">
        <h2 style={{ fontSize: "1.05rem", marginTop: 0 }}>{ctx.call ? "Need a different time?" : "Choose a time for a free 30-minute call"}</h2>
        <SlotPicker token={token} days={ctx.days} meetingTypes={ctx.meetingTypes} hasBooking={!!ctx.call} />
      </section>
    </main>
  );
}
