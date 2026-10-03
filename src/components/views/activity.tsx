const LABELS: Record<string, string> = {
  "client.created": "Client created", "client.updated": "Client details updated", "client.access_revoked": "Portal access revoked",
  "client.access_restored": "Portal access restored", "project.created": "Project created", "project.updated": "Project updated",
  "project.status_changed": "Project status changed", "project.commenced": "Project commenced", "invitation.created": "Portal invitation created",
  "invitation.accepted": "Client joined the portal", "invitation.revoked": "Invitation revoked", "milestone.created": "Milestone added",
  "milestone.updated": "Milestone updated", "milestone.deleted": "Milestone deleted", "milestone.reordered": "Milestones reordered",
  "approval.requested": "Client approval requested", "approval.responded": "Client responded to a request", "approval.cancelled": "Approval request cancelled",
  "quotation.created": "Quotation created", "quotation.sent": "Quotation sent", "quotation.viewed": "Client viewed the quotation",
  "quotation.accepted": "Quotation accepted", "quotation.changes_requested": "Client requested quotation changes", "quotation.rejected": "Quotation declined",
  "quotation.revised": "Quotation revised", "quotation.withdrawn": "Quotation withdrawn", "quotation.draft_deleted": "Draft quotation deleted",
  "preview.published": "Preview published", "preview.reviewed": "Client reviewed a preview", "update.posted": "Update posted", "update.deleted": "Update deleted",
  "document.uploaded": "Document uploaded", "document.deleted": "Document deleted", "invoice.created": "Invoice drafted", "invoice.issued": "Invoice issued",
  "invoice.voided": "Invoice voided", "payment.recorded": "Payment recorded", "payment.confirmed": "Payment confirmed", "payment.failed": "Payment marked failed",
  "payment.refunded": "Payment refunded", "payment.verified_online": "Online payment verified", "admin.created": "Admin account created",
  "user.password_changed": "Password changed",
};

export function describeAction(action: string, data: Record<string, unknown> = {}) {
  const base = LABELS[action] ?? action;
  const detail = (data.number ?? data.title ?? data.name ?? data.email ?? "") as string;
  if (action === "project.status_changed") return `${base}: ${data.from} → ${data.to}`;
  if (action === "payment.recorded") return `${base}: ₹${Number(data.amount).toLocaleString("en-IN")} (${data.status})`;
  if (action === "approval.responded" || action === "preview.reviewed") return `${base}: ${String(data.decision).replace(/_/g, " ")}`;
  return detail ? `${base}: ${detail}` : base;
}
