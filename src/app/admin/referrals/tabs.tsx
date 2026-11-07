"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: [string, string][] = [["/admin/referrals", "Referral intelligence"], ["/admin/referrals/leads", "Leads & pipeline"], ["/admin/referrals/calls", "Discovery calls"],
  ["/admin/referrals/feedback", "Client feedback"], ["/admin/referrals/automation", "Automation log"], ["/admin/referrals/settings", "Settings"]];

export function ReferralTabs() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Referral sections">
      {TABS.map(([href, label]) => <Link key={href} href={href} aria-current={(href === "/admin/referrals" ? path === href : path.startsWith(href)) ? "page" : undefined}>{label}</Link>)}
    </nav>
  );
}
