import { withActor } from "@/lib/http";
import { exportMaintenanceCsv } from "@/server/maintenance";
import { istToday } from "@/lib/dates";

export async function GET() {
  return withActor(async (actor) => {
    const csv = await exportMaintenanceCsv(actor);
    return new Response(`﻿${csv}`, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="maintenance-${istToday()}.csv"`,
    } });
  });
}
