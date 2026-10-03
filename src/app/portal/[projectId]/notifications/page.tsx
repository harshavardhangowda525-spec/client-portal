import { requireClient } from "@/lib/session";
import { listNotifications } from "@/server/content";
import { NotificationList } from "@/components/views/notifications";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const actor = await requireClient();
  const items = await listNotifications(actor, 100);
  return (
    <div className="narrow-wrap">
      <PageHead title="Notifications" />
      <NotificationList items={items} />
    </div>
  );
}
