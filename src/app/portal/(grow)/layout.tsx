import { requireClient } from "@/lib/session";
import { ClientShell } from "@/components/client-shell";

/** Account-level "Grow" pages (services, AI advisor, meetings) share the client shell. */
export default async function GrowLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClient();
  return <ClientShell actor={actor}>{children}</ClientShell>;
}
