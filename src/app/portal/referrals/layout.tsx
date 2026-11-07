import { requireClient } from "@/lib/session";
import { ClientShell } from "@/components/client-shell";

export default async function ReferralsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClient();
  return <ClientShell actor={actor}>{children}</ClientShell>;
}
