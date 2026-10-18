/**
 * Run the daily maintenance check from the command line.
 *   npm run maintenance:run                    # today (India time)
 *   npm run maintenance:run -- --date 2027-03-01   # simulate a date (sends real messages if configured!)
 */
import "dotenv/config";
import { runMaintenanceJob } from "../src/server/maintenance";
import { closeSql } from "../src/lib/db";

const i = process.argv.indexOf("--date");
const today = i > -1 ? process.argv[i + 1] : undefined;
if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) { console.error("--date must be YYYY-MM-DD"); process.exit(1); }
runMaintenanceJob({ today, trigger: today ? `cli --date ${today}` : "cli" })
  .then((s) => { console.log(JSON.stringify(s, null, 2)); return closeSql(); })
  .catch(async (e) => { console.error(e); await closeSql(); process.exit(1); });
