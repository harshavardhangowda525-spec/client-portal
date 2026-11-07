"use client";

import { useState } from "react";
import { CopyButton } from "../forms";
import { Icon } from "../icons";

/** Copy, native share, WhatsApp and email. Nothing is sent automatically — the client shares it themselves. */
export function ShareTools({ url, template }: { url: string; template: string }) {
  const [message, setMessage] = useState(template.replace("{{link}}", url));
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div className="stack-sm">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <code className="small" style={{ wordBreak: "break-all", flex: "1 1 260px" }}>{url}</code>
        <CopyButton text={url} label="Copy link" />
      </div>
      <label className="field"><span className="label">Your message</span>
        <textarea className="textarea" style={{ minHeight: 90 }} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500} /></label>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
        <a className="btn" href={`mailto:?subject=${encodeURIComponent("A recommendation for your business")}&body=${encodeURIComponent(message)}`}><Icon name="send" /> Email</a>
        {canShare && <button type="button" className="btn" onClick={() => navigator.share({ text: message }).catch(() => undefined)}>More options…</button>}
        <CopyButton text={message} label="Copy message" />
      </div>
    </div>
  );
}
