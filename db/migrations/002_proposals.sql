-- Infinity Web & Apps — pricing configuration and proposals
-- Adds a central, database-backed pricing catalog and a versioned proposal system.
-- Same security model as 001: RLS is FORCED on every table; clients only read their own
-- proposals (never drafts), and internal data (notes, provider costs) lives in staff-only tables.

-- ---------------------------------------------------------------------------
-- Settings & brand assets
-- ---------------------------------------------------------------------------
create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table app_assets (
  key        text primary key,
  mime_type  text not null check (mime_type in ('image/png', 'image/jpeg')),
  data       bytea not null,
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value) values
  ('business', '{"name": "Infinity Web & Apps", "tagline": "Websites. Mobile Apps. Digital Growth.", "email": "", "phone": "", "address": "", "tax_id": "", "website": ""}'),
  ('tax', '{"enabled": false, "label": "GST", "rate": 18, "apply_to_external": false}'),
  ('proposal_defaults', '{"validity_days": 15, "revisions": 2, "warranty_days": 30,
     "warranty_terms": "Bugs in the delivered scope reported within the warranty period are fixed free of charge. The warranty does not cover new features, changes to approved designs, content updates, problems caused by third-party services, hosting providers or app stores, or changes made by anyone other than Infinity Web & Apps.",
     "discount_applies_to_external": false,
     "terms": "1. Work begins after the initial advance is received and confirmed.\n2. Timelines are estimates and depend on timely feedback, content and approvals from the client.\n3. Features or changes outside the agreed scope are quoted separately.\n4. Domain, hosting, app store and other third-party fees are billed by their providers unless stated otherwise and may change.\n5. Ownership of the delivered work transfers to the client on receipt of full payment.\n6. This proposal is valid until the date shown."}');

-- ---------------------------------------------------------------------------
-- Pricing catalog
-- ---------------------------------------------------------------------------
create table pricing_packages (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('website', 'app')),
  name        text not null check (length(name) between 1 and 200),
  description text,
  price       numeric(14,2) not null check (price >= 0),
  scope_limits jsonb not null default '{}'::jsonb,   -- e.g. {"pages": 5} or {"screens": 10, "integrations": 1, "roles": 2}
  is_active   boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger pricing_packages_updated before update on pricing_packages for each row execute function set_updated_at();

create table pricing_package_items (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid not null references pricing_packages(id) on delete cascade,
  position    int not null,
  name        text not null check (length(name) between 1 and 200),
  description text,
  amount      numeric(14,2) not null check (amount >= 0)
);
create index pricing_package_items_pkg_idx on pricing_package_items (package_id, position);

create table pricing_services (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('website', 'app', 'both')),
  name          text not null check (length(name) between 1 and 200),
  description   text,
  unit          text not null default 'fixed' check (unit in ('fixed', 'per_page', 'per_screen', 'per_item')),
  min_price     numeric(14,2) check (min_price >= 0),
  max_price     numeric(14,2) check (max_price >= 0),
  open_ended    boolean not null default false,       -- shown as "₹2,000–₹10,000+"
  default_price numeric(14,2) check (default_price >= 0), -- null = admin must enter the quoted price
  is_active     boolean not null default true,
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  check (max_price is null or min_price is null or max_price >= min_price)
);

create table external_cost_catalog (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(name) between 1 and 200),
  category      text not null default 'other' check (category in ('domain', 'hosting', 'cloud', 'email', 'ssl', 'app_store', 'messaging', 'api', 'payment_fees', 'other')),
  billing       text not null default 'recurring' check (billing in ('one_time', 'recurring')),
  period        text check (period in ('monthly', 'annual')),
  provider_cost numeric(14,2) check (provider_cost >= 0),   -- null = to be confirmed
  selling_price numeric(14,2) check (selling_price >= 0),   -- null = to be confirmed
  notes         text,
  is_active     boolean not null default true,
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  check (billing = 'one_time' or period is not null)
);

