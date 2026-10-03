import "dotenv/config";
import { closeSql } from "../src/lib/db";
import { seedSampleData, removeSampleData } from "../src/server/sample";

/** npm run sample:seed | sample:remove — sample rows are flagged is_sample and use @example.test emails. */
async function main(cmd: string | undefined) {
  if (cmd === "seed") {
    const r = await seedSampleData();
    console.log(`Sample data created. Sample client invitation (single use): ${r.inviteLink}`);
  } else if (cmd === "remove") {
    const r = await removeSampleData();
    console.log(`Removed ${r.projects} sample project(s) and ${r.clients} sample client(s).`);
  } else throw new Error("Usage: sample-data.ts seed|remove");
}

main(process.argv[2]).catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => closeSql());
