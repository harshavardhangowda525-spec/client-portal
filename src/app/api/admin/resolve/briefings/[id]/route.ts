import { withActor } from "@/lib/http";
import { getBriefing } from "@/server/resolve";

/** Shows a stored email briefing exactly as sent (admin only, sandboxed). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withActor(async (actor) => {
    const b = await getBriefing(actor, id);
    return new Response(b.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" } });
  });
}
