"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";

const LANGS: [string, string][] = [["", "Auto-detect language"], ["en", "English"], ["hi", "Hindi"], ["ta", "Tamil"], ["te", "Telugu"], ["kn", "Kannada"],
  ["ml", "Malayalam"], ["mr", "Marathi"], ["bn", "Bengali"], ["gu", "Gujarati"], ["pa", "Punjabi"], ["ur", "Urdu"]];
const MAX_SECONDS = 180;

/**
 * Record → play back / cancel → transcribe (Groq Whisper, server-side) → the transcript is handed back for the client to correct.
 * Audio is uploaded only when the client asks to transcribe; it is kept only if they tick the consent box.
 */
export function VoiceRecorder({ projectId, retentionDays, onTranscript }: {
  projectId: string; retentionDays: number; onTranscript: (text: string, documentId: string | null) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "recorded" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState("");
  const [keep, setKeep] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Voice recording isn't supported in this browser. Please type your request."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const b = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        setBlob(b); setUrl(URL.createObjectURL(b)); setState("recorded");
      };
      rec.current = r;
      r.start(1000);
      setSeconds(0); setState("recording");
      timer.current = setInterval(() => setSeconds((s) => { if (s + 1 >= MAX_SECONDS) stop(); return s + 1; }), 1000);
    } catch {
      setError("We couldn't access your microphone. Allow microphone access in your browser, or type your request.");
    }
  }
  function stop() {
    if (timer.current) clearInterval(timer.current);
    if (rec.current?.state === "recording") rec.current.stop();
  }
  function cancel() {
    stop(); setBlob(null); setUrl(null); setState("idle"); setSeconds(0);
  }
  async function send() {
    if (!blob) return;
    setState("sending"); setError(null);
    const fd = new FormData();
    fd.append("audio", blob, `voice.${blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm"}`);
    fd.append("project_id", projectId);
    fd.append("language", lang);
    if (keep) fd.append("keep", "1");
    try {
      const res = await fetch("/api/resolve/voice", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      if (j.error) { setError(j.error); setState("recorded"); return; }
      onTranscript(j.text, j.documentId ?? null);
      cancel();
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Please try again."); setState("recorded");
    }
  }
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="stack-sm voice-recorder">
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        {state === "idle" && <button type="button" className="btn btn-primary" onClick={start}><Icon name="mic" /> Start recording</button>}
        {state === "recording" && <>
          <span className="rec-dot" aria-hidden="true" /> <strong className="mono" aria-live="polite">{mmss}</strong>
          <span className="tiny faint">/ 3:00</span>
          <button type="button" className="btn btn-primary" onClick={stop}>Stop</button>
          <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel</button>
        </>}
        {(state === "recorded" || state === "sending") && url && <>
          <audio controls src={url} style={{ maxWidth: "100%" }} aria-label="Your recording" />
          <button type="button" className="btn btn-primary" onClick={send} disabled={state === "sending"}>
            {state === "sending" && <span className="spinner" aria-hidden="true" />} {state === "sending" ? "Transcribing…" : "Transcribe"}</button>
          <button type="button" className="btn btn-ghost" onClick={cancel} disabled={state === "sending"}>Discard</button>
        </>}
      </div>
      {state !== "recording" && (
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label className="small muted row" style={{ gap: 6 }}>Language
            <select className="select" style={{ width: 190 }} value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="check small"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>Keep my recording for the team (deleted after {retentionDays} days)</span></label>
        </div>
      )}
      {error && <div className="notice warn small" role="alert">{error}</div>}
    </div>
  );
}
