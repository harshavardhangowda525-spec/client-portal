import { requireAdmin } from "@/lib/session";
import { listThread, markThreadRead } from "@/server/content";
import { Chat } from "@/components/views/chat";

export const dynamic = "force-dynamic";

export default async function AdminMessages({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireAdmin();
  const { projectId } = await params;
  const messages = await listThread(actor, projectId);
  await markThreadRead(actor, projectId);
  return <div className="narrow-wrap"><Chat projectId={projectId} messages={messages} meId={actor.userId} /></div>;
}
