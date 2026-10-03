"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
declare global { interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } } }

function loadScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/** Opens Razorpay Checkout. The payment is only recorded after the server verifies it with Razorpay. */
export function PayOnline({ invoiceId }: { invoiceId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  async function pay() {
    setBusy(true); setMsg(null);
    try {
      if (!(await loadScript())) throw new Error("Could not load the payment window. Check your connection.");
      const res = await fetch("/api/razorpay/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId }) });
      const order = await res.json();
      if (!res.ok) throw new Error(order.error ?? "Could not start payment.");
      const rz = new window.Razorpay!({
        key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
        name: "Infinity Web & Apps", description: `Invoice ${order.invoiceNumber}`,
        handler: async (r: RazorpayResponse) => {
          const v = await fetch("/api/razorpay/verify", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }) });
          const body = await v.json();
          setMsg(v.ok ? "Payment verified. Thank you!" : body.error ?? "We could not verify the payment yet. It will update once confirmed.");
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
        theme: { color: "#3d8bff" },
      });
      rz.open();
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <span className="stack-sm">
      <button className="btn btn-sm btn-primary" onClick={pay} disabled={busy}>{busy ? "Opening…" : "Pay online"}</button>
      {msg && <span className="tiny" role="status">{msg}</span>}
    </span>
  );
}
