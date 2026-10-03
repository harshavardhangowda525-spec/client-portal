"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/app/actions/run";
import { Icon } from "./icons";

type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

// ---- Global toasts: rendered by <Toaster/> in the app shell, so they survive page re-renders.
type Toast = { id: number; text: string; error?: boolean };
const listeners = new Set<(t: Toast) => void>();
let nextId = 1;
export function pushToast(text: string, error = false) {
  const t = { id: nextId++, text, error };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.error ? 7000 : 4500);
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="toast-region" aria-live="polite">
      {items.map((t) => <div key={t.id} role={t.error ? "alert" : "status"} className={`notice ${t.error ? "error" : "success"}`}>{t.text}</div>)}
    </div>
  );
}

export function ActionForm({
  action, children, className, resetOnSuccess, toast, redirectTo, onDone, id,
}: {
  action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; toast?: boolean; redirectTo?: string;
  onDone?: (s: ActionState) => void; id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (toast) {
      if (state.error || state.message) pushToast(state.error ?? state.message!, !!state.error);
    } else setVisible(true);
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onDone?.(state);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const msg = state && visible && (state.error || state.message) ? (
    <div role={state.error ? "alert" : "status"} className={`notice ${state.error ? "error" : "success"}`}>{state.error ?? state.message}</div>
  ) : null;

  return (
    <form ref={ref} action={formAction} className={className} aria-busy={pending} id={id}>
      {children}
      {!toast && msg}
    </form>
  );
}

export function Submit({ children, className = "btn btn-primary", pendingText, disabled, name, value, confirm }: {
  children: ReactNode; className?: string; pendingText?: string; disabled?: boolean; name?: string; value?: string; confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} name={name} value={value}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {pending && <span className="spinner" aria-hidden="true" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** One-button form, e.g. "Delete" or "Mark as read". */
export function ActionButton({ action, children, className = "btn btn-sm", confirm, fields }: {
  action: Action; children: ReactNode; className?: string; confirm?: string; fields?: Record<string, string>;
}) {
  return (
    <ActionForm action={action} toast className="inline-form">
      {fields && Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Submit className={className} confirm={confirm}>{children}</Submit>
    </ActionForm>
  );
}

export function CopyButton({ text, label = "Copy", className = "btn btn-sm" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => {
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      }
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }}>
      <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied" : label}
    </button>
  );
}

export function Modal({ trigger, title, children, triggerClass = "btn" }: { trigger: ReactNode; title: string; children: (close: () => void) => ReactNode; triggerClass?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { ref.current?.close(); setOpen(false); };
  return (
    <>
      <button type="button" className={triggerClass} onClick={() => { setOpen(true); ref.current?.showModal(); }}>{trigger}</button>
      <dialog ref={ref} className="modal" onClose={() => setOpen(false)} aria-label={title}>
        <div className="modal-body">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <h2>{title}</h2>
            <button type="button" className="btn btn-ghost icon-btn btn-sm" onClick={close} aria-label="Close"><Icon name="x" /></button>
          </div>
          {open && children(close)}
        </div>
      </dialog>
    </>
  );
}
