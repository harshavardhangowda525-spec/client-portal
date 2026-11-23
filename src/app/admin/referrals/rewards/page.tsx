import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { listCampaigns, listRewards, REWARD_STATUS, REWARD_TYPES } from "@/server/rewards";
import { Badge, Empty, Panel } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { CampaignEditor, RewardDecision } from "./editors";

export const metadata = { title: "Referral rewards" };

export default async function RewardsPage() {
  const actor = await requireAdmin();
  const [campaigns, rewards] = await Promise.all([listCampaigns(actor), listRewards(actor)]);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <Panel title="Rewards" sub="A reward becomes eligible only when a referred lead converts (first confirmed payment). Nothing is issued until you approve it and record the fulfilment.">
        {rewards.length === 0 ? <Empty icon="gift" title="No rewards yet">They appear here when a referral converts while a campaign is active.</Empty> : (
          <div className="table-wrap"><table className="table table-cards">
            <thead><tr><th>Referrer</th><th>Referred business</th><th>Reward</th><th>Since</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{rewards.map((w) => (
              <tr key={w.id}>
                <td data-label="Referrer">{w.referrer}</td>
                <td data-label="Referred"><Link href={`/admin/referrals/leads/${w.lead_id}`}>{w.referred}</Link>{w.duplicate && <> <Badge tone="red" plain>Possible duplicate</Badge></>}</td>
                <td data-label="Reward">{w.reward_text}<div className="tiny faint">{w.campaign}</div></td>
                <td data-label="Since">{fmtDate(w.created_at)}</td>
                <td data-label="Status"><Badge tone={w.status === "issued" || w.status === "approved" ? "green" : w.status === "eligible" ? "amber" : w.status === "rejected" ? "red" : ""} plain>{REWARD_STATUS[w.status]}</Badge>
                  {w.decision_note && <div className="tiny faint">{w.decision_note}</div>}{w.fulfilment_note && <div className="tiny faint">{w.fulfilment_note}</div>}</td>
                <td data-label="">{["eligible", "approved"].includes(w.status) ? <RewardDecision id={w.id} status={w.status} /> : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      <Panel title="Campaigns" sub="The newest active campaign whose dates include the conversion day decides the reward. Turn a campaign off to stop new rewards." actions={<CampaignEditor />}>
        {campaigns.length === 0 ? <Empty icon="gift" title="No campaigns">Create one to offer referral rewards. Clients only see a reward while a campaign is active.</Empty> : (
          <div className="list">{campaigns.map((c) => (
            <div key={c.id} className="list-item">
              <div className="grow"><div style={{ fontWeight: 500 }}>{c.name}</div>
                <div className="small faint">{c.reward_text} · {REWARD_TYPES[c.reward_type]} · {fmtDate(c.starts_on)} – {c.ends_on ? fmtDate(c.ends_on) : "no end date"} · {c.rewards} rewards</div></div>
              <Badge tone={c.is_active ? "green" : ""} plain>{c.is_active ? "Active" : "Off"}</Badge>
              <CampaignEditor campaign={c} />
            </div>
          ))}</div>
        )}
      </Panel>
    </div>
  );
}
