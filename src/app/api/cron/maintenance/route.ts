import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runMaintenanceJob } from "@/server/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Daily maintenance check. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await runMaintenanceJob({ trigger: "cron" });
    return NextResponse.json({ ok: summary.errors.length === 0, summary });
  } catch (e) {
    console.error("[cron maintenance]", e);
    return NextResponse.json({ ok: false, error: "Maintenance check failed" }, { status: 500 });
  }
}
export const POST = GET;