create table maintenance_plans (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('website', 'app')),
  name             text not null check (length(name) between 1 and 100),
  monthly_price    numeric(14,2) not null check (monthly_price >= 0),
  annual_price     numeric(14,2) check (annual_price >= 0),
  included_hours   text,
  bug_fix_coverage text,
  update_frequency text,
  backup_monitoring text,
  support_channel  text,
  response_time    text,
  exclusions       text,
  is_active        boolean not null default true,
  position         int not null default 0,
  created_at       timestamptz not null default now()
);

create table discount_rules (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 100),
  type       text not null check (type in ('percent', 'amount')),
  value      numeric(14,2) not null check (value >= 0),
  max_amount numeric(14,2) check (max_amount >= 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  check (type <> 'percent' or value <= 100)
);

create table milestone_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 100),
  items      jsonb not null,   -- [{label, mode: "percent"|"amount", value, due}]
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Default catalog (editable in Settings → Pricing configuration)
-- ---------------------------------------------------------------------------
do $$
declare w uuid; a uuid;
begin
  insert into pricing_packages (kind, name, description, price, scope_limits, position)
  values ('website', 'Basic business website', 'A professional, mobile-friendly website for a small business.', 4999, '{"pages": 5}', 1)
  returning id into w;
  insert into pricing_package_items (package_id, position, name, amount) values
    (w, 1, 'UI/UX and layout design', 800),
    (w, 2, 'Frontend development', 1400),
    (w, 3, 'Mobile responsiveness', 500),
    (w, 4, 'Contact form and WhatsApp link', 400),
    (w, 5, 'Basic SEO setup', 400),
    (w, 6, 'Testing and bug fixes', 500),
    (w, 7, 'Deployment and handover', 499),
    (w, 8, 'Project setup and coordination', 500);

  insert into pricing_packages (kind, name, description, price, scope_limits, position)
  values ('app', 'Basic business mobile app', 'A starter mobile app with login, core screens and a simple backend.', 55000,
          '{"screens": 10, "integrations": 1, "roles": 2, "backend": "simple"}', 2)
  returning id into a;
  insert into pricing_package_items (package_id, position, name, amount) values
    (a, 1, 'Requirements and project planning', 3000),
    (a, 2, 'UI/UX design', 6000),
    (a, 3, 'App frontend development', 15000),
    (a, 4, 'Backend and API development', 10000),
    (a, 5, 'Database setup', 4000),
    (a, 6, 'Login and basic user features', 4000),
    (a, 7, 'Testing and bug fixes', 4000),
    (a, 8, 'Deployment and release preparation', 3000),
    (a, 9, 'Project management and handover', 6000);
end $$;

insert into pricing_services (category, name, unit, min_price, max_price, open_ended, position) values
  ('website', 'Additional page', 'per_page', 500, 1500, false, 1),
  ('website', 'Premium animations and motion graphics', 'fixed', 1000, 4000, false, 2),
  ('website', 'Admin dashboard or CMS', 'fixed', 3000, 10000, false, 3),
  ('website', 'Database and dynamic content', 'fixed', 2000, 8000, false, 4),
  ('website', 'Online ordering system', 'fixed', 5000, 15000, false, 5),
  ('website', 'Appointment or table-booking system', 'fixed', 3000, 10000, false, 6),
  ('website', 'Payment gateway integration', 'fixed', 2000, 5000, false, 7),
  ('website', 'Billing/POS integration', 'fixed', 5000, 20000, false, 8),
  ('website', 'Additional SEO work', 'fixed', 1500, 5000, false, 9),
  ('website', 'Content writing', 'per_page', 500, 2000, false, 10),
  ('app', 'Additional screen or complex UI', 'per_screen', 1000, 3000, false, 11),
  ('app', 'Push notifications', 'fixed', 2000, 5000, false, 12),
  ('app', 'Payment gateway integration', 'fixed', 3000, 8000, false, 13),
  ('app', 'Booking system', 'fixed', 5000, 15000, false, 14),
  ('app', 'Live order tracking', 'fixed', 8000, 20000, false, 15),
  ('app', 'Admin dashboard', 'fixed', 5000, 15000, false, 16),
  ('app', 'Advanced analytics', 'fixed', 3000, 10000, false, 17),
  ('app', 'Maps and location features', 'fixed', 3000, 8000, false, 18),
  ('app', 'Chat or messaging', 'fixed', 5000, 15000, false, 19),
  ('app', 'Third-party API integrations', 'per_item', 2000, 10000, true, 20);

