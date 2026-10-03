/** Server-only configuration. Never import from client components. */
export const company = () => ({
  name: process.env.COMPANY_NAME || "Infinity Web & Apps",
  email: process.env.COMPANY_EMAIL || "",
  phone: process.env.COMPANY_PHONE || "",
  address: process.env.COMPANY_ADDRESS || "",
  taxId: process.env.COMPANY_TAX_ID || "",
});

export const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

export const integrations = () => ({
  email: !!(process.env.SMTP_HOST && process.env.SMTP_FROM),
  whatsapp: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME),
  razorpay: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  razorpayWebhook: !!process.env.RAZORPAY_WEBHOOK_SECRET,
});
