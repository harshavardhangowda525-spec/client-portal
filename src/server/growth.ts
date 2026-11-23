import { withDb, assertAdmin, type Actor, type Tx } from "./core";
import { addDays, istToday } from "@/lib/dates";

/**
 * Admin revenue & growth dashboard. Every number comes from stored records; definitions are listed in DEFINITIONS and
 * shown on the page. Money counts confirmed payments net of refunds only.
 */
export const PIPELINE = [
  { key: "new", label: "New lead", stages: ["enquiry_submitted"] },
  { key: "contacted", label: "Contacted", stages: ["verification_pending"] },
  { key: "interested", label: "Interested", stages: ["qualified"] },
  { key: "demo", label: "Demo scheduled", stages: ["call_scheduled", "call_completed"] },
  { key: "proposal", label: "Proposal sent", stages: ["proposal_sent", "negotiation"] },
  { key: "won", label: "Won", stages: ["won"] },
  { key: "lost", label: "Lost", stages: ["lost", "disqualified"] },
] as const;

export const DEFINITIONS: Record<string, string> = {
  activeClients: "Clients with at least one project that isn't completed, cancelled or declined.",
  activeProjects: "Projects in progress, waiting on the client, or on hold.",
  pendingApprovals: "Open approval requests plus preview versions waiting for the client's review.",
  outstanding: "Unpaid balance of issued and partly paid invoices.",
  upgradeRequests: "Service upgrade requests created in the period (marketplace and AI advisor).",
  referralSubmissions: "Leads created in the period from referral links and introductions.",
  qualifiedLeads: "Leads that reached “qualified” in the period.",
  conversionRate: "Leads created in the period that are now won, divided by all leads created in the period.",
  upgradeRevenue: "Confirmed payments (net of refunds) in the period on projects a client started after their won upgrade request.",
  referralRevenue: "Confirmed payments (net of refunds) in the period from clients who came through a referral.",
  renewals: "Projects whose free maintenance ends, or whose paid maintenance bills, within the next 30 days.",
};

const netPayments = (tx: Tx, from: string, to: string) => tx`
  coalesce(sum(case when x.status = 'confirmed' then x.amount when x.status = 'refunded' then -x.amount else 0 end), 0)
  from payments x join projects p on p.id = x.project_id
  where x.status in ('confirmed', 'refunded') and coalesce(x.paid_on, x.created_at::date) between ${from} and ${to}`;

