import { z } from "zod";
import { withDb, SYSTEM, assertAdmin, audit, type Actor, type Tx } from "./core";
import { parse, optText } from "./validate";
import { notifyAdmins, notifyClientUsers } from "./notify";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { istToday } from "@/lib/dates";

/**
 * Referral reward campaigns. A reward becomes "eligible" only when a referred lead converts (the referral engine's
 * verified rule: first confirmed payment, net of refunds). Every reward then waits for an admin to approve it, and is
 * marked issued only when an admin records the fulfilment. Nothing is promised or paid automatically.
 */
export type Campaign = { id: string; name: string; reward_type: "renewal_credit" | "discount" | "cash" | "gift"; reward_value: number; reward_text: string;
  terms: string | null; starts_on: string; ends_on: string | null; is_active: boolean };
export type Reward = { id: string; lead_id: string; campaign_id: string; client_id: string; reward_text: string; reward_value: number;
  status: "eligible" | "approved" | "rejected" | "issued" | "reversed"; decision_note: string | null; decided_at: Date | null; issued_at: Date | null;
  fulfilment_note: string | null; created_at: Date };
export const REWARD_TYPES = { renewal_credit: "Credit on a renewal", discount: "Discount on a future project", cash: "Cash / bank transfer", gift: "Gift" } as const;
export const REWARD_STATUS = { eligible: "Waiting for approval", approved: "Approved", rejected: "Not approved", issued: "Issued", reversed: "Reversed" } as const;

async function activeCampaignTx(tx: Tx, on = istToday()) {
  const [c] = await tx<Campaign[]>`select * from referral_campaigns where is_active and starts_on <= ${on} and (ends_on is null or ends_on >= ${on})
    order by starts_on desc, created_at desc limit 1`;
  return c ?? null;
}
export async function activeCampaign(actor?: Actor) {
  return actor ? withDb(actor, (tx) => activeCampaignTx(tx)) : withDb(SYSTEM, (tx) => activeCampaignTx(tx));
}

/** Called by the referral engine when a referred lead converts. Idempotent (one reward per lead). */
export async function onReferralConverted(leadId: string) {
  const r = await withDb(SYSTEM, async (tx) => {
    const [a] = await tx<{ referrer_client_id: string; converted_at: Date | null; business_name: string }[]>`
      select a.referrer_client_id, l.converted_at, l.business_name from referral_attributions a join leads l on l.id = a.lead_id where a.lead_id = ${leadId}`;
    if (!a) return null;
    const day = a.converted_at ? istToday(new Date(a.converted_at)) : istToday();
    const c = await activeCampaignTx(tx, day);
    if (!c) return null;
    const [row] = await tx<{ id: string }[]>`
      insert into referral_rewards (lead_id, campaign_id, client_id, reward_text, reward_value)
      values (${leadId}, ${c.id}, ${a.referrer_client_id}, ${c.reward_text}, ${c.reward_value})
      on conflict (lead_id) do update set status = 'eligible', decided_by = null, decided_at = null, decision_note = null
        where referral_rewards.status = 'reversed'
      returning id`;
    if (!row) return null;
    await notifyAdmins(tx, null, { type: "reward_eligible", title: `Referral reward to approve: ${c.reward_text}`, body: `Referred business: ${a.business_name}`, link: "/admin/growth#rewards" });
    await notifyClientUsers(tx, null, a.referrer_client_id, { type: "reward_eligible", title: `Your referral qualifies for a reward: ${c.reward_text}. Our team will confirm it shortly.`, link: "/portal/referrals" });
    return row.id;
  });
  return r;
}

/** Refunds/reversals undo the conversion: a reward that wasn't issued yet is reversed; an issued one is flagged to admins. */
export async function onConversionReversed(leadId: string) {
  await withDb(SYSTEM, async (tx) => {
    const [w] = await tx<{ id: string; status: string; reward_text: string }[]>`select id, status, reward_text from referral_rewards where lead_id = ${leadId}`;
    if (!w) return;
    if (w.status === "eligible" || w.status === "approved") {
      await tx`update referral_rewards set status = 'reversed', decision_note = 'Referred client''s payment was refunded or reversed' where id = ${w.id}`;
    } else if (w.status === "issued") {
      await notifyAdmins(tx, null, { type: "reward_review", title: `A referral reward (${w.reward_text}) was already issued, but the referred client's payment was reversed. Please review.`, link: "/admin/growth#rewards" });
    }
  });
}

