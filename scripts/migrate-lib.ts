import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

/** Apply pending SQL migrations from db/migrations in filename order. */
export async function migrate(databaseUrl: string, log: (m: string) => void = console.log) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      log(`applied ${file}`);
    }
    const [role] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    if (role?.rolsuper || role?.rolbypassrls) {
      log("WARNING: the database role bypasses Row Level Security. Use a non-superuser role without BYPASSRLS.");
    }
  } finally {
    await sql.end();
  }
}
