import "dotenv/config";
import { migrate } from "./migrate-lib";

migrate(process.env.DATABASE_URL!).then(
  () => console.log("Migrations complete."),
  (e) => { console.error(e); process.exit(1); },
);
