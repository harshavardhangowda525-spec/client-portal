import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { withActor } from "@/lib/http";
import { myReferrals } from "@/server/referrals";

/** QR code (SVG) of the signed-in client's own referral link. */
export async function GET() {
  return withActor(async (actor) => {
    const r = await myReferrals(actor);
    if (!r.link || r.link.status !== "active") return NextResponse.json({ error: "No active link" }, { status: 404 });
    const svg = await QRCode.toString(r.link.url, { type: "svg", margin: 2, width: 240, color: { dark: "#000000", light: "#ffffff" } });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  });
}
