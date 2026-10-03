import postgres from "postgres";
import { migrate } from "../scripts/migrate-lib";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://portal_owner:portal_owner@localhost:5432/portal_test";
  if (!/test/.test(url)) throw new Error("Refusing to reset a database whose name does not contain 'test'");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("drop schema if exists public cascade; create schema public;");
  await sql.end();
  await migrate(url, () => {});
}
