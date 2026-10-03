import { NextResponse } from "next/server";
import { handleWebhook } from "@/server/razorpay";

export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const r = await handleWebhook(raw, req.headers.get("x-razorpay-signature") ?? "");
    return NextResponse.json({ ok: r.ok }, { status: r.status });
  } catch (e) {
    console.error("[razorpay webhook]", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
