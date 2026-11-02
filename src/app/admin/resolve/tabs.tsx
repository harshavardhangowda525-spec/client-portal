"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS: [string, string][] = [
  ["/admin/resolve", "All requests"], ["/admin/resolve?view=summaries", "AI conversation summaries"], ["/admin/resolve/gaps", "Communication gaps"],
  ["/admin/resolve?view=approvals", "Pending approvals"], ["/admin/resolve/actions", "My action items"], ["/admin/resolve?view=assigned", "Developer tasks"],
  ["/admin/resolve/briefings", "Email briefings"], ["/admin/resolve/logs", "AI activity"], ["/admin/resolve/settings", "Settings"],
];

export function ResolveTabs() {
  const path = usePathname();
  const view = useSearchParams().get("view");
  return (
    <nav className="tabs" aria-label="Infinity Resolve sections">
      {TABS.map(([href, label]) => {
        const [p, q] = href.split("?view=");
        const active = path === p && (q ? view === q : p !== "/admin/resolve" || !view);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined}>{label}</Link>;
      })}
    </nav>
  );
}
