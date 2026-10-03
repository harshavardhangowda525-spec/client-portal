import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createAdmin } from "../src/server/auth";
import { closeSql } from "../src/lib/db";

/** Interactive first-admin setup. Credentials are typed in, never hardcoded. */
async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const name = process.env.ADMIN_NAME ?? (await rl.question("Admin name: "));
  const email = process.env.ADMIN_EMAIL ?? (await rl.question("Admin email: "));
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    stdout.write("Password (min 10 chars, letters and numbers; input hidden): ");
    password = await new Promise<string>((resolve) => {
      let buf = "";
      stdin.setRawMode?.(true);
      const onData = (c: Buffer) => {
        const ch = c.toString();
        if (ch === "\r" || ch === "\n") { stdin.setRawMode?.(false); stdin.off("data", onData); stdout.write("\n"); resolve(buf); }
        else if (ch === "\u0003") process.exit(1);
        else if (ch === "\u007f") buf = buf.slice(0, -1);
        else buf += ch;
      };
      stdin.on("data", onData);
    });
  }
  rl.close();
  await createAdmin(name, email, password);
  console.log(`Admin ${email} created. Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/login`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => closeSql());
