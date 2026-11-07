import { withDb, SYSTEM } from "./core";

/**
 * Groq (OpenAI-compatible API) for chat and Whisper transcription. Server-only: the key never reaches the browser.
 * Every call is logged to resolve_ai_logs (operation, model, status, latency, tokens, output — never the key).
 */
const BASE = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
export const aiModel = () => process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
export const transcribeModel = () => process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3";
export const aiConfigured = () => !!process.env.GROQ_API_KEY;

export type AiOperation = "clarify" | "transcribe" | "briefing" | "gap_check" | "daily_summary" | "feedback_summary" | "lead_qualify" | "follow_up_draft" | "referral_insights";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type AiResult<T> = { ok: true; data: T } | { ok: false; status: "failed" | "not_configured"; error: string };

export class AiError extends Error {}

async function log(entry: { operation: AiOperation; ticketId?: string | null; projectId?: string | null; model: string; status: string;
  latency: number; inputTokens?: number | null; outputTokens?: number | null; output?: string | null; error?: string | null }) {
  try {
    await withDb(SYSTEM, (tx) => tx`
      insert into resolve_ai_logs (ticket_id, project_id, operation, provider, model, status, latency_ms, input_tokens, output_tokens, output, error)
      values (${entry.ticketId ?? null}, ${entry.projectId ?? null}, ${entry.operation}, 'groq', ${entry.model}, ${entry.status}, ${entry.latency},
              ${entry.inputTokens ?? null}, ${entry.outputTokens ?? null}, ${entry.output?.slice(0, 8000) ?? null}, ${entry.error?.slice(0, 1000) ?? null})`);
  } catch (e) {
    console.error("[ai log]", e);
  }
}

/** Chat completion that must return a JSON object. One retry on transient errors. */
export async function chatJson<T = Record<string, unknown>>(messages: ChatMessage[], ctx: { operation: AiOperation; ticketId?: string | null; projectId?: string | null; maxTokens?: number }): Promise<AiResult<T>> {
  const model = aiModel();
  if (!aiConfigured()) {
    await log({ ...ctx, model, status: "not_configured", latency: 0, error: "GROQ_API_KEY is not set" });
    return { ok: false, status: "not_configured", error: "AI is not configured" };
  }
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: ctx.maxTokens ?? 1200, response_format: { type: "json_object" } }),
        signal: AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS || 30000)),
      });
      const latency = Date.now() - started;
      const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${json.error?.message ?? "request failed"}`;
        await log({ ...ctx, model, status: "failed", latency, error: lastError });
        if (res.status === 429 || res.status >= 500) continue;
        break;
      }
      const content = json.choices?.[0]?.message?.content ?? "";
      let data: T;
      try { data = JSON.parse(content) as T; } catch {
        lastError = "AI returned invalid JSON";
        await log({ ...ctx, model, status: "failed", latency, output: content, error: lastError });
        continue;
      }
      await log({ ...ctx, model, status: "ok", latency, inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens, output: content });
      return { ok: true, data };
    } catch (e) {
      lastError = (e as Error).name === "TimeoutError" ? "AI request timed out" : (e as Error).message;
      await log({ ...ctx, model, status: "failed", latency: Date.now() - started, error: lastError });
    }
  }
  return { ok: false, status: "failed", error: lastError || "AI request failed" };
}

/** Whisper transcription via Groq. `language` is an ISO-639-1 hint (e.g. "hi", "ta"); omit to auto-detect. */
export async function transcribe(audio: { data: Buffer; type: string; name: string }, ctx: { ticketId?: string | null; projectId?: string | null; language?: string | null }): Promise<AiResult<{ text: string; language: string | null }>> {
  const model = transcribeModel();
  if (!aiConfigured()) {
    await log({ operation: "transcribe", ...ctx, model, status: "not_configured", latency: 0, error: "GROQ_API_KEY is not set" });
    return { ok: false, status: "not_configured", error: "Transcription is not configured" };
  }
  const started = Date.now();
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio.data)], { type: audio.type }), audio.name);
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (ctx.language) form.append("language", ctx.language);
    const res = await fetch(`${BASE}/audio/transcriptions`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: form,
      signal: AbortSignal.timeout(Number(process.env.GROQ_TIMEOUT_MS || 60000)),
    });
    const json = (await res.json().catch(() => ({}))) as { text?: string; language?: string; error?: { message?: string } };
    const latency = Date.now() - started;
    if (!res.ok || typeof json.text !== "string") {
      const error = `HTTP ${res.status}: ${json.error?.message ?? "transcription failed"}`;
      await log({ operation: "transcribe", ...ctx, model, status: "failed", latency, error });
      return { ok: false, status: "failed", error };
    }
    await log({ operation: "transcribe", ...ctx, model, status: "ok", latency, output: json.text });
    return { ok: true, data: { text: json.text.trim(), language: json.language ?? null } };
  } catch (e) {
    const error = (e as Error).name === "TimeoutError" ? "Transcription timed out" : (e as Error).message;
    await log({ operation: "transcribe", ...ctx, model, status: "failed", latency: Date.now() - started, error });
    return { ok: false, status: "failed", error };
  }
}

export async function logGuard(ctx: { ticketId?: string | null; projectId?: string | null }, output: string, reason: string) {
  await log({ operation: "clarify", ...ctx, model: aiModel(), status: "guarded", latency: 0, output, error: reason });
}
