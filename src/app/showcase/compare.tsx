"use client";

import { useState } from "react";

export function Compare({ before, after, label }: { before: string; after: string; label: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="stack-sm">
      <div className="compare" style={{ ["--pos" as string]: `${pos}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt={`${label}: after`} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt={`${label}: before`} className="before" />
        <span className="divider" aria-hidden="true" />
        <span className="tag" style={{ left: 10 }}>BEFORE</span><span className="tag" style={{ right: 10 }}>AFTER</span>
      </div>
      <label className="small muted">Drag to compare before and after
        <input type="range" min={5} max={95} value={pos} onChange={(e) => setPos(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--blue)" }} /></label>
    </div>
  );
}
