import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runResolveJob } from "@/server/resolve-email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Daily Infinity Resolve job (gap detection, retries, retention, daily summary). Vercel Cron sends Bearer $CRON_SECRET. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, result: await runResolveJob() });
  } catch (e) {
    console.error("[cron resolve]", e);
    return NextResponse.json({ ok: false, error: "Resolve job failed" }, { status: 500 });
  }
}
export const POST = GET;
