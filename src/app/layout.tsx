import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Project Portal — Infinity Web & Apps", template: "%s · Infinity Web & Apps" },
  description: "Private client project portal for Infinity Web & Apps.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#050a18", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