-- Provider fees are intentionally left empty ("To be confirmed") — enter real quotes before use.
insert into external_cost_catalog (name, category, billing, period, position) values
  ('Domain registration and renewal', 'domain', 'recurring', 'annual', 1),
  ('Website hosting', 'hosting', 'recurring', 'annual', 2),
  ('Cloud hosting and database', 'cloud', 'recurring', 'monthly', 3),
  ('Email hosting', 'email', 'recurring', 'annual', 4),
  ('SSL certificate', 'ssl', 'recurring', 'annual', 5),
  ('Google Play developer account', 'app_store', 'one_time', null, 6),
  ('Apple Developer Program', 'app_store', 'recurring', 'annual', 7),
  ('SMS and WhatsApp messaging', 'messaging', 'recurring', 'monthly', 8),
  ('Third-party APIs', 'api', 'recurring', 'monthly', 9),
  ('Payment gateway transaction fees', 'payment_fees', 'recurring', 'monthly', 10),
  ('Other external subscription', 'other', 'recurring', 'monthly', 11);

insert into maintenance_plans (kind, name, monthly_price, included_hours, bug_fix_coverage, update_frequency, backup_monitoring, support_channel, response_time, exclusions, position) values
  ('website', 'Basic', 500, 'Up to 1 hour of small edits per month', 'Fixes for bugs in delivered features', 'Monthly check-up', 'Monthly backup check', 'WhatsApp and email', 'Within 2 business days', 'New features, redesigns, content writing, third-party outages', 1),
  ('website', 'Standard', 1000, 'Up to 3 hours of edits per month', 'Fixes for bugs in delivered features', 'Fortnightly updates', 'Weekly backups and uptime monitoring', 'WhatsApp, email and phone', 'Within 1 business day', 'New features, redesigns, third-party outages', 2),
  ('website', 'Premium', 2000, 'Up to 6 hours of edits per month', 'Priority bug fixes', 'Weekly updates', 'Daily backups and uptime monitoring', 'Priority WhatsApp, email and phone', 'Same business day', 'Major new features and redesigns', 3),
  ('app', 'Basic', 2000, 'Up to 2 hours per month', 'Fixes for bugs in delivered features', 'OS compatibility checks each quarter', 'Monthly backup check', 'WhatsApp and email', 'Within 2 business days', 'New features, store policy changes, third-party outages', 4),
  ('app', 'Standard', 5000, 'Up to 6 hours per month', 'Fixes for bugs in delivered features', 'Monthly updates and dependency upgrades', 'Weekly backups and crash monitoring', 'WhatsApp, email and phone', 'Within 1 business day', 'New features, redesigns, third-party outages', 5),
  ('app', 'Premium', 8000, 'Up to 12 hours per month', 'Priority bug fixes', 'Fortnightly updates and store releases', 'Daily backups, crash and performance monitoring', 'Priority WhatsApp, email and phone', 'Same business day', 'Major new modules', 6);

insert into milestone_templates (name, items) values
  ('Two payments', '[{"label": "Initial advance", "mode": "percent", "value": 50, "due": "On acceptance"}, {"label": "Final approval and handover", "mode": "percent", "value": 50, "due": "Before handover"}]'),
  ('Four milestones', '[{"label": "Initial advance", "mode": "percent", "value": 40, "due": "On acceptance"}, {"label": "Design approval", "mode": "percent", "value": 20, "due": "On design approval"}, {"label": "Development milestone", "mode": "percent", "value": 20, "due": "When development is complete"}, {"label": "Final approval and handover", "mode": "percent", "value": 20, "due": "Before handover"}]');

