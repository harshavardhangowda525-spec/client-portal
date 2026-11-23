import { withDb, assertAdmin, type Actor, type Tx } from "./core";

/**
 * Referral analytics, computed from database records only. The funnel is a cohort: leads created in the date range.
 * Each lead counts once per step (milestone timestamps), so repeated interactions are never double-counted.
 */
export type AnalyticsFilter = { from: string; to: string; referrer?: string; category?: string; service?: string; owner?: string; stage?: string };

export const METRIC_DEFINITIONS: Record<string, string> = {
  invitations: "Referral invitations opened to clients after positive feedback, in the date range.",
  acceptance: "Invitations the client acted on (created their link or made an introduction) ÷ invitations × 100.",
  visits: "Unique daily visitors to referral links (a visit is not a referral).",
  verified: "Referral enquiries with valid contact details and consent, excluding self-referrals and existing clients.",
  qualified: "Verified referral leads that reached “Qualified” or later.",
  booked: "Verified referral leads with at least one discovery call booked.",
  completed: "Verified referral leads with a completed discovery call.",
  proposals: "Verified referral leads that were sent a proposal.",
  accepted: "Verified referral leads that accepted a proposal.",
  converted: "Verified referral leads whose first payment was confirmed (net of refunds), per the conversion rule.",
  revenue: "Confirmed payments minus refunds from converted referral clients (all their projects).",
  conversion_rate: "Converted referred leads ÷ verified referred leads × 100.",
  qualification_rate: "Qualified referral leads ÷ verified referred leads × 100.",
  booking_rate: "Referred leads with booked calls ÷ verified referred leads × 100.",
  time_to_conversion: "Average days from enquiry to verified conversion.",
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function where(tx: Tx, f: AnalyticsFilter) {
  return tx`l.source = 'client_referral' and l.created_at >= ${`${f.from}T00:00:00+05:30`} and l.created_at < (${`${f.to}T00:00:00+05:30`}::timestamptz + interval '1 day')
    ${f.referrer ? tx`and a.referrer_client_id = ${f.referrer}` : tx``} ${f.category ? tx`and l.business_category = ${f.category}` : tx``}
    ${f.service ? tx`and l.service = ${f.service}` : tx``} ${f.owner ? tx`and l.owner_id = ${f.owner}` : tx``} ${f.stage ? tx`and l.stage = ${f.stage}` : tx``}`;
}

const net = (tx: Tx) => tx`(coalesce((select sum(x.amount) from payments x join projects p on p.id = x.project_id where p.client_id = l.client_id and x.status = 'confirmed'), 0)
  - coalesce((select sum(x.amount) from payments x join projects p on p.id = x.project_id where p.client_id = l.client_id and x.status = 'refunded'), 0))`;

export async function referralAnalytics(actor: Actor, f: AnalyticsFilter) {
  assertAdmin(actor);
  return withDb(actor, async (tx) => {
    const range = (col: string) => tx`${tx(col)} >= ${`${f.from}T00:00:00+05:30`} and ${tx(col)} < (${`${f.to}T00:00:00+05:30`}::timestamptz + interval '1 day')`;
    const [inv] = await tx<{ invitations: number; accepted: number }[]>`
      select count(*)::int as invitations, count(*) filter (where status = 'accepted')::int as accepted from referral_invitations where ${range("created_at")}
      ${f.referrer ? tx`and client_id = ${f.referrer}` : tx``}`;
    const [vis] = await tx<{ visits: number }[]>`select count(*)::int as visits from referral_visits v join referral_links k on k.id = v.link_id where ${range("v.created_at")}
      ${f.referrer ? tx`and k.client_id = ${f.referrer}` : tx``}`;
    const [c] = await tx<{ enquiries: number; verified: number; qualified: number; booked: number; completed: number; proposals: number; accepted: number; converted: number; revenue: number; avg_days: number }[]>`
      select count(*)::int as enquiries,
        count(*) filter (where l.verified_at is not null)::int as verified,
        count(*) filter (where l.verified_at is not null and l.qualified_at is not null)::int as qualified,
        count(*) filter (where l.verified_at is not null and l.call_booked_at is not null)::int as booked,
        count(*) filter (where l.verified_at is not null and l.call_completed_at is not null)::int as completed,
        count(*) filter (where l.verified_at is not null and l.proposal_sent_at is not null)::int as proposals,
        count(*) filter (where l.verified_at is not null and l.proposal_accepted_at is not null)::int as accepted,
        count(*) filter (where l.verified_at is not null and l.converted_at is not null)::int as converted,
        coalesce(sum(case when l.converted_at is not null and l.client_id is not null then ${net(tx)} end), 0)::float as revenue,
        coalesce(avg(extract(epoch from (l.converted_at - l.created_at)) / 86400) filter (where l.converted_at is not null), 0)::float as avg_days
      from leads l left join referral_attributions a on a.lead_id = l.id where ${where(tx, f)}`;
    const byReferrer = await tx<{ client_id: string; business_name: string; verified: number; converted: number; revenue: number }[]>`
      select a.referrer_client_id as client_id, rc.business_name, count(*) filter (where l.verified_at is not null)::int as verified,
        count(*) filter (where l.converted_at is not null)::int as converted,
        coalesce(sum(case when l.converted_at is not null and l.client_id is not null then ${net(tx)} end), 0)::float as revenue
      from leads l join referral_attributions a on a.lead_id = l.id join client_profiles rc on rc.id = a.referrer_client_id where ${where(tx, f)}
      group by 1, 2 order by converted desc, verified desc, revenue desc limit 20`;
    const byService = await tx<{ service: string; verified: number; converted: number }[]>`
      select coalesce(l.service, 'Not specified') as service, count(*) filter (where l.verified_at is not null)::int as verified, count(*) filter (where l.converted_at is not null)::int as converted
      from leads l left join referral_attributions a on a.lead_id = l.id where ${where(tx, f)} group by 1 order by verified desc`;
    const stages = await tx<{ stage: string; n: number }[]>`
      select l.stage, count(*)::int as n from leads l left join referral_attributions a on a.lead_id = l.id where ${where(tx, f)} group by 1`;
    const sources = await tx<{ source: string; leads: number; converted: number }[]>`
      select source, count(*)::int as leads, count(*) filter (where converted_at is not null)::int as converted from leads
      where ${range("created_at")} group by 1 order by leads desc`;
    const monthly = await tx<{ month: string; verified: number; converted: number }[]>`
      select to_char(date_trunc('month', l.created_at at time zone 'Asia/Kolkata'), 'YYYY-MM') as month,
        count(*) filter (where l.verified_at is not null)::int as verified, count(*) filter (where l.converted_at is not null)::int as converted
      from leads l left join referral_attributions a on a.lead_id = l.id where ${where(tx, f)} group by 1 order by 1`;
    const revenueTrend = await tx<{ month: string; revenue: number }[]>`
      select to_char(date_trunc('month', coalesce(x.paid_on::timestamptz, x.created_at) at time zone 'Asia/Kolkata'), 'YYYY-MM') as month,
        sum(case when x.status = 'confirmed' then x.amount else -x.amount end)::float as revenue
      from payments x join projects p on p.id = x.project_id
      where x.status in ('confirmed', 'refunded') and p.client_id in (
        select l.client_id from leads l left join referral_attributions a on a.lead_id = l.id where ${where(tx, f)} and l.converted_at is not null and l.client_id is not null)
      group by 1 order by 1`;
    const ttc = await tx<{ bucket: string; n: number }[]>`
      select case when d <= 14 then '0–14 days' when d <= 30 then '15–30 days' when d <= 60 then '31–60 days' when d <= 90 then '61–90 days' else '90+ days' end as bucket, count(*)::int as n
      from (select extract(epoch from (l.converted_at - l.created_at)) / 86400 as d from leads l left join referral_attributions a on a.lead_id = l.id
            where ${where(tx, f)} and l.converted_at is not null) t group by 1`;
    return {
      counts: { ...c, invitations: inv.invitations, invitations_accepted: inv.accepted, visits: vis.visits },
      rates: {
        acceptance: pct(inv.accepted, inv.invitations), conversion_rate: pct(c.converted, c.verified), qualification_rate: pct(c.qualified, c.verified),
        booking_rate: pct(c.booked, c.verified), call_completion: pct(c.completed, c.booked), proposal_acceptance: pct(c.accepted, c.proposals),
      },
      avgDaysToConversion: Math.round(c.avg_days * 10) / 10,
      byReferrer, byService, stages, sources, monthly, revenueTrend,
      timeToConversion: ["0–14 days", "15–30 days", "31–60 days", "61–90 days", "90+ days"].map((b) => ({ bucket: b, n: ttc.find((x) => x.bucket === b)?.n ?? 0 })),
    };
  });
}
