"use client";

import { useState, useTransition } from "react";
import { bookingLinkAction } from "@/app/actions/referrals";
import { CopyButton } from "@/components/forms";

export function BookingLink({ leadId }: { leadId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="stack-sm">
      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => { const r = await bookingLinkAction(leadId); if (r?.ok) setUrl(String(r.data?.url)); })}>
        Create booking link for the prospect</button>
      {url && <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><code className="tiny" style={{ wordBreak: "break-all" }}>{url}</code><CopyButton text={url} /></div>}
      <span className="tiny faint">Creating a new link turns off the previous one.</span>
    </div>
  );
}
