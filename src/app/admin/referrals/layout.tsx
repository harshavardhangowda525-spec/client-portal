import { requireAdmin } from "@/lib/session";
import { PageHead } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { runReferralJobAction } from "@/app/actions/referrals";
import { ReferralTabs } from "./tabs";

export default async function ReferralsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <PageHead title="Referrals" sub="Feedback after completed projects, client referrals, leads, discovery calls and verified conversions."
        actions={<ActionButton action={runReferralJobAction} className="btn">Run reminders &amp; follow-ups now</ActionButton>} />
      <ReferralTabs />
      {children}
    </>
  );
}