export async function growthDashboard(actor: Actor, days = 90) {
  assertAdmin(actor);
  const to = istToday();
  const from = addDays(to, -Math.max(1, Math.min(days, 730)) + 1);
  return withDb(actor, async (tx) => {
    const [k] = await tx<Record<"activeClients" | "activeProjects" | "pendingApprovals" | "outstanding" | "outstandingCount" | "upgradeRequests" | "referralSubmissions" | "qualifiedLeads" | "leadsCreated" | "leadsWon" | "upgradeRevenue" | "referralRevenue" | "renewals", number>[]>`select
      (select count(distinct client_id)::int from projects where status not in ('completed', 'cancelled', 'declined')) as "activeClients",
      (select count(*)::int from projects where status in ('active', 'awaiting_client', 'on_hold', 'quotation_accepted')) as "activeProjects",
      (select count(*)::int from approval_requests where status = 'pending') + (select count(*)::int from previews where status = 'ready_for_review') as "pendingApprovals",
      (select coalesce(sum(i.amount - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.status = 'confirmed'), 0)), 0)::float
         from invoices i where i.status in ('issued', 'partially_paid')) as outstanding,
      (select count(*)::int from invoices where status in ('issued', 'partially_paid')) as "outstandingCount",
      (select count(*)::int from service_inquiries where created_at::date between ${from} and ${to}) as "upgradeRequests",
      (select count(*)::int from leads where source = 'client_referral' and created_at::date between ${from} and ${to}) as "referralSubmissions",
      (select count(*)::int from leads where qualified_at::date between ${from} and ${to}) as "qualifiedLeads",
      (select count(*)::int from leads where created_at::date between ${from} and ${to}) as "leadsCreated",
      (select count(*)::int from leads where created_at::date between ${from} and ${to} and stage = 'won') as "leadsWon",
      (select ${netPayments(tx, from, to)} and exists (select 1 from leads l where l.client_id = p.client_id and l.source in ('upgrade_request', 'ai_advisor')
         and l.stage = 'won' and p.created_at >= l.created_at))::float as "upgradeRevenue",
      (select ${netPayments(tx, from, to)} and exists (select 1 from leads l join referral_attributions a on a.lead_id = l.id where l.client_id = p.client_id))::float as "referralRevenue",
      (select count(*)::int from projects where (free_maintenance_end_date between ${to} and ${addDays(to, 30)})
         or (maintenance_status = 'PAID_MAINTENANCE_ACTIVE' and next_billing_date between ${to} and ${addDays(to, 30)})) as renewals`;

    const months = await tx<{ month: string; upgrades: number; referrals: number }[]>`
      with m as (select to_char(d, 'YYYY-MM') as month, d::date as start, (d + interval '1 month' - interval '1 day')::date as stop
                 from generate_series(date_trunc('month', ${to}::date) - interval '5 months', date_trunc('month', ${to}::date), interval '1 month') d)
      select m.month,
        (select coalesce(sum(case when x.status = 'confirmed' then x.amount else -x.amount end), 0) from payments x join projects p on p.id = x.project_id
          where x.status in ('confirmed', 'refunded') and coalesce(x.paid_on, x.created_at::date) between m.start and m.stop
          and exists (select 1 from leads l where l.client_id = p.client_id and l.source in ('upgrade_request', 'ai_advisor') and l.stage = 'won' and p.created_at >= l.created_at))::float as upgrades,
        (select coalesce(sum(case when x.status = 'confirmed' then x.amount else -x.amount end), 0) from payments x join projects p on p.id = x.project_id
          where x.status in ('confirmed', 'refunded') and coalesce(x.paid_on, x.created_at::date) between m.start and m.stop
          and exists (select 1 from leads l join referral_attributions a on a.lead_id = l.id where l.client_id = p.client_id))::float as referrals
      from m order by m.month`;

    const leads = await tx<{ id: string; business_name: string; service: string | null; source: string; stage: string; owner_name: string | null; next_task: string | null; updated_at: Date }[]>`
      select l.id, l.business_name, l.service, l.source, l.stage, u.name as owner_name, l.updated_at,
        (select t.description from lead_tasks t where t.lead_id = l.id and t.status = 'open' order by t.due_at nulls last limit 1) as next_task
      from leads l left join users u on u.id = l.owner_id
      where l.stage not in ('won', 'lost', 'disqualified') or l.updated_at > now() - interval '30 days'
      order by l.updated_at desc limit 300`;

    const [health] = await tx<{ failedEvents: number; failedEmails: number; sentEmails: number; processed: number }[]>`select
      (select count(*)::int from referral_events where status = 'failed') as "failedEvents",
      (select count(*)::int from message_deliveries where status = 'failed' and created_at > now() - interval '7 days') as "failedEmails",
      (select count(*)::int from message_deliveries where status = 'sent' and created_at > now() - interval '7 days') as "sentEmails",
      (select count(*)::int from referral_events where status = 'processed' and created_at > now() - interval '7 days') as processed`;

    return {
      range: { from, to, days },
      kpis: { ...k, conversionRate: k.leadsCreated ? Math.round((k.leadsWon / k.leadsCreated) * 1000) / 10 : null },
      months,
      pipeline: PIPELINE.map((p) => ({ ...p, leads: leads.filter((l) => (p.stages as readonly string[]).includes(l.stage)) })),
      health,
    };
  });
}
