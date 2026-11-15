import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST } from "@/app/api/integrations/sales-lead/route";
import { makeAdmin, uniq, rawSystem } from "./helpers";

const SECRET = "test-sales-secret-123";

function call(body: unknown, secret: string | null = SECRET) {
  return POST(new Request("http://localhost/api/integrations/sales-lead", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  }));
}

describe("sales automation integration", () => {
  let adminEmail: string;
  beforeAll(async () => {
    const admin = await makeAdmin();
    adminEmail = admin.email;
    process.env.SALES_INTEGRATION_SECRET = SECRET;
    process.env.SALES_INTEGRATION_ADMIN_EMAIL = adminEmail;
  });
  afterAll(() => {
    delete process.env.SALES_INTEGRATION_SECRET;
    delete process.env.SALES_INTEGRATION_ADMIN_EMAIL;
  });

  it("rejects missing or wrong secrets", async () => {
    expect((await call({ business_name: "X", email: "x@example.test" }, null)).status).toBe(401);
    expect((await call({ business_name: "X", email: "x@example.test" }, "nope")).status).toBe(401);
  });

  it("requires business name and email", async () => {
    expect((await call({ business_name: "", email: "" })).status).toBe(400);
  });

  it("creates the client, publishes an itemised proposal and returns portal + invite links", async () => {
    const email = `${uniq("lead")}@example.test`;
    const res = await call({
      business_name: "Sri Lakshmi Sweets", owner_name: "Ramesh Kumar", email, phone: "+919845012345",
      plan: "PREMIUM", kind: "website", plan_price: 8999, plan_name: "Premium website",
      plan_features: ["Up to 8 pages", "On-page SEO"], requirements: "Menu page, festival offers, WhatsApp ordering",
    });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.proposal_link).toMatch(/\/portal\/proposals\//);
    expect(json.invite_link).toMatch(/\/invite\//);
    expect(json.total).toBeGreaterThanOrEqual(8999);
    const [v] = await rawSystem((tx) => tx<{ status: string; title: string }[]>`
      select v.status, p.title from proposal_versions v join proposals p on p.id = v.proposal_id where p.id = ${json.proposal_id}`);
    expect(v.status).toBe("sent");
    expect(v.title).toContain("Sri Lakshmi Sweets");
  });

  it("reuses the existing client for the same email and still issues a new proposal", async () => {
    const email = `${uniq("repeat")}@example.test`;
    const a = await (await call({ business_name: "GreenLeaf Dental", email, plan: "BASIC", plan_price: 4999 })).json();
    const b = await (await call({ business_name: "GreenLeaf Dental", email, plan: "BASIC", plan_price: 4999 })).json();
    expect(a.client_id).toBe(b.client_id);
    expect(a.proposal_id).not.toBe(b.proposal_id);
  });
});
