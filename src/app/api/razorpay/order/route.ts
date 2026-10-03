import { NextResponse } from "next/server";
import { withActor, sameOrigin } from "@/lib/http";
import { createOrder } from "@/server/razorpay";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return withActor(async (actor) => {
    const body = (await req.json().catch(() => ({}))) as { invoiceId?: string };
    return NextResponse.json(await createOrder(actor, String(body.invoiceId ?? "")));
  });
}
