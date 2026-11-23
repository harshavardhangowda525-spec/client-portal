-- Infinity Web & Apps — Intelligent Client Referral Engine.
-- Feedback after completed projects, referral links and introductions, leads (the portal's CRM pipeline),
-- discovery calls, attribution and an automation event log. Reuses client_profiles, projects, proposals,
-- invoices, payments, notifications, message_deliveries, resolve_tickets and audit_logs.

select set_config('app.role', 'system', false);

-- Client communication preference for referral emails/reminders (in-portal notices are always shown).
alter table client_profiles add column referral_emails_opt_out boolean not null default false;

-- ---------------------------------------------------------------------------
-- Workflow per project (one per project; reopening pauses it, re-completing resumes it)
-- ---------------------------------------------------------------------------
create table referral_workflows (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null unique references projects(id) on delete cascade,
  client_id               uuid not null references client_profiles(id) on delete cascade,
  status                  text not null default 'awaiting_feedback' check (status in
    ('awaiting_feedback', 'feedback_received', 'referral_eligible', 'on_hold', 'suppressed', 'paused', 'cancelled', 'not_eligible')),
  status_reason           text,
  completed_at            timestamptz not null,
  feedback_requested_at   timestamptz,
  reminders_sent          int not null default 0,
  next_reminder_at        timestamptz,
  invitation_available_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index referral_workflows_status_idx on referral_workflows (status, next_reminder_at);
create trigger referral_workflows_updated before update on referral_workflows for each row execute function set_updated_at();

create table project_feedback (
  id                    uuid primary key default gen_random_uuid(),
  workflow_id           uuid not null unique references referral_workflows(id) on delete cascade,  -- one submission per completion
  project_id            uuid not null references projects(id) on delete cascade,
  client_id             uuid not null references client_profiles(id) on delete cascade,
  user_id               uuid references users(id) on delete set null,
  satisfaction          int not null check (satisfaction between 1 and 5),
  quality               int not null check (quality between 1 and 5),
  communication         int not null check (communication between 1 and 5),
  delivery              int not null check (delivery between 1 and 5),
  overall               int not null check (overall between 1 and 5),
  comments              text check (length(comments) <= 5000),
  suggestions           text check (length(suggestions) <= 5000),
  testimonial_consent   boolean not null default false,
  testimonial_approved  boolean not null default false,   -- admin review; only shown publicly with consent
  sentiment             text not null check (sentiment in ('high', 'moderate', 'low')),
  issue_status          text not null default 'none' check (issue_status in ('none', 'open', 'resolved')),
  issue_assigned_to     uuid references users(id) on delete set null,
  issue_note            text,
  resolve_ticket_id     uuid references resolve_tickets(id) on delete set null,
  ai_summary            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index project_feedback_created_idx on project_feedback (created_at desc);
create trigger project_feedback_updated before update on project_feedback for each row execute function set_updated_at();

create table referral_invitations (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null unique references referral_workflows(id) on delete cascade,
  client_id   uuid not null references client_profiles(id) on delete cascade,
  status      text not null default 'available' check (status in ('available', 'accepted', 'dismissed', 'withdrawn')),
  created_at  timestamptz not null default now(),
  responded_at timestamptz
);

-- One shareable link per client (regenerating replaces the token; old tokens stop working).
create table referral_links (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null unique references client_profiles(id) on delete cascade,
  created_by  uuid references users(id) on delete set null,
  token       text not null unique check (length(token) >= 32),
  status      text not null default 'active' check (status in ('active', 'disabled')),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger referral_links_updated before update on referral_links for each row execute function set_updated_at();

create table referral_visits (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references referral_links(id) on delete cascade,
  visitor     text not null,   -- sha256 of IP + date: counts unique daily visitors without storing the IP
  visited_on  date not null,
  created_at  timestamptz not null default now(),
  unique (link_id, visitor, visited_on)
);

-- ---------------------------------------------------------------------------
-- Leads: the portal's sales pipeline (referrals and other sources). Converted leads point at their client.
-- ---------------------------------------------------------------------------
create table leads (
  id                   uuid primary key default gen_random_uuid(),
  source               text not null default 'client_referral' check (source in ('client_referral', 'direct', 'manual', 'other')),
  stage                text not null default 'enquiry_submitted' check (stage in
    ('enquiry_submitted', 'verification_pending', 'qualified', 'call_scheduled', 'call_completed', 'proposal_sent', 'negotiation', 'won', 'lost', 'disqualified')),
  business_name        text not null check (length(business_name) between 1 and 200),
  contact_name         text check (length(contact_name) <= 200),
  email                text check (length(email) <= 320),
  phone                text check (length(phone) <= 40),
  business_category    text check (length(business_category) <= 100),
  service              text check (length(service) <= 100),
  problem              text check (length(problem) <= 5000),
  budget_range         text check (length(budget_range) <= 60),
  preferred_contact    text check (preferred_contact in ('phone', 'whatsapp', 'email', 'video_call', 'in_person')),
  intro_note           text check (length(intro_note) <= 2000),
  contact_consent_at   timestamptz,          -- the prospect's own consent to be contacted
  contact_permission   boolean not null default false,  -- for introductions: the referrer confirmed permission to share contact details
  owner_id             uuid references users(id) on delete set null,
  client_id            uuid references client_profiles(id) on delete set null,   -- set when the lead becomes (or already is) a client
  flags                text[] not null default '{}',   -- e.g. self_referral, existing_client, suspicious
  lost_reason          text,
  ai_assessment        jsonb,
  booking_token_hash   text unique,
  verified_at          timestamptz,
  qualified_at         timestamptz,
  call_booked_at       timestamptz,
  call_completed_at    timestamptz,
  proposal_sent_at     timestamptz,
  proposal_accepted_at timestamptz,
  converted_at         timestamptz,
  closed_at            timestamptz,
  submitted_ip         text,                  -- hashed
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index leads_stage_idx on leads (stage, created_at desc);
create index leads_email_idx on leads (lower(email)) where email is not null;
create index leads_client_idx on leads (client_id) where client_id is not null;
create trigger leads_updated before update on leads for each row execute function set_updated_at();

-- First-touch attribution, written once and never changed.
create table referral_attributions (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null unique references leads(id) on delete cascade,
  referrer_client_id  uuid not null references client_profiles(id) on delete cascade,
  referrer_user_id    uuid references users(id) on delete set null,
  link_id             uuid references referral_links(id) on delete set null,
  project_id          uuid references projects(id) on delete set null,   -- the referrer's completed project
  method              text not null check (method in ('link', 'introduction')),
  created_at          timestamptz not null default now()
);
create trigger referral_attributions_locked before update on referral_attributions for each row execute function forbid_change();

create table lead_activities (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads(id) on delete cascade,
  actor_id   uuid references users(id) on delete set null,
  kind       text not null check (kind in ('created', 'stage', 'note', 'call', 'email', 'task', 'proposal', 'payment', 'duplicate', 'ai_draft', 'system')),
  body       text not null check (length(body) between 1 and 5000),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index lead_activities_lead_idx on lead_activities (lead_id, created_at desc);

create table lead_tasks (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  description  text not null check (length(description) between 1 and 1000),
  due_at       timestamptz,
  status       text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  assigned_to  uuid references users(id) on delete set null,
  dedupe_key   text unique,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index lead_tasks_open_idx on lead_tasks (status, due_at);

-- Discovery calls on the internal availability calendar. One booking per slot.
create table discovery_calls (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  owner_id     uuid references users(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null check (ends_at > starts_at),
  meeting_type text not null check (meeting_type in ('video_call', 'phone', 'whatsapp', 'in_person')),
  meeting_link text check (length(meeting_link) <= 500),
  status       text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  outcome      text check (outcome in ('qualified', 'proposal_requested', 'not_a_fit', 'follow_up', 'no_show')),
  notes        text check (length(notes) <= 5000),
  booked_by    text not null default 'prospect' check (booked_by in ('prospect', 'team')),
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index discovery_calls_slot_uq on discovery_calls (starts_at) where status = 'scheduled';
create index discovery_calls_lead_idx on discovery_calls (lead_id, starts_at desc);
create trigger discovery_calls_updated before update on discovery_calls for each row execute function set_updated_at();

-- Automation events: every step is recorded, processed idempotently and retried on failure.
create table referral_events (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,
  dedupe_key   text not null unique,
  project_id   uuid references projects(id) on delete set null,
  client_id    uuid references client_profiles(id) on delete set null,
  lead_id      uuid references leads(id) on delete set null,
  workflow_id  uuid references referral_workflows(id) on delete set null,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending', 'processed', 'failed', 'skipped')),
  attempts     int not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index referral_events_status_idx on referral_events (status, created_at);
create index referral_events_type_idx on referral_events (type, created_at desc);

-- AI logs gain referral operations.
alter table resolve_ai_logs drop constraint resolve_ai_logs_operation_check;
alter table resolve_ai_logs add constraint resolve_ai_logs_operation_check check (operation in
  ('clarify', 'transcribe', 'briefing', 'gap_check', 'daily_summary', 'feedback_summary', 'lead_qualify', 'follow_up_draft', 'referral_insights'));

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['referral_workflows', 'project_feedback', 'referral_invitations', 'referral_links', 'referral_visits', 'leads',
    'referral_attributions', 'lead_activities', 'lead_tasks', 'discovery_calls', 'referral_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy staff_all on %I for all using (app_is_staff()) with check (app_is_staff())', t);
  end loop;
end $$;
-- Clients read only their own workflow, feedback, invitation and link. Leads and everything sales-related stay staff-only.
create policy client_read on referral_workflows for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on project_feedback for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on referral_invitations for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on referral_links for select using (app_role() = 'client' and client_id = app_client_id());

-- ---------------------------------------------------------------------------
-- Settings (Admin → Referrals → Settings) and the discovery-call calendar
-- ---------------------------------------------------------------------------
insert into app_settings (key, value) values
  ('referrals', '{
    "enabled": true,
    "paused": false,
    "email_enabled": true,
    "feedback_delay_hours": 0,
    "reminder_days": [3, 7],
    "high_threshold": 4,
    "low_threshold": 2,
    "invitation_delay_days": 0,
    "require_no_open_complaints": true,
    "link_expiry_days": 365,
    "follow_up_days": 2,
    "proposal_follow_up_days": 3,
    "default_owner_id": "",
    "max_enquiries_per_hour": 5,
    "conversion_rule": "first_payment",
    "share_template": "Hi! I recently worked with Infinity Web & Apps for my business project. If you are looking for a website, app or business automation solution, you can explore their services here: {{link}}",
    "landing_headline": "Better technology for your business",
    "landing_intro": "Infinity Web & Apps builds websites, mobile apps and AI automation that help growing businesses win customers and save time.",
    "landing_services": ["Business websites", "Mobile apps", "AI automation & chatbots", "Online booking & ordering", "Customer management (CRM)", "Website care & maintenance"],
    "landing_problems": ["Customers can''t find you online", "Bookings and enquiries are handled by phone and WhatsApp", "Repetitive admin takes hours every week", "Your website is slow, old or hard to update"]
  }'),
  ('booking', '{
    "timezone": "Asia/Kolkata",
    "slot_minutes": 30,
    "min_notice_hours": 12,
    "horizon_days": 21,
    "weekly": {"mon": [["10:00", "13:00"], ["15:00", "18:00"]], "tue": [["10:00", "13:00"], ["15:00", "18:00"]], "wed": [["10:00", "13:00"], ["15:00", "18:00"]],
               "thu": [["10:00", "13:00"], ["15:00", "18:00"]], "fri": [["10:00", "13:00"], ["15:00", "18:00"]], "sat": [], "sun": []},
    "blocked_dates": [],
    "meeting_types": ["video_call", "phone", "whatsapp"],
    "default_meeting_link": ""
  }')
on conflict (key) do nothing;

select set_config('app.role', '', false);
