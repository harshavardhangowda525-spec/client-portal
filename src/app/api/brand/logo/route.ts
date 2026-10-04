import { getLogo } from "@/server/pricing";

export async function GET() {
  const logo = await getLogo();
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: { "Content-Type": logo.mime_type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
