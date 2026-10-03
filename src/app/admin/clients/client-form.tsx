"use client";

import { ActionForm, Submit } from "@/components/forms";
import type { ActionState } from "@/app/actions/run";

type Client = { business_name?: string; owner_name?: string; email?: string; phone?: string | null; business_category?: string | null; address?: string | null };

export function ClientForm({ action, client, submitLabel }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; client?: Client; submitLabel: string }) {
  return (
    <ActionForm action={action} className="form-grid">
      <div className="field"><label htmlFor="business_name">Business name</label><input id="business_name" name="business_name" className="input" required maxLength={200} defaultValue={client?.business_name} placeholder="e.g. Brew & Bloom Cafe" /></div>
      <div className="field"><label htmlFor="business_category">Business category</label>
        <input id="business_category" name="business_category" className="input" list="cats" maxLength={100} defaultValue={client?.business_category ?? ""} placeholder="Cafe / restaurant" />
        <datalist id="cats">{["Cafe / restaurant", "Bakery", "Salon & spa", "Retail store", "Clinic", "Fitness studio", "Real estate", "Education", "Professional services"].map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="field"><label htmlFor="owner_name">Owner name</label><input id="owner_name" name="owner_name" className="input" required maxLength={200} defaultValue={client?.owner_name} /></div>
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" required defaultValue={client?.email} /></div>
      <div className="field"><label htmlFor="phone">Phone / WhatsApp</label><input id="phone" name="phone" className="input" maxLength={40} defaultValue={client?.phone ?? ""} placeholder="+91 98765 43210" /></div>
      <div className="field"><label htmlFor="address">Address</label><input id="address" name="address" className="input" maxLength={500} defaultValue={client?.address ?? ""} /></div>
      <div className="form-actions full"><Submit pendingText="Saving…">{submitLabel}</Submit></div>
    </ActionForm>
  );
}
