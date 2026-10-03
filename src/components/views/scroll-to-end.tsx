"use client";

import { useEffect, useRef } from "react";

export function ScrollToEnd() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "end" }); });
  return <span ref={ref} aria-hidden="true" />;
}
