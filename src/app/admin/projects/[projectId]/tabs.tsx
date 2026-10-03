"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProjectTabs({ projectId, unread }: { projectId: string; unread: number }) {
  const path = usePathname();
  const base = `/admin/projects/${projectId}`;
  const tabs = [
    ["", "Overview"], ["/milestones", "Milestones"], ["/quotations", "Quotations"], ["/previews", "Previews"], ["/updates", "Updates"],
    ["/billing", "Invoices & payments"], ["/documents", "Documents"], ["/messages", `Messages${unread ? ` (${unread})` : ""}`], ["/activity", "Activity"],
  ];
  return (
    <nav className="tabs" aria-label="Project sections">
      {tabs.map(([href, label]) => {
        const full = base + href;
        const active = href === "" ? path === base : path.startsWith(full);
        return <Link key={href} href={full} aria-current={active ? "page" : undefined}>{label}</Link>;
      })}
    </nav>
  );
}
