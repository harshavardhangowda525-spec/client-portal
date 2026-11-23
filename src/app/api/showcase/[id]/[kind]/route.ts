import { showcaseImage } from "@/server/showcase";
import { getActor } from "@/lib/session";
import { isUuid } from "@/server/core";

/** Before/after images: public only for published case studies (admins can preview drafts). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!isUuid(id) || (kind !== "before" && kind !== "after")) return new Response("Not found", { status: 404 });
  try {
    const img = await showcaseImage(id, kind, await getActor().catch(() => null));
    return new Response(new Uint8Array(img.data), { headers: { "Content-Type": img.mime_type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