export async function myRewards(actor: Actor) {
  if (actor.role !== "client") throw forbidden();
  return withDb(actor, async (tx) => ({
    campaign: await activeCampaignTx(tx),
    rewards: await tx<Reward[]>`select * from referral_rewards where client_id = ${actor.clientId!} order by created_at desc`,
  }));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  reward_type: z.enum(["renewal_credit", "discount", "cash", "gift"]),
  reward_value: z.coerce.number().min(0).max(10_000_000).default(0),
  reward_text: z.string().trim().min(1).max(200),
  terms: optText(2000),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null)),
  is_active: z.coerce.boolean().default(true),
}).refine((d) => !d.ends_on || d.ends_on >= d.starts_on, { message: "End date must be after the start date", path: ["ends_on"] });

export async function saveCampaign(actor: Actor, id: string | null, input: unknown) {
  assertAdmin(actor);
  const d = parse(campaignSchema, input);
  return withDb(actor, async (tx) => {
    if (id) {
      const r = await tx`update referral_campaigns set ${tx(d as never)} where id = ${id}`;
      if (!r.count) throw notFound();
      await audit(tx, actor, "reward.campaign_updated", "referral_campaign", id, null, { name: d.name, active: d.is_active });
      return id;
    }
    const [c] = await tx<{ id: string }[]>`insert into referral_campaigns ${tx({ ...d, created_by: actor.userId } as never)} returning id`;
    await audit(tx, actor, "reward.campaign_created", "referral_campaign", c.id, null, { name: d.name });
    return c.id;
  });
}

export async function listCampaigns(actor: Actor) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<(Campaign & { rewards: number })[]>`
    select c.*, (select count(*)::int from referral_rewards r where r.campaign_id = c.id) as rewards from referral_campaigns c order by c.created_at desc`);
}

export async function listRewards(actor: Actor, status?: string) {
  assertAdmin(actor);
  return withDb(actor, (tx) => tx<(Reward & { referrer: string; referred: string; campaign: string; duplicate: boolean })[]>`
    select r.*, c.business_name as referrer, l.business_name as referred, k.name as campaign,
      exists (select 1 from leads d where d.id <> l.id and d.stage not in ('lost', 'disqualified') and
        ((l.email is not null and lower(d.email) = lower(l.email)) or (l.phone is not null and d.phone = l.phone))) as duplicate
    from referral_rewards r join client_profiles c on c.id = r.client_id join leads l on l.id = r.lead_id join referral_campaigns k on k.id = r.campaign_id
    ${status ? tx`where r.status = ${status}` : tx``} order by r.created_at desc limit 200`);
}

const decisionSchema = z.object({ decision: z.enum(["approved", "rejected", "issued"]), note: optText(1000) });

export async function decideReward(actor: Actor, id: string, input: unknown) {
  assertAdmin(actor);
  const d = parse(decisionSchema, input);
  await withDb(actor, async (tx) => {
    const [w] = await tx<{ status: Reward["status"]; client_id: string; reward_text: string }[]>`select status, client_id, reward_text from referral_rewards where id = ${id} for update`;
    if (!w) throw notFound();
    const allowed: Record<string, Reward["status"][]> = { approved: ["eligible"], rejected: ["eligible", "approved"], issued: ["approved"] };
    if (!allowed[d.decision].includes(w.status)) throw new AppError(`A reward that is “${REWARD_STATUS[w.status]}” can't be ${d.decision === "issued" ? "marked issued" : d.decision}.`, "conflict");
    if (d.decision === "rejected" && !d.note) throw new AppError("Please give a reason for not approving the reward.", "invalid");
    if (d.decision === "issued") {
      await tx`update referral_rewards set status = 'issued', issued_at = now(), fulfilment_note = ${d.note ?? null} where id = ${id}`;
    } else {
      await tx`update referral_rewards set status = ${d.decision}, decided_by = ${actor.userId}, decided_at = now(), decision_note = ${d.note ?? null} where id = ${id}`;
    }
    await audit(tx, actor, `reward.${d.decision}`, "referral_reward", id, null, { note: d.note ?? null });
    const msg = d.decision === "approved" ? `Your referral reward is approved: ${w.reward_text}.` : d.decision === "issued" ? `Your referral reward has been issued: ${w.reward_text}.` : `Update on your referral reward: ${d.note}`;
    await notifyClientUsers(tx, actor, w.client_id, { type: "reward_update", title: msg, link: "/portal/referrals" });
  });
}
