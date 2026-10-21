import { describe, it, expect, beforeAll } from "vitest";
import type { Actor } from "@/lib/db";
import { withDb } from "@/lib/db";
import { makeAdmin, makeClientWithProject, rawSystem, uniq, sendProjectProposal } from "./helpers";
import * as P from "@/server/proposals";
import * as X from "@/server/content";
import { viewAsTarget, createClient } from "@/server/clients";
import { clientActor } from "@/server/auth";

describe("view as client", () => {
  let admin: Actor; let client: Actor; let projectId: string; let clientId: string;
  beforeAll(async () => {
    admin = await makeAdmin();
    ({ client, projectId, clientId } = await makeClientWithProject(admin, "Viewer"));
  });

  it("finds the client's portal user and logs the view", async () => {
    const t = await viewAsTarget(admin, clientId, projectId);
    expect(t).toEqual({ userId: client.userId, projectId });
    const [log] = await rawSystem((tx) => tx`select actor_id from audit_logs where action = 'client.viewed_as' and entity_id = ${clientId}`);
    expect(log.actor_id).toBe(admin.userId);
    await expect(viewAsTarget(client, clientId)).rejects.toThrow();
  });

  it("explains when the client has no portal account yet", async () => {
    const id = await createClient(admin, { business_name: "No Account Co", owner_name: "Nobody", email: `${uniq("none")}@example.test` });
    await expect(viewAsTarget(admin, id)).rejects.toThrow(/portal account/);
  });

  it("sees exactly the client's data and never saves anything", async () => {
    const other = await makeClientWithProject(admin, "Other");
    const r = await sendProjectProposal(admin, clientId, projectId);
    const viewing: Actor = { ...(await clientActor(client.userId))!, viewAs: { adminId: admin.userId, adminName: "Admin", expiresAt: Date.now() + 60_000 } };
    // Client permissions apply: other clients' projects stay invisible.
    await expect(X.listThread(viewing, other.projectId)).rejects.toThrow(/not found/i);
    // Writes made while viewing (even ones a page makes, like read markers) are rolled back.
    const before = await rawSystem((tx) => tx`select status, view_count from proposal_versions where id = ${r.versionId}`);
    expect(before[0].status).toBe("sent");
    await P.getProposal(viewing, r.proposalId);
    await P.recordProposalView(viewing, r.versionId); // what opening the proposal page does
    await X.addComment(viewing, projectId, { target_type: "thread", body: "should not persist" });
    const after = await rawSystem((tx) => tx`select status, view_count from proposal_versions where id = ${r.versionId}`);
    expect(after[0]).toEqual(before[0]);
    const msgs = await rawSystem((tx) => tx`select 1 from comments where project_id = ${projectId} and body = 'should not persist'`);
    expect(msgs).toHaveLength(0);
    // The same call as the real client does persist.
    await withDb(client, (tx) => tx`select 1`);
    await X.addComment(client, projectId, { target_type: "thread", body: "real message" });
    expect(await rawSystem((tx) => tx`select 1 from comments where project_id = ${projectId} and body = 'real message'`)).toHaveLength(1);
  });
});