-- ---------------------------------------------------------------------------
-- Proposals
-- ---------------------------------------------------------------------------
create table proposals (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique,
  client_id    uuid not null references client_profiles(id) on delete cascade,
  project_id   uuid references projects(id) on delete set null,
  title        text not null check (length(title) between 1 and 200),
  project_type text not null check (project_type in ('website', 'android_app', 'ios_app', 'cross_platform_app', 'website_app', 'custom_software')),
  assigned_to  uuid references users(id) on delete set null,
  cancelled_at timestamptz,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index proposals_client_idx on proposals (client_id, created_at desc);
create trigger proposals_updated before update on proposals for each row execute function set_updated_at();

create table proposal_versions (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null references proposals(id) on delete cascade,
  client_id           uuid not null references client_profiles(id) on delete cascade,
  version_no          int not null,
  status              text not null default 'draft'
                      check (status in ('draft', 'ready', 'sent', 'viewed', 'changes_requested', 'accepted', 'rejected', 'expired', 'cancelled', 'superseded')),
  currency            text not null default 'INR',
  content             jsonb not null,          -- client-visible proposal content (no internal notes or provider costs)
  pricing_mode        text not null check (pricing_mode in ('package', 'itemized')),
  package_snapshot    jsonb,
  base_amount         numeric(14,2) not null default 0,
  addons_amount       numeric(14,2) not null default 0,
  custom_amount       numeric(14,2) not null default 0,
  external_amount     numeric(14,2) not null default 0,   -- one-time external fees billed through us
  subtotal            numeric(14,2) not null default 0,
  discount_type       text not null default 'none' check (discount_type in ('none', 'percent', 'amount')),
  discount_value      numeric(14,2) not null default 0,
  discount_amount     numeric(14,2) not null default 0,
  discount_percent    numeric(7,3) not null default 0,    -- effective % of the eligible subtotal
  taxable_amount      numeric(14,2) not null default 0,
  tax_label           text not null default 'GST',
  tax_rate            numeric(6,3) not null default 0,
  tax_amount          numeric(14,2) not null default 0,
  total               numeric(14,2) not null default 0,   -- final one-time total
  recurring_monthly   numeric(14,2) not null default 0,
  recurring_annual    numeric(14,2) not null default 0,
  initial_payable     numeric(14,2) not null default 0,
  has_tbc_items       boolean not null default false,
  milestones          jsonb not null default '[]'::jsonb, -- [{label, mode, value, due, amount}]
  valid_until         date not null,
  sent_at             timestamptz,
  email_status        text check (email_status in ('sent', 'failed', 'not_configured')),
  first_viewed_at     timestamptz,
  view_count          int not null default 0,
  responded_at        timestamptz,
  responded_by        uuid references users(id) on delete set null,
  client_response_note text,
  accepted_at         timestamptz,
  created_by          uuid references users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (proposal_id, version_no)
);
create index proposal_versions_client_idx on proposal_versions (client_id, status);
create trigger proposal_versions_updated before update on proposal_versions for each row execute function set_updated_at();

create table proposal_items (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references proposal_versions(id) on delete cascade,
  position            int not null,
  section             text not null check (section in ('base', 'inclusion', 'addon', 'custom', 'external', 'maintenance')),
  name                text not null check (length(name) between 1 and 300),
  description         text,
  quantity            numeric(12,2) not null default 1 check (quantity > 0),
  unit                text,
  unit_price          numeric(14,2),            -- null = to be confirmed
  amount              numeric(14,2),            -- null = to be confirmed
  billing             text not null default 'one_time' check (billing in ('one_time', 'recurring')),
  period              text check (period in ('monthly', 'annual')),
  charged             boolean not null,          -- counted in totals?
  included_in_package boolean not null default false,
  payer               text check (payer in ('agency', 'client')),
  renewal_date        date,
  range_min           numeric(14,2),
  range_max           numeric(14,2),
  details             jsonb not null default '{}'::jsonb
);
create index proposal_items_version_idx on proposal_items (version_id, position);

-- Staff-only data that must never reach clients.
create table proposal_version_internal (
  version_id     uuid primary key references proposal_versions(id) on delete cascade,
  internal_notes text,
  provider_costs jsonb not null default '{}'::jsonb   -- {"<item position>": provider cost}
);

create table proposal_acceptances (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null unique references proposal_versions(id) on delete cascade,
  proposal_id    uuid not null references proposals(id) on delete cascade,
  client_id      uuid not null references client_profiles(id) on delete cascade,
  user_id        uuid not null references users(id) on delete restrict,
  version_no     int not null,
  signer_name    text not null,
  total          numeric(14,2) not null,
  recurring_monthly numeric(14,2) not null,
  recurring_annual  numeric(14,2) not null,
  currency       text not null,
  content_hash   text not null,
  terms_snapshot jsonb not null,
  ip             text,
  user_agent     text,
  accepted_at    timestamptz not null default now()
);
create trigger proposal_acceptances_append_only before update or delete on proposal_acceptances
  for each row execute function forbid_change();

create table proposal_comments (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  version_id  uuid references proposal_versions(id) on delete set null,
  client_id   uuid not null references client_profiles(id) on delete cascade,
  author_id   uuid references users(id) on delete set null,
  kind        text not null default 'comment' check (kind in ('comment', 'question', 'change_request', 'rejection')),
  body        text not null check (length(body) between 1 and 10000),
  created_at  timestamptz not null default now()
);
create index proposal_comments_proposal_idx on proposal_comments (proposal_id, created_at);

create table proposal_events (
  id          bigserial primary key,
  proposal_id uuid not null references proposals(id) on delete cascade,
  version_id  uuid references proposal_versions(id) on delete set null,
  actor_id    uuid,
  actor_role  text,
  type        text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index proposal_events_proposal_idx on proposal_events (proposal_id, created_at desc);

alter table invoices add column proposal_version_id uuid references proposal_versions(id) on delete set null;

-- Sent proposal versions are frozen; accepted ones can never change.
create or replace function protect_proposal_version() returns trigger
  language plpgsql as $$
begin
  if current_setting('app.purge', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if; return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'ready') then
      raise exception 'Only unsent proposal versions can be deleted' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.accepted_at is not null then
    raise exception 'Accepted proposal versions are immutable; create a new version instead' using errcode = 'check_violation';
  end if;
  if old.status not in ('draft', 'ready') and (
       new.content is distinct from old.content or new.total is distinct from old.total
    or new.subtotal is distinct from old.subtotal or new.discount_amount is distinct from old.discount_amount
    or new.tax_amount is distinct from old.tax_amount or new.recurring_monthly is distinct from old.recurring_monthly
    or new.recurring_annual is distinct from old.recurring_annual or new.milestones is distinct from old.milestones
    or new.valid_until is distinct from old.valid_until or new.pricing_mode is distinct from old.pricing_mode) then
    raise exception 'Sent proposal content cannot be edited; create a revised version' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger proposal_versions_protect before update or delete on proposal_versions
  for each row execute function protect_proposal_version();

create or replace function protect_proposal_items() returns trigger
  language plpgsql as $$
declare v_status text;
begin
  if current_setting('app.purge', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if; return new;
  end if;
  select status into v_status from proposal_versions where id = coalesce(new.version_id, old.version_id);
  if v_status is not null and v_status not in ('draft', 'ready') then
    raise exception 'Line items of a sent proposal cannot be modified' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger proposal_items_protect before insert or update or delete on proposal_items
  for each row execute function protect_proposal_items();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'app_settings', 'app_assets', 'pricing_packages', 'pricing_package_items', 'pricing_services', 'external_cost_catalog',
    'maintenance_plans', 'discount_rules', 'milestone_templates', 'proposals', 'proposal_versions', 'proposal_items',
    'proposal_version_internal', 'proposal_acceptances', 'proposal_comments', 'proposal_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy staff_all on %I for all using (app_is_staff()) with check (app_is_staff())', t);
  end loop;
end $$;

-- Business details and logo are needed to render proposals for clients.
create policy client_read on app_settings for select using (app_role() = 'client' and key = 'business');
create policy public_read on app_assets for select using (key = 'logo');

create policy client_read on proposals for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on proposal_versions for select using (
  app_role() = 'client' and client_id = app_client_id() and status not in ('draft', 'ready'));
create policy client_read on proposal_items for select using (
  app_role() = 'client' and exists (select 1 from proposal_versions v where v.id = version_id));
create policy client_read on proposal_acceptances for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_read on proposal_comments for select using (app_role() = 'client' and client_id = app_client_id());
create policy client_insert on proposal_comments for insert with check (
  app_role() = 'client' and client_id = app_client_id() and author_id = app_uid()
  and kind in ('comment', 'question')
  and exists (select 1 from proposals p where p.id = proposal_id and p.client_id = app_client_id()));
