import { requireClient } from "@/lib/session";
import { PageHead, Panel } from "@/components/ui";
import { PasswordForm } from "@/components/views/password-form";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const actor = await requireClient();
  return (
    <div className="narrow-wrap">
      <PageHead title="Account" sub={actor.email} />
      <Panel title="Change password"><PasswordForm /></Panel>
    </div>
  );
}
