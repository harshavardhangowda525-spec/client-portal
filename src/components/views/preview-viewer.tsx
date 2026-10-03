"use client";

import { useState } from "react";
import { Icon } from "../icons";

export function PreviewViewer({ url, embedBlocked }: { url: string; embedBlocked: boolean }) {
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  if (embedBlocked) {
    return (
      <div className="glass panel">
        <div className="empty">
          <div className="icon"><Icon name="external" /></div>
          <h3>This preview opens in a new tab</h3>
          <p>The website&apos;s security settings do not allow it to be shown inside the portal.</p>
          <div style={{ marginTop: 16 }}><a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open preview</a></div>
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="row-between">
        <div className="seg" role="group" aria-label="Preview size">
          {(["desktop", "tablet", "mobile"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}>
              <span className="row" style={{ gap: 6 }}><Icon name={d === "desktop" ? "monitor" : d === "tablet" ? "tablet" : "phone"} />{d[0].toUpperCase() + d.slice(1)}</span>
            </button>
          ))}
        </div>
        <span className="tiny faint hide-sm">If the preview stays blank, use “Open in new tab”.</span>
      </div>
      <div className="frame-wrap">
        <iframe className="frame" data-device={device} src={url} title="Website preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" loading="lazy" />
      </div>
    </div>
  );
}
