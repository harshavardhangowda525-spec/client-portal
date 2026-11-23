import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Project Portal — Infinity Web & Apps", template: "%s · Infinity Web & Apps" },
  description: "Private client project portal for Infinity Web & Apps.",
  robots: { index: false, follow: false },
};

export async function generateViewport(): Promise<Viewport> {
  const light = (await cookies()).get("theme")?.value === "light";
  return { themeColor: light ? "#f4f6fb" : "#050a18", width: "device-width", initialScale: 1 };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
