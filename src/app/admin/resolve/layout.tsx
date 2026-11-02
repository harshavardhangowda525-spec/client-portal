import { Suspense } from "react";
import { requireAdmin } from "@/lib/session";
import { PageHead } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { runResolveJobAction } from "@/app/actions/resolve";
import { ResolveTabs } from "./tabs";

export default async function ResolveLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <PageHead title="Infinity Resolve" sub="Client requests clarified by AI, communication gaps, your action items and email briefings."
        actions={<ActionButton action={runResolveJobAction} className="btn">Run gap check now</ActionButton>} />
      <Suspense><ResolveTabs /></Suspense>
      {children}
    </>
  );
}
