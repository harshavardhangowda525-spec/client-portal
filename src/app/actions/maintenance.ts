"use server";

import * as MT from "@/server/maintenance";
import { run, form, checkbox, type ActionState } from "./run";
import { requestMeta } from "@/lib/session";
import { AppError } from "@/lib/errors";

// ---- admin ----
export async function saveMaintenanceSettingsAction(_: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const current = await MT.getMaintenanceSettings();
    const v = form(fd);
    await MT.saveMaintenanceSettings(a, { ...current, ...v, templates: current.templates });
    return "Maintenance settings saved.";
  });
}

export async function saveTemplateAction(kind: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    if (!(kind in MT.NOTIFICATION_KINDS)) throw new AppError("Unknown template.");
    const current = await MT.getMaintenanceSettings();
    const reset = fd.get("reset") === "1";
    const templates = { ...current.templates };
    if (reset) delete templates[kind as MT.NotificationKind];
    else templates[kind as MT.NotificationKind] = { subject: String(fd.get("subject") ?? ""), body: String(fd.get("body") ?? "") };
    await MT.saveMaintenanceSettings(a, { ...current, templates });
    return reset ? "Template reset to the default." : "Template saved.";
  });
}

export async function savePaymentDetailsAction(_: ActionState, fd: FormData) {
  return run("admin", async (a) => { await MT.savePaymentDetails(a, form(fd)); return "Payment details saved."; });
}

export async function runMaintenanceCheckAction() {
  return run("admin", async () => {
    const r = await MT.runMaintenanceJob({ trigger: "admin" });
    if (r.errors.length) return `Check finished with ${r.errors.length} problem(s): ${r.errors[0]}`;
    const sent = Object.entries(r.notifications).filter(([k]) => k.endsWith(":sent")).reduce((s, [, n]) => s + n, 0);
    return `Checked ${r.projects} project(s): ${sent} message(s) sent, ${r.invoices} invoice(s) issued.`;
  });
}

export async function updateProjectMaintenanceAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    await MT.updateProjectMaintenance(a, projectId, {
      ...form(fd),
      reset_dates: checkbox(fd, "reset_dates"),
      maintenance_exempt: checkbox(fd, "maintenance_exempt"),
      maintenance_paused: checkbox(fd, "maintenance_paused"),
      maintenance_covers_hosting: checkbox(fd, "maintenance_covers_hosting"),
    });
    return "Maintenance details updated.";
  });
}

export async function resendNotificationAction(projectId: string, _: ActionState, fd: FormData) {
  return run("admin", async (a) => {
    const kind = String(fd.get("kind")) as "expiry_reminder" | "expired" | "billing_reminder" | "payment_overdue";
    if (!["expiry_reminder", "expired", "billing_reminder", "payment_overdue"].includes(kind)) throw new AppError("Choose a notification.");
    const r = await MT.resendNotification(a, projectId, kind);
    return `Email: ${r.email?.replace("_", " ")} · WhatsApp: ${r.whatsapp?.replace("_", " ")}`;
  });
}

export async function retryDeliveriesAction(projectId: string, deliveryId?: string) {
  return run("admin", async () => {
    const r = await MT.retryFailedDeliveries({ projectId, deliveryId, force: true });
    return r.retried ? `Retried ${r.retried} message(s); ${r.sent} sent.` : "Nothing to retry (no failed messages with attempts left).";
  });
}

export async function adminCancelMaintenanceAction(projectId: string) {
  return run("admin", async (a) => { await MT.adminCancelMaintenance(a, projectId); return "Paid maintenance cancelled. Future unpaid invoices were voided."; });
}

// ---- client ----
export async function activateMaintenanceAction(projectId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    await MT.activateMaintenance(a, projectId, {
      signer_name: fd.get("signer_name"),
      confirm_terms: checkbox(fd, "confirm_terms"),
      confirm_recurring: checkbox(fd, "confirm_recurring"),
    }, await requestMeta());
    return "Paid maintenance activated. Thank you!";
  });
}

export async function cancelMaintenanceAction(projectId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    await MT.cancelMaintenance(a, projectId, (fd.get("reason") as string) || null);
    return "Your maintenance plan has been cancelled.";
  });
}

export async function reportPaymentAction(invoiceId: string, _: ActionState, fd: FormData) {
  return run("client", async (a) => {
    await MT.reportPayment(a, invoiceId, form(fd));
    return "Thanks! We'll confirm your payment shortly. It shows as paid once confirmed.";
  });
}
