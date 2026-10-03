import postgres from "postgres";

export type Role = "admin" | "client";

/** Authenticated actor. Every data access runs inside a transaction scoped to one of these. */
export type Actor = {
  userId: string;
  role: Role;
  clientId: string | null;
  name: string;
  email: string;
};

/** Trusted server-only context (authentication, invitations, notification fan-out, scripts). */
export const SYSTEM = { system: true } as const;
export type Ctx = Actor | typeof SYSTEM;

export type Tx = postgres.TransactionSql<Record<string, unknown>>;

const globalForDb = globalThis as unknown as { __sql?: postgres.Sql };

export function getSql(): postgres.Sql {
  if (!globalForDb.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    globalForDb.__sql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idle_timeout: 20,
      prepare: !/pooler|pgbouncer/.test(url),
      types: {
        // return numerics as JS numbers (amounts are bounded to 14,2)
        numeric: { to: 1700, from: [1700], serialize: (v: unknown) => String(v), parse: (v: string) => Number(v) },
        // keep dates as YYYY-MM-DD strings to avoid timezone shifts
        date: { to: 1082, from: [1082], serialize: (v: unknown) => String(v), parse: (v: string) => v },
      },
    });
  }
  return globalForDb.__sql;
}

export async function closeSql() {
  if (globalForDb.__sql) {
    await globalForDb.__sql.end({ timeout: 5 });
    globalForDb.__sql = undefined;
  }
}

function isSystem(ctx: Ctx): ctx is typeof SYSTEM {
  return (ctx as typeof SYSTEM).system === true;
}

/**
 * Run `fn` in a transaction whose Postgres session variables identify the actor,
 * so Row Level Security policies apply to every statement.
 */
export async function withDb<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const sql = getSql();
  return sql.begin(async (tx) => {
    if (isSystem(ctx)) {
      await tx`select set_config('app.role', 'system', true)`;
    } else {
      await tx`select set_config('app.role', ${ctx.role}, true),
                      set_config('app.user_id', ${ctx.userId}, true),
                      set_config('app.client_id', ${ctx.clientId ?? ""}, true)`;
    }
    return fn(tx as unknown as Tx);
  }) as Promise<T>;
}
