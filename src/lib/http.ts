import { NextResponse } from "next/server";
import { AppError } from "./errors";
import { getActor } from "./session";
import type { Actor } from "./db";

export async function withActor(fn: (actor: Actor) => Promise<Response>): Promise<Response> {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return await fn(actor);
  } catch (e) {
    if (e instanceof AppError) {
      const status = { forbidden: 403, not_found: 404, unauthenticated: 401, rate_limited: 429, conflict: 409, invalid: 400 }[e.code];
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error("[api]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** Reject cross-site POSTs to JSON endpoints (cookies are SameSite=Lax, this is defence in depth). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}

export function fileResponse(data: Uint8Array | Buffer, filename: string, mime: string, inline: boolean) {
  const safe = filename.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // PDFs need the browser viewer, which a sandboxed CSP blocks; everything else is fully sandboxed.
      ...(mime === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
    },
  });
}
