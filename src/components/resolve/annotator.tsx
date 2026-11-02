"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "../icons";
import { VoiceRecorder } from "./voice-recorder";
import { pushToast } from "../forms";
import type { ActionState } from "@/app/actions/run";

type Pt = { x: number; y: number };
type Shape = { type: "rect" | "arrow"; a: Pt; b: Pt } | { type: "pen"; pts: Pt[] } | { type: "pin"; at: Pt; n: number };
type Tool = "rect" | "arrow" | "pen" | "pin";
const COLOR = "#ff3b5c";
const MAX_W = 1600;

/**
 * Screenshot-based visual feedback. The preview runs on another site, so the browser cannot read its elements;
 * instead the client captures or uploads a screenshot and marks it up. Shapes are stored in image coordinates.
 */
export function VisualFeedback({ projectId, previewId, previewUrl, retentionDays, action }: {
  projectId: string; previewId: string | null; previewUrl: string | null; retentionDays: number;
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>("rect");
  const [draft, setDraft] = useState<Shape | null>(null);
  const [pageUrl, setPageUrl] = useState(previewUrl ?? "");
  const [section, setSection] = useState("");
  const [comment, setComment] = useState("");
  const [voiceDoc, setVoiceDoc] = useState<string | null>(null);
  const [captureViewport, setCaptureViewport] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canvas = useRef<HTMLCanvasElement>(null);

  function load(src: string, viewport?: { width: number; height: number }) {
    const i = new Image();
    i.onload = () => { setImg(i); setShapes([]); setCaptureViewport(viewport ?? { width: i.naturalWidth, height: i.naturalHeight }); };
    i.onerror = () => setError("That image couldn't be opened. Use a PNG or JPEG screenshot.");
    i.src = src;
  }
  function onFile(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setError("Please choose a PNG, JPEG or WebP screenshot."); return; }
    if (f.size > 15 * 1024 * 1024) { setError("That image is too large."); return; }
    load(URL.createObjectURL(f));
  }
  async function capture() {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) { setError("Screen capture isn't available in this browser. Upload a screenshot instead."); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));
      const c = document.createElement("canvas");
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext("2d")!.drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      load(c.toDataURL("image/png"), { width: video.videoWidth, height: video.videoHeight });
    } catch {
      setError("Screen capture was cancelled. You can upload a screenshot instead.");
    }
  }

  // Draw image + shapes.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const scale = Math.min(1, MAX_W / img.naturalWidth);
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, c.width, c.height);
    const lw = Math.max(3, c.width / 300);
    g.strokeStyle = COLOR; g.fillStyle = COLOR; g.lineWidth = lw; g.lineCap = "round"; g.lineJoin = "round";
    for (const s of [...shapes, ...(draft ? [draft] : [])]) {
      if (s.type === "rect") g.strokeRect(s.a.x * scale, s.a.y * scale, (s.b.x - s.a.x) * scale, (s.b.y - s.a.y) * scale);
      if (s.type === "pen") { g.beginPath(); s.pts.forEach((p, i) => (i ? g.lineTo(p.x * scale, p.y * scale) : g.moveTo(p.x * scale, p.y * scale))); g.stroke(); }
      if (s.type === "arrow") {
        const [ax, ay, bx, by] = [s.a.x * scale, s.a.y * scale, s.b.x * scale, s.b.y * scale];
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
        const ang = Math.atan2(by - ay, bx - ax), h = lw * 5;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - h * Math.cos(ang - 0.45), by - h * Math.sin(ang - 0.45)); g.lineTo(bx - h * Math.cos(ang + 0.45), by - h * Math.sin(ang + 0.45)); g.closePath(); g.fill();
      }
      if (s.type === "pin") {
        const r = lw * 4;
        g.beginPath(); g.arc(s.at.x * scale, s.at.y * scale, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#fff"; g.font = `bold ${Math.round(r * 1.2)}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(s.n), s.at.x * scale, s.at.y * scale + 1); g.fillStyle = COLOR;
      }
    }
  }, [img, shapes, draft]);

  const toImage = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * img!.naturalWidth, y: ((e.clientY - r.top) / r.height) * img!.naturalHeight };
  };
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    if (tool === "pin") { setShapes((s) => [...s, { type: "pin", at: p, n: s.filter((x) => x.type === "pin").length + 1 }]); return; }
    setDraft(tool === "pen" ? { type: "pen", pts: [p] } : { type: tool, a: p, b: p });
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!draft) return;
    const p = toImage(e);
    setDraft(draft.type === "pen" ? { type: "pen", pts: [...draft.pts, p] } : { ...draft, b: p } as Shape);
  }
  function up() { if (draft) { setShapes((s) => [...s, draft]); setDraft(null); } }

  async function exportImage(): Promise<Blob> {
    const c = canvas.current!;
    let blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob || blob.size > 3.5 * 1024 * 1024) blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    if (!blob) throw new Error("Couldn't export the screenshot.");
    return blob;
  }
  function submit() {
    setError(null);
    if (!img) { setError("Add a screenshot first."); return; }
    if (comment.trim().length < 2) { setError("Describe what you'd like changed."); return; }
    start(async () => {
      try {
        const blob = await exportImage();
        const fd = new FormData();
        fd.append("message", comment.trim());
        fd.append("source", "visual");
        if (previewId) fd.append("preview_id", previewId);
        fd.append("screenshots", blob, blob.type === "image/png" ? "annotated-screenshot.png" : "annotated-screenshot.jpg");
        if (voiceDoc) fd.append("document_ids", voiceDoc);
        fd.append("details", JSON.stringify({ page_url: pageUrl || null, section: section || null, viewport: captureViewport,
          annotations: shapes.map((s) => s.type === "pen" ? { type: "pen", points: s.pts.length } : s) }));
        const r = await action(null, fd);
        if (r && !r.ok) { setError(r.error ?? "Something went wrong."); pushToast(r.error ?? "Something went wrong.", true); }
      } catch (e) {
        if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw e;
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="stack">
      {!img ? (
        <div className="stack-sm">
          <p className="small muted" style={{ margin: 0 }}>Open your website preview in another tab, then capture it here, or upload a screenshot from your phone or computer.</p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={capture}><Icon name="monitor" /> Capture my screen</button>
            <label className="btn"><Icon name="upload" /> Upload screenshot
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Upload screenshot" /></label>
            {previewUrl && <a className="btn btn-ghost" href={previewUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open preview</a>}
          </div>
        </div>
      ) : (
        <>
          <div className="row seg-tools" style={{ flexWrap: "wrap", gap: 6 }} role="toolbar" aria-label="Annotation tools">
            {([["rect", "Box"], ["arrow", "Arrow"], ["pen", "Draw"], ["pin", "Numbered pin"]] as [Tool, string][]).map(([t, l]) => (
              <button key={t} type="button" className="btn btn-sm" aria-pressed={tool === t} onClick={() => setTool(t)}>{l}</button>
            ))}
            <span className="spacer" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShapes((s) => s.slice(0, -1))} disabled={!shapes.length}>Undo</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShapes([])} disabled={!shapes.length}>Clear</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setImg(null); setShapes([]); }}>Change screenshot</button>
          </div>
          <div className="annotator"><canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Screenshot — draw to mark what should change" /></div>
          <span className="tiny faint">{shapes.length} mark(s) · {captureViewport ? `${captureViewport.width}×${captureViewport.height}px` : ""}</span>
        </>
      )}
      <div className="form-grid">
        <label className="field"><span className="label">Page URL</span><input className="input" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://…/menu" maxLength={500} /></label>
        <label className="field"><span className="label">Section (optional)</span><input className="input" value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. Hero, footer, contact form" maxLength={200} /></label>
        <label className="field full"><span className="label">What should change?</span>
          <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={10000} placeholder="e.g. Pin 1: make this banner smaller. Pin 2: use our new logo." /></label>
      </div>
      <details>
        <summary className="small" style={{ cursor: "pointer" }}><Icon name="mic" /> Explain by voice instead</summary>
        <div style={{ marginTop: 10 }}>
          <VoiceRecorder projectId={projectId} retentionDays={retentionDays} onTranscript={(t, doc) => { setComment((c) => (c ? `${c}\n${t}` : t)); if (doc) setVoiceDoc(doc); }} />
        </div>
      </details>
      {error && <div className="notice error small" role="alert">{error}</div>}
      <div><button type="button" className="btn btn-primary" onClick={submit} disabled={pending}>{pending && <span className="spinner" aria-hidden="true" />} Send feedback</button></div>
    </div>
  );
}
