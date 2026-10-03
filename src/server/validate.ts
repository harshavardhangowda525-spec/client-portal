import { z } from "zod";
import { AppError } from "@/lib/errors";

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue.path.join(".");
    throw new AppError(field ? `${humanize(field)}: ${issue.message}` : issue.message);
  }
  return r.data;
}

function humanize(f: string) {
  return f.replace(/_/g, " ").replace(/\.(\d+)\./g, " #$1 ").replace(/^\w/, (c) => c.toUpperCase());
}

const strip = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();

/** Trimmed text without control characters. Rendering is always escaped by React. */
export const text = (max: number, min = 1) => z.string().transform(strip).pipe(z.string().min(min, "is required").max(max, `must be at most ${max} characters`));
export const optText = (max: number) =>
  z.string().optional().nullable().transform((v) => (v == null ? null : strip(v) || null)).pipe(z.string().max(max).nullable());
export const email = z.string().transform((v) => v.trim().toLowerCase()).pipe(z.string().email("is not a valid email").max(320));
export const optDate = z.string().optional().nullable().transform((v) => v || null)
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date").nullable());
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date");
export const uuid = z.string().uuid("is invalid");
export const money = z.coerce.number().finite().min(0).max(999_999_999);
export const url = z.string().trim().max(2000).url("must be a valid URL").refine((u) => /^https?:\/\//i.test(u), "must start with http:// or https://");
