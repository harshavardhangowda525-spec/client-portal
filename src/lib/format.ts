export function fmtDate(value: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", opts ?? { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function timeAgo(value: string | Date): string {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(value);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const MILESTONE_STATUS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  awaiting_client: "Awaiting client",
  completed: "Completed",
  blocked: "Blocked",
};

export const PROJECT_STATUS: Record<string, string> = {
  proposal: "Proposal",
  quotation_accepted: "Quotation accepted",
  active: "In development",
  awaiting_client: "Waiting for client input",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Offer declined",
};

export const PROJECT_TYPES: Record<string, string> = {
  website: "Website",
  ecommerce: "E-commerce website",
  mobile_app: "Mobile app",
  web_app: "Web application",
  branding: "Branding & design",
  maintenance: "Maintenance",
  other: "Other",
};

export const QUOTE_STATUS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  expired: "Expired",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
};

export const PREVIEW_STATUS: Record<string, string> = {
  ready_for_review: "Ready for review",
  changes_requested: "Changes requested",
  approved: "Approved",
  superseded: "Superseded",
};

export const INVOICE_STATUS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
};

export const PAYMENT_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  upi: "UPI",
  cash: "Cash",
  cheque: "Cheque",
  card_offline: "Card (offline terminal)",
  razorpay: "Razorpay",
  other: "Other",
};

export const DOC_CATEGORIES: Record<string, string> = {
  quotation: "Quotations",
  invoice: "Invoices",
  requirements: "Approved requirements",
  brand_asset: "Brand assets",
  screenshot: "Preview screenshots",
  handover: "Handover documents",
  contract: "Contracts",
  other: "Other",
};

export const UPDATE_KINDS: Record<string, string> = {
  progress: "Progress",
  requirements: "Requirements",
  design: "Design",
  preview: "Preview",
  milestone: "Milestone",
  testing: "Testing",
  feedback_request: "Feedback requested",
  deployment: "Deployment",
  handover: "Handover",
  general: "General",
};
