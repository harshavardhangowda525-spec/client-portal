import { describe, it, expect } from "vitest";
import { makeAdmin, rawSystem, sendProjectProposal, acceptAsClient } from "./helpers";
import { seedSampleData, removeSampleData } from "@/server/sample";
import { acceptInvitation } from "@/server/clients";
import { actorFromToken } from "@/server/auth";

describe("sample data", () => {
  it("seeds clearly-flagged sample data and removes it completely, even after acceptance", async () => {
    const admin = await makeAdmin();
    const s = await seedSampleData();
    const [p] = await rawSystem((tx) => tx`select is_sample from projects where id = ${s.projectId}`);
    expect(p.is_sample).toBe(true);
    // a sample client accepting a proposal creates immutable rows that removal must still clear
    const session = await acceptInvitation(s.inviteLink.split("/invite/")[1], { name: "Sample Owner", password: "SamplePass123" });
    const client = (await actorFromToken(session.token))!;
    const { proposalId } = await sendProjectProposal(admin, s.clientId, s.projectId);
    await acceptAsClient(client, proposalId, "Sample Owner");
    const r = await removeSampleData();
    expect(r.projects).toBeGreaterThanOrEqual(1);
    const left = await rawSystem((tx) => tx`select
      (select count(*)::int from projects where is_sample) as p,
      (select count(*)::int from client_profiles where is_sample) as c,
      (select count(*)::int from users where email = 'sample.owner@example.test') as u`);
    expect(left[0]).toEqual({ p: 0, c: 0, u: 0 });
  });
});
