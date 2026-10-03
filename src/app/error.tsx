"use client";

import { Empty } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="content narrow">
      <div className="glass panel">
        <Empty icon="alert" title="Something went wrong"
          action={<button className="btn btn-primary" onClick={reset}>Try again</button>}>
          {error.message && !error.message.includes("digest") && error.digest === undefined ? error.message : "We could not load this page. Please try again in a moment."}
          {error.digest && <span className="tiny faint" style={{ display: "block", marginTop: 8 }}>Reference: {error.digest}</span>}
        </Empty>
      </div>
    </div>
  );
}
