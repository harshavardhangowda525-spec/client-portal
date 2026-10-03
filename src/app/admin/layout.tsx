import { requireAdmin } from "@/lib/session";
import { AdminShell } from "@/components/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAdmin();
  return <AdminShell actor={actor}>{children}</AdminShell>;
}
