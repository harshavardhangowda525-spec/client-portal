import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { withDb, SYSTEM, type Actor } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { todayISO } from "@/lib/progress";
import { getProposalDefaults } from "@/server/pricing";
import { saveProposal, sendProposal, proposalLink } from "@/server/proposals";
import { inviteClient } from "@/server/clients";

export const dynamic = "force-dynamic";

/**
 * Sales automation → Client Portal.
 *
 * Called by the Infinity sales system after the founder approves a quotation for a booked lead.
 * Creates (or reuses) the client, creates a proposal with the portal's own pricing engine,
 * publishes it to the client portal, and issues a one-time invitation link.
 *
 * Auth: `Authorization: Bearer <SALES_INTEGRATION_SECRET>`. Acts as the portal admin
 * (SALES_INTEGRATION_ADMIN_EMAIL, or the only active admin).
 */

type Body = {
  business_name: string;
  owner_name?: string | null;
  email: string;
  phone?: string | null;
  plan?: "BASIC" | "PREMIUM" | "ADVANCED" | "UNKNOWN" | null;
  kind?: "website" | "app" | "mobile" | null;
  plan_price?: number | null;
  plan_name?: string | null;
  plan_features?: string[] | null;
  requirements?: string | null;
  meeting?: string | null;
};

function authorized(req: Request) {
  const secret = process.env.SALES_INTEGRATION_SECRET;
  if (!secret) return false;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function integrationAdmin(): Promise<Actor> {
  const wanted = (process.env.SALES_INTEGRATION_ADMIN_EMAIL || "").trim().toLowerCase();
  const admins = await withDb(SYSTEM, (tx) => tx<{ id: string; name: string; email: string }[]>`
    select id, name, email from users where role = 'admin' and disabled_at is null order by created_at`);
  const admin = wanted ? admins.find((u) => u.email.toLowerCase() === wanted) : admins[0];
  if (!admin) throw new AppError("No active admin account found for the sales integration.");
  return { userId: admin.id, role: "admin", clientId: null, name: admin.name, email: admin.email };
}

const PLAN_WORDS: Record<string, string> = { BASIC: "basic", PREMIUM: "premium", ADVANCED: "advanced" };

export async function POST(req: Request) {
  if (!process.env.SALES_INTEGRATION_SECRET) {
    return NextResponse.json({ error: "Sales integration is not configured." }, { status: 503 });
  }
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const business = String(body.business_name || "").trim();
  if (!business || !email) return NextResponse.json({ error: "business_name and email are required" }, { status: 400 });
  const owner = String(body.owner_name || "").trim() || business;
  const phone = body.phone ? String(body.phone).slice(0, 40) : null;
  const isApp = body.kind === "app" || body.kind === "mobile";

  try {
    const actor = await integrationAdmin();

    // Reuse an existing client with the same email (or phone), otherwise create one through the proposal.
    const { existingClientId, pkg, defaults } = await withDb(actor, async (tx) => {
      const [c] = await tx<{ id: string }[]>`
        select id from client_profiles
        where archived_at is null and (lower(email) = ${email} or (${phone}::text is not null and phone = ${phone}))
        order by created_at limit 1`;
      const word = PLAN_WORDS[String(body.plan || "").toUpperCase()] || "basic";
      const kind = isApp ? "app" : "website";
      const pkgs = await tx<{ id: string; name: string; price: string }[]>`
        select id, name, price from pricing_packages where is_active and kind = ${kind} order by position, price`;
      const match = pkgs.find((p) => p.name.toLowerCase().includes(word));
      return { existingClientId: c?.id ?? null, pkg: match ?? null, defaults: await getProposalDefaults(tx) };
    });

    const validUntil = new Date(`${todayISO()}T00:00:00Z`);
    validUntil.setUTCDate(validUntil.getUTCDate() + (defaults.validity_days || 15));
    const planLabel = body.plan_name || `${(PLAN_WORDS[String(body.plan || "").toUpperCase()] || "basic").replace(/^./, (s) => s.toUpperCase())} ${isApp ? "app" : "website"}`;
    const features = (body.plan_features || []).map((f) => String(f).slice(0, 500)).slice(0, 30);

    const pricing = pkg
      ? { mode: "package" as const, package_ids: [pkg.id], addons: [], custom: [] }
      : {
        mode: "itemized" as const, package_ids: [], addons: [],
        custom: [{ name: planLabel, description: features.join(" · ") || null, quantity: 1, unit_price: Number(body.plan_price) || 0 }],
      };

    const saved = await saveProposal(actor, null, {
      client: existingClientId
        ? { mode: "existing", client_id: existingClientId }
        : { mode: "new", business_name: business, owner_name: owner, email, phone, business_category: null },
      contact: { name: owner, email, phone },
      business_category: null,
      project_id: null,
      title: `${planLabel} for ${business}`.slice(0, 200),
      project_type: body.kind === "mobile" ? "cross_platform_app" : isApp ? "website_app" : "website",
      description: body.requirements || null,
      requirements: body.requirements || null,
      target_launch_date: null,
      assigned_to: null,
      internal_notes: `Created automatically by the Infinity sales automation after the founder approved the quotation.${body.meeting ? ` Consultation: ${body.meeting}.` : ""}`,
      executive_summary: null,
      recommended_solution: null,
      pricing,
      scope_details: { platforms: body.kind === "mobile" ? ["android", "ios"] : isApp ? ["web"] : [] },
      externals: [],
      maintenance: null,
      warranty: { days: defaults.warranty_days, terms: defaults.warranty_terms || null },
      scope: {
        objectives: null, features, pages_screens: [], design_requirements: null, deliverables: [],
        client_responsibilities: [], content_requirements: null, revisions: defaults.revisions,
        milestones: [], timeline: null, acceptance_criteria: null, exclusions: [], assumptions: [],
      },
      discount: { rule_id: null, type: "none", value: 0, max_amount: null, name: null },
      milestones: [
        { label: "Advance to begin work", mode: "percent", value: 50, due: "On acceptance" },
        { label: "On final delivery", mode: "percent", value: 50, due: "On delivery" },
      ],
      valid_until: validUntil.toISOString().slice(0, 10),
      terms: defaults.terms || null,
    });

    // Publish to the client portal (no email — the sales system sends the link on WhatsApp).
    await sendProposal(actor, saved.proposalId, { sendEmail: false });

    // One-time portal invitation; skip if the client already has a portal login with this email.
    let inviteLink: string | null = null;
    try {
      const inv = await inviteClient(actor, saved.clientId, { email, project_id: null }, { sendEmail: false });
      inviteLink = inv.link;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }

    return NextResponse.json({
      ok: true,
      client_id: saved.clientId,
      proposal_id: saved.proposalId,
      number: saved.number,
      total: saved.computed.total,
      used_package: pkg ? pkg.name : null,
      proposal_link: proposalLink(saved.proposalId),
      invite_link: inviteLink,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    const status = err instanceof AppError ? 422 : 500;
    console.error("[sales-integration]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
