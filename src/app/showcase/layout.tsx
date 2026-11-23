import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { company } from "@/lib/config";

export const metadata = { robots: { index: true, follow: true } };

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  const c = company();
  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="row-between" style={{ padding: "16px clamp(16px, 4vw, 56px)", borderBottom: "1px solid var(--border)" }}>
        <Link href="/showcase" className="brand"><span className="brand-mark" aria-hidden="true">∞</span><span><span className="brand-name">{c.name}</span><br /><span className="brand-sub">Websites. Mobile Apps. Digital Growth.</span></span></Link>
        <div className="row"><ThemeToggle compact /><Link href="/login" className="btn btn-sm">Client login</Link></div>
      </header>
      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "40px clamp(16px, 4vw, 56px) 64px" }}>{children}</main>
    </div>
  );
}
