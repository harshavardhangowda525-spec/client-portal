"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

/** Dark/light switch. The choice is kept in a cookie so the server renders the right theme on the next visit. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, []);
  const next = theme === "dark" ? "light" : "dark";
  const flip = () => {
    document.documentElement.dataset.theme = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "light" ? "#f4f6fb" : "#050a18");
    setTheme(next);
  };
  const label = `Switch to ${next} mode`;
  return compact ? (
    <button type="button" className="btn btn-ghost icon-btn" onClick={flip} aria-label={label} title={label}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
  ) : (
    <button type="button" className="btn btn-ghost btn-sm btn-block" style={{ justifyContent: "flex-start" }} onClick={flip}><Icon name={theme === "dark" ? "sun" : "moon"} /> {theme === "dark" ? "Light mode" : "Dark mode"}</button>
  );
}
