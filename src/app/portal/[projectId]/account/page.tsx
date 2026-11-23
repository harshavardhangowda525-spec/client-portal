import { requireClient } from "@/lib/session";
import { PageHead, Panel } from "@/components/ui";
import { PasswordForm } from "@/components/views/password-form";
import { getPreferences } from "@/server/preferences";
import { PreferencesForm } from "./preferences";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const actor = await requireClient();
  const prefs = await getPreferences(actor);
  return (
    <div className="narrow-wrap stack" style={{ gap: 16 }}>
      <PageHead title="Account" sub={actor.email} />
      <Panel title="Notify me by" sub="Invoices, proposals and security emails are always sent. These settings cover optional updates.">
        <PreferencesForm prefs={{ email: prefs.notify_email, whatsapp: prefs.notify_whatsapp, consentAt: prefs.whatsapp_consent_at ? String(prefs.whatsapp_consent_at) : null,
          phone: prefs.phone, available: prefs.whatsappAvailable }} />
      </Panel>
      <Panel title="Change password"><PasswordForm /></Panel>
    </div>
  );
}
