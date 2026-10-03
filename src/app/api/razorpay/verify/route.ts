import { NextResponse } from "next/server";
import { withActor, sameOrigin } from "@/lib/http";
import { verifyPayment } from "@/server/razorpay";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return withActor(async (actor) => {
    const b = (await req.json().catch(() => ({}))) as Record<string, string>;
    const paymentId = await verifyPayment(actor, { orderId: String(b.orderId ?? ""), paymentId: String(b.paymentId ?? ""), signature: String(b.signature ?? "") });
    return NextResponse.json({ ok: true, paymentId });
  });
}
