import { requireClient } from "@/lib/session";
import { listThread, markThreadRead } from "@/server/content";
import { PageHead } from "@/components/ui";
import { Chat } from "@/components/views/chat";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const actor = await requireClient();
  const { projectId } = await params;
  const messages = await listThread(actor, projectId);
  await markThreadRead(actor, projectId);
  return (
    <div className="narrow-wrap">
      <PageHead eyebrow="Communication" title="Messages" sub="Talk directly with the Infinity Web & Apps team about your project." />
      <Chat projectId={projectId} messages={messages} meId={actor.userId} />
    </div>
  );
}
