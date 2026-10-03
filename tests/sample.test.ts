import { describe, it, expect } from "vitest";
import { makeAdmin, rawSystem } from "./helpers";
import { seedSampleData, removeSampleData } from "@/server/sample";
import { acceptInvitation } from "@/server/clients";
import { actorFromToken } from "@/server/auth";
import * as Q from "@/server/quotations";

describe("sample data", () => {
  it("seeds clearly-flagged sample data and removes it completely, even after acceptance", async () => {
    await makeAdmin();
    const s = await seedSampleData();
    const [p] = await rawSystem((tx) => tx`select is_sample from projects where id = ${s.projectId}`);
    expect(p.is_sample).toBe(true);
    // a sample client accepting a quotation creates immutable rows that removal must still clear
    const session = await acceptInvitation(s.inviteLink.split("/invite/")[1], { name: "Sample Owner", password: "SamplePass123" });
    const client = (await actorFromToken(session.token))!;
    const [q] = await Q.listProjectQuotations(client, s.projectId);
    const { hash } = await Q.getVersion(client, q.versions[0].id);
    await Q.acceptQuotation(client, q.versions[0].id, { signer_name: "Sample Owner", confirm_scope: true, confirm_terms: true, content_hash: hash });
    const r = await removeSampleData();
    expect(r.projects).toBeGreaterThanOrEqual(1);
    const left = await rawSystem((tx) => tx`select
      (select count(*)::int from projects where is_sample) as p,
      (select count(*)::int from client_profiles where is_sample) as c,
      (select count(*)::int from users where email = 'sample.owner@example.test') as u`);
    expect(left[0]).toEqual({ p: 0, c: 0, u: 0 });
  });
});
