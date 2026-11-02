"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Polls for updates while a page is visible (there is no realtime channel). Pauses while the user is typing. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      const el = document.activeElement;
      const typing = el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && (el as HTMLInputElement).value;
      if (document.visibilityState === "visible" && !typing) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
