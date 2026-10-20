import { describe, it, expect, beforeAll } from "vitest";
import type { Actor } from "@/lib/db";
import { makeAdmin } from "./helpers";
import { getCatalog, saveCatalogItem } from "@/server/pricing";

describe("AI services catalog", () => {
  let admin: Actor;
  beforeAll(async () => { admin = await makeAdmin(); });

  it("ships 17 AI services, starting with appointment & inquiry automation at ₹2,999", async () => {
    const c = await getCatalog(admin);
    const ai = c.services.filter((s) => s.category === "ai");
    expect(ai).toHaveLength(17);
    const appt = ai.find((s) => s.name === "AI appointment & inquiry automation")!;
    expect(Number(appt.min_price)).toBe(2999);
    expect(appt.default_price).toBeNull(); // you always enter the actual quoted price
    for (const s of ai) expect(Number(s.max_price ?? s.min_price)).toBeGreaterThanOrEqual(Number(s.min_price));
    expect(c.externals.some((e) => e.name === "AI usage (model API credits)" && e.billing === "recurring")).toBe(true);
  });

  it("admins can add new AI services", async () => {
    await saveCatalogItem(admin, "service", null, { category: "ai", name: "AI resume screening", unit: "fixed", min_price: "4999", max_price: "15000" });
    const c = await getCatalog(admin);
    expect(c.services.some((s) => s.category === "ai" && s.name === "AI resume screening")).toBe(true);
  });
});
