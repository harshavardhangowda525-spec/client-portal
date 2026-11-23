-- Infinity Web & Apps — Premium client experience & growth portal.
-- Service marketplace + upgrade requests, referral reward campaigns, AI service advisor, client meetings,
-- success showcase + testimonials and notification preferences.
-- Reuses leads (the sales pipeline), discovery_calls (one shared calendar), notifications, audit_logs and referral_events.
-- Never touches existing financial records.

select set_config('app.role', 'system', false);

-- ---------------------------------------------------------------------------
-- UPI payee for scan-to-pay QR codes (only filled in when no UPI ID has been saved yet)
-- ---------------------------------------------------------------------------
insert into app_settings (key, value) values ('payment_details', '{"upi_id": "9980801231@ybl", "payee_name": "Infinity Web & Apps"}')
on conflict (key) do update set
  value = app_settings.value || jsonb_build_object('upi_id', '9980801231@ybl')
        || case when coalesce(app_settings.value->>'payee_name', '') = '' then '{"payee_name": "Infinity Web & Apps"}'::jsonb else '{}'::jsonb end,
  updated_at = now()
where coalesce(app_settings.value->>'upi_id', '') = '';

-- ---------------------------------------------------------------------------
-- Client preferences
-- ---------------------------------------------------------------------------
alter table client_profiles add column notify_email boolean not null default true;
alter table client_profiles add column notify_whatsapp boolean not null default false;
alter table client_profiles add column whatsapp_consent_at timestamptz;
alter table client_profiles add column hide_recommendations boolean not null default false;

-- ---------------------------------------------------------------------------
-- Pipeline: new opportunity sources
-- ---------------------------------------------------------------------------
alter table leads drop constraint leads_source_check;
alter table leads add constraint leads_source_check check (source in ('client_referral', 'direct', 'manual', 'other', 'upgrade_request', 'ai_advisor'));

