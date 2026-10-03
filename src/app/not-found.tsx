import Link from "next/link";
import { Empty } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="auth">
      <div className="glass auth-card">
        <Empty icon="alert" title="Page not found" action={<Link className="btn btn-primary" href="/">Go to your dashboard</Link>}>
          This page does not exist, or you do not have access to it.
        </Empty>
      </div>
    </div>
  );
}
