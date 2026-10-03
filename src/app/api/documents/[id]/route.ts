import { withActor, fileResponse } from "@/lib/http";
import { readDocument } from "@/server/content";

// Only these types are rendered inline; everything else (including SVG/HTML-like content) downloads.
const INLINE = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withActor(async (actor) => {
    const doc = await readDocument(actor, id);
    const download = new URL(req.url).searchParams.has("download");
    return fileResponse(doc.data, doc.name, doc.mime_type, !download && INLINE.test(doc.mime_type));
  });
}