-- ---------------------------------------------------------------------------
-- 5. Service marketplace
-- ---------------------------------------------------------------------------
create table service_catalog (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name         text not null check (length(name) between 1 and 120),
  category     text not null check (category in ('websites', 'apps', 'software', 'ai_automation', 'care')),
  icon         text not null default 'grid' check (length(icon) <= 40),
  summary      text not null check (length(summary) between 1 and 300),
  details      text check (length(details) <= 5000),
  benefits     text[] not null default '{}',
  price_label  text check (length(price_label) <= 80),   -- null = "Request a quote"
  industries   text[] not null default '{}',             -- lower-case keywords used for recommendations
  position     int not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger service_catalog_updated before update on service_catalog for each row execute function set_updated_at();

create table service_inquiries (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references client_profiles(id) on delete cascade,
  service_id  uuid not null references service_catalog(id) on delete restrict,
  project_id  uuid references projects(id) on delete set null,
  note        text check (length(note) <= 2000),
  source      text not null default 'marketplace' check (source in ('marketplace', 'ai_advisor', 'recommendation')),
  status      text not null default 'received' check (status in ('received', 'in_review', 'proposal_sent', 'closed')),
  lead_id     uuid references leads(id) on delete set null,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index service_inquiries_open_idx on service_inquiries (client_id, service_id) where status in ('received', 'in_review');
create trigger service_inquiries_updated before update on service_inquiries for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Referral reward campaigns (rewards are never issued automatically)
-- ---------------------------------------------------------------------------
create table referral_campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(name) between 1 and 120),
  reward_type  text not null check (reward_type in ('renewal_credit', 'discount', 'cash', 'gift')),
  reward_value numeric(12,2) not null default 0 check (reward_value >= 0),
  reward_text  text not null check (length(reward_text) between 1 and 200),   -- e.g. "₹2,000 off your next renewal"
  eligibility  text not null default 'first_payment' check (eligibility in ('first_payment', 'proposal_accepted')),
  terms        text check (length(terms) <= 2000),
  starts_on    date not null default current_date,
  ends_on      date check (ends_on is null or ends_on >= starts_on),
  is_active    boolean not null default true,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger referral_campaigns_updated before update on referral_campaigns for each row execute function set_updated_at();

create table referral_rewards (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null unique references leads(id) on delete cascade,
  campaign_id    uuid not null references referral_campaigns(id) on delete restrict,
  client_id      uuid not null references client_profiles(id) on delete cascade,   -- the referrer
  reward_text    text not null,
  reward_value   numeric(12,2) not null default 0,
  status         text not null default 'eligible' check (status in ('eligible', 'approved', 'rejected', 'issued', 'reversed')),
  decided_by     uuid references users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text check (length(decision_note) <= 1000),
  issued_at      timestamptz,
  fulfilment_note text check (length(fulfilment_note) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index referral_rewards_client_idx on referral_rewards (client_id, status);
create trigger referral_rewards_updated before update on referral_rewards for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. AI service advisor (conversations kept for a limited time; clients can delete them)
-- ---------------------------------------------------------------------------
create table advisor_conversations (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references client_profiles(id) on delete cascade,
  user_id                  uuid references users(id) on delete set null,
  mode                     text not null default 'ai' check (mode in ('ai', 'guided')),
  consultation_requested_at timestamptz,
  lead_id                  uuid references leads(id) on delete set null,
  expires_at               timestamptz not null default now() + interval '90 days',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index advisor_conversations_client_idx on advisor_conversations (client_id, created_at desc);
create trigger advisor_conversations_updated before update on advisor_conversations for each row execute function set_updated_at();

create table advisor_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references advisor_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (length(content) between 1 and 4000),
  services        text[] not null default '{}',   -- service_catalog slugs suggested in this reply
  created_at      timestamptz not null default now()
);
create index advisor_messages_conv_idx on advisor_messages (conversation_id, created_at);

alter table resolve_ai_logs drop constraint resolve_ai_logs_operation_check;
alter table resolve_ai_logs add constraint resolve_ai_logs_operation_check check (operation in
  ('clarify', 'transcribe', 'briefing', 'gap_check', 'daily_summary', 'feedback_summary', 'lead_qualify', 'follow_up_draft', 'referral_insights', 'advisor'));

-- ---------------------------------------------------------------------------
-- 8. Client meetings share the discovery-call calendar (one unique start-time index → no double booking)
-- ---------------------------------------------------------------------------
alter table discovery_calls alter column lead_id drop not null;
alter table discovery_calls add column client_id uuid references client_profiles(id) on delete cascade;
alter table discovery_calls add column project_id uuid references projects(id) on delete set null;
alter table discovery_calls add column purpose text check (purpose in ('consultation', 'project_checkin', 'design_walkthrough', 'support'));
alter table discovery_calls add column agenda text check (length(agenda) <= 2000);
alter table discovery_calls drop constraint discovery_calls_booked_by_check;
alter table discovery_calls add constraint discovery_calls_booked_by_check check (booked_by in ('prospect', 'team', 'client'));
alter table discovery_calls add constraint discovery_calls_subject_check check (lead_id is not null or client_id is not null);
create index discovery_calls_client_idx on discovery_calls (client_id, starts_at desc);

-- ---------------------------------------------------------------------------
-- 10. Success showcase + testimonials (nothing is public without recorded permission)
-- ---------------------------------------------------------------------------
create table showcase_items (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  title              text not null check (length(title) between 1 and 160),
  client_label       text not null check (length(client_label) between 1 and 160),   -- what may be shown publicly
  client_id          uuid references client_profiles(id) on delete set null,
  project_id         uuid references projects(id) on delete set null,
  industry           text not null check (length(industry) between 1 and 60),
  service_type       text not null check (length(service_type) between 1 and 60),
  summary            text not null check (length(summary) between 1 and 400),
  story              text check (length(story) <= 8000),
  metrics            jsonb not null default '[]',   -- [{label, value}] each approved by the client
  live_url           text check (live_url is null or live_url ~ '^https://'),
  has_before_image   boolean not null default false,
  has_after_image    boolean not null default false,
  permission_confirmed_at timestamptz,
  permission_note    text check (length(permission_note) <= 1000),
  status             text not null default 'draft' check (status in ('draft', 'published')),
  published_at       timestamptz,
  position           int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (status = 'draft' or permission_confirmed_at is not null)
);
create trigger showcase_items_updated before update on showcase_items for each row execute function set_updated_at();

create table showcase_images (
  item_id    uuid not null references showcase_items(id) on delete cascade,
  kind       text not null check (kind in ('before', 'after')),
  mime_type  text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  data       bytea not null,
  updated_at timestamptz not null default now(),
  primary key (item_id, kind)
);

create table testimonials (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references client_profiles(id) on delete cascade,
  project_id     uuid references projects(id) on delete set null,
  author_id      uuid references users(id) on delete set null,
  quote          text not null check (length(quote) between 10 and 1200),
  display_name   text not null check (length(display_name) between 1 and 120),
  display_role   text check (length(display_role) <= 120),
  rating         int check (rating between 1 and 5),
  consent_at     timestamptz not null,               -- the client's consent to publish this exact text
  status         text not null default 'submitted' check (status in ('submitted', 'published', 'rejected', 'withdrawn')),
  reviewed_by    uuid references users(id) on delete set null,
  reviewed_at    timestamptz,
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger testimonials_updated before update on testimonials for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['service_catalog', 'service_inquiries', 'referral_campaigns', 'referral_rewards', 'advisor_conversations',
                           'advisor_messages', 'showcase_items', 'showcase_images', 'testimonials'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy staff_all on %I for all using (app_is_staff()) with check (app_is_staff())', t);
  end loop;
end $$;

create policy client_read on service_catalog for select using (app_role() = 'client' and is_active);
create policy client_read on service_inquiries for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on referral_campaigns for select using (app_role() = 'client' and is_active);
create policy client_read on referral_rewards for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on advisor_conversations for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on advisor_messages for select using (app_role() = 'client' and exists
  (select 1 from advisor_conversations c where c.id = conversation_id and c.client_id = app_client_id()));
create policy client_read on testimonials for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on discovery_calls for select using (app_role() = 'client' and client_id is not null and client_id = app_client_id());

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------
insert into service_catalog (slug, name, category, icon, summary, benefits, price_label, industries, position) values
  ('business-website', 'Business website', 'websites', 'globe', 'A fast, modern website that turns visitors into enquiries.', '{"Mobile-first design","Search-engine basics included"}', null, '{"all"}', 10),
  ('ecommerce', 'E-commerce store', 'websites', 'cart', 'Sell products online with UPI and card checkout.', '{"Orders and inventory","GST-ready invoices"}', null, '{"retail","shop","store","bakery","food","fashion","boutique"}', 20),
  ('mobile-app', 'Mobile app', 'apps', 'phone', 'Android and iOS apps your customers keep using.', '{"Push reminders","Bookings and payments in the app"}', null, '{"gym","fitness","restaurant","clinic","salon","education"}', 30),
  ('crm', 'Customer & member CRM', 'software', 'users', 'Every customer, visit and follow-up in one place.', '{"Visit and purchase history","Automatic follow-ups"}', null, '{"clinic","physio","dental","gym","fitness","salon","restaurant","real estate","education"}', 40),
  ('billing-software', 'Billing & invoice software', 'software', 'receipt', 'Create GST invoices and track dues without spreadsheets.', '{"UPI payment links","Daily collection report"}', null, '{"clinic","physio","dental","retail","shop","gym","restaurant","pharmacy"}', 50),
  ('appointment-booking', 'Appointment booking', 'software', 'calendar', 'Online booking with reminders, so fewer people miss appointments.', '{"WhatsApp and email reminders","Staff calendars"}', null, '{"clinic","physio","dental","salon","spa","consultant","doctor","restaurant"}', 60),
  ('ai-receptionist', 'AI receptionist', 'ai_automation', 'headset', 'Answers calls and chats when you are busy and books visits for you.', '{"Handles common questions","Hands complex calls to your team"}', null, '{"clinic","physio","dental","salon","restaurant","hotel","real estate"}', 70),
  ('ai-automation', 'AI business automation', 'ai_automation', 'sparkles', 'Let software handle repeat admin work.', '{"Lead follow-up","Reports prepared for you"}', null, '{"all"}', 80),
  ('whatsapp-automation', 'WhatsApp automation', 'ai_automation', 'message', 'Official WhatsApp Business messages, sent only with consent.', '{"Reminders and offers","Meta message fees shown up front"}', null, '{"gym","fitness","restaurant","clinic","retail","salon"}', 90),
  ('website-maintenance', 'Website maintenance', 'care', 'wrench', 'Updates, backups, security checks and small edits.', '{"Monthly health check","Priority fixes"}', null, '{"all"}', 100),
  ('client-dashboard', 'Client & business dashboards', 'software', 'layout', 'Live numbers for your business on one screen.', '{"Bookings and revenue","Team performance"}', null, '{"gym","clinic","agency","retail","restaurant"}', 110),
  ('custom-software', 'Custom software', 'software', 'code', 'Need something specific? We design and build it.', '{"Discovery workshop","Fixed milestones"}', null, '{"all"}', 120)
on conflict (slug) do nothing;

insert into app_settings (key, value) values
  ('growth', '{"advisor_enabled": true, "advisor_retention_days": 90, "recommendations_enabled": true, "showcase_enabled": true}')
on conflict (key) do nothing;

select set_config('app.role', '', false);
