import { NextResponse } from "next/server";
import { withActor, sameOrigin } from "@/lib/http";
import { transcribe } from "@/server/ai";
import { storeAttachment, MAX_ATTACHMENT_BYTES } from "@/server/resolve";
import { getProjectFor, withDb } from "@/server/core";
import { AppError } from "@/lib/errors";

export const maxDuration = 60;
const LANGS = new Set(["en", "hi", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa", "ur"]);

/** Transcribe a client's voice note (Groq Whisper). The audio is stored only if the client consents. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return withActor(async (actor) => {
    if (actor.role !== "client" || actor.viewAs) throw new AppError("Only clients can send voice requests.");
    const fd = await req.formData();
    const audio = fd.get("audio");
    const projectId = String(fd.get("project_id") ?? "");
    if (!(audio instanceof File) || audio.size === 0) throw new AppError("No recording received.");
    if (audio.size > MAX_ATTACHMENT_BYTES) throw new AppError("That recording is too long. Please keep voice notes under 3 minutes.");
    await withDb(actor, (tx) => getProjectFor(tx, actor, projectId));
    const data = Buffer.from(await audio.arrayBuffer());
    const lang = String(fd.get("language") ?? "");
    const r = await transcribe({ data, type: audio.type || "audio/webm", name: audio.name || "voice.webm" }, { projectId, language: LANGS.has(lang) ? lang : null });
    let documentId: string | null = null;
    if (fd.get("keep") === "1") documentId = await storeAttachment(actor, projectId, { name: "voice-note.webm", type: audio.type || "audio/webm", data }, { kind: "voice" });
    if (!r.ok) {
      return NextResponse.json({ text: "", documentId, error: r.status === "not_configured"
        ? "Voice transcription isn't set up yet. Please type your request instead."
        : "We couldn't transcribe that recording. Please try again or type your request." }, { status: 200 });
    }
    return NextResponse.json({ text: r.data.text, language: r.data.language, documentId });
  });
}
