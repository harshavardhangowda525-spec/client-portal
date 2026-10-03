import { requireAdmin } from "@/lib/session";
import { listNotifications } from "@/server/content";
import { NotificationList } from "@/components/views/notifications";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function AdminNotifications() {
  const actor = await requireAdmin();
  return <div className="narrow-wrap"><PageHead title="Notifications" sub="Client acceptances, feedback, messages and uploads." /><NotificationList items={await listNotifications(actor, 100)} /></div>;
}
