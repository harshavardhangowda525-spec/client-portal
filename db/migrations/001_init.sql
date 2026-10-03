-- Infinity Web & Apps — Client Project Portal schema
-- Every table that holds project data has Row Level Security FORCED, so even the
-- table owner (the application's database role) is subject to the policies.
-- The application sets per-transaction context with:
--   set_config('app.role', 'admin' | 'client' | 'system', true)
--   set_config('app.user_id', <uuid>, true)
--   set_config('app.client_id', <uuid>, true)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Context helpers
-- ---------------------------------------------------------------------------
create or replace function app_role() returns text
  language sql stable as $$ select coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;

create or replace function app_uid() returns uuid
  language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app_client_id() returns uuid
  language sql stable as $$ select nullif(current_setting('app.client_id', true), '')::uuid $$;

create or replace function app_is_staff() returns boolean
  language sql stable as $$ select app_role() in ('admin', 'system') $$;

create or replace function set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create table client_profiles (
  id                uuid primary key default gen_random_uuid(),
  business_name     text not null check (length(business_name) between 1 and 200),
  owner_name        text not null check (length(owner_name) between 1 and 200),
  email             text not null check (length(email) <= 320),
  phone             text,
  business_category text,
  address           text,
  portal_access_revoked_at timestamptz,
  is_sample         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger client_profiles_updated before update on client_profiles for each row execute function set_updated_at();

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  name          text not null,
  role          text not null check (role in ('admin', 'client')),
  client_id     uuid references client_profiles(id) on delete cascade,
  disabled_at   timestamptz,
  last_login_at timestamptz,
  is_sample     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((role = 'client') = (client_id is not null))
);
create unique index users_email_unique on users (lower(email));
create index users_client_idx on users (client_id);
create trigger users_updated before update on users for each row execute function set_updated_at();

-- Credentials are kept apart from the profile so no client-visible query can touch them.
create table user_credentials (
  user_id       uuid primary key references users(id) on delete cascade,
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  ip           text,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

create table login_attempts (
  id         bigserial primary key,
  email      text not null,
  ip         text,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_email_idx on login_attempts (lower(email), created_at desc);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table projects (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references client_profiles(id) on delete cascade,
  name                 text not null check (length(name) between 1 and 200),
  project_type         text not null default 'website'
                       check (project_type in ('website','ecommerce','mobile_app','web_app','branding','maintenance','other')),
  description          text,
  status               text not null default 'proposal'
                       check (status in ('proposal','quotation_accepted','active','awaiting_client','on_hold','completed','cancelled','declined')),
  current_stage        text,
  project_manager_id   uuid references users(id) on delete set null,
  start_date           date,
  target_delivery_date date,
  commenced_at         timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  is_sample            boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index projects_client_idx on projects (client_id);
create index projects_status_idx on projects (status);
create trigger projects_updated before update on projects for each row execute function set_updated_at();

create table project_internal_notes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  author_id  uuid references users(id) on delete set null,
  body       text not null check (length(body) between 1 and 10000),
  created_at timestamptz not null default now()
);
create index project_internal_notes_project_idx on project_internal_notes (project_id, created_at desc);

create table project_members (
  project_id   uuid not null references projects(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  member_role  text not null default 'client' check (member_role in ('client','manager')),
  last_read_messages_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on project_members (user_id);

create or replace function app_is_member(p uuid) returns boolean
  language sql stable as $$
    select exists (select 1 from project_members m where m.project_id = p and m.user_id = app_uid())
  $$;

create table client_invitations (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references client_profiles(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,
  email       text not null,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references users(id) on delete set null,
  revoked_at  timestamptz,
  created_by  uuid references users(id) on delete set null,
  last_sent_at timestamptz,
  send_count  int not null default 0,
  created_at  timestamptz not null default now()
);
create index client_invitations_client_idx on client_invitations (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------
create table milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  position       int not null,
  title          text not null check (length(title) between 1 and 200),
  description    text,
  status         text not null default 'not_started'
                 check (status in ('not_started','in_progress','awaiting_client','completed','blocked')),
  weight         numeric(6,2) not null default 1 check (weight >= 0 and weight <= 1000),
  start_date     date,
  due_date       date,
  completed_at   timestamptz,
  completed_by   uuid references users(id) on delete set null,
  blocked_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index milestones_project_idx on milestones (project_id, position);
create trigger milestones_updated before update on milestones for each row execute function set_updated_at();

create table milestone_history (
  id           uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references milestones(id) on delete cascade,
  project_id   uuid not null references projects(id) on delete cascade,
  actor_id     uuid references users(id) on delete set null,
  changes      jsonb not null default '{}'::jsonb,
  note         text,
  created_at   timestamptz not null default now()
);
create index milestone_history_milestone_idx on milestone_history (milestone_id, created_at desc);

-- Client approvals are recorded separately from development status.
create table approval_requests (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  milestone_id  uuid references milestones(id) on delete set null,
  preview_id    uuid,
  title         text not null check (length(title) between 1 and 200),
  description   text,
  kind          text not null default 'approval' check (kind in ('approval','feedback','question')),
  status        text not null default 'pending' check (status in ('pending','approved','changes_requested','answered','cancelled')),
  due_date      date,
  requested_by  uuid references users(id) on delete set null,
  responded_by  uuid references users(id) on delete set null,
  responded_at  timestamptz,
  response      text,
  created_at    timestamptz not null default now()
);
create index approval_requests_project_idx on approval_requests (project_id, status);

-- ---------------------------------------------------------------------------
-- Quotations (versioned; accepted versions are immutable)
-- ---------------------------------------------------------------------------
create table quotation_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger quotation_templates_updated before update on quotation_templates for each row execute function set_updated_at();

create table quotations (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  number     text not null unique,
  title      text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index quotations_project_idx on quotations (project_id);

create table quotation_versions (
  id                  uuid primary key default gen_random_uuid(),
  quotation_id        uuid not null references quotations(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  version_no          int not null,
  status              text not null default 'draft'
                      check (status in ('draft','sent','viewed','accepted','changes_requested','rejected','expired','superseded','withdrawn')),
  currency            text not null default 'INR',
  client_snapshot     jsonb not null default '{}'::jsonb,
  project_description text,
  issue_date          date not null default current_date,
  valid_until         date not null,
  discount_type       text not null default 'none' check (discount_type in ('none','percent','amount')),
  discount_value      numeric(14,2) not null default 0 check (discount_value >= 0),
  tax_label           text not null default 'Tax',
  tax_rate            numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  subtotal            numeric(14,2) not null default 0,
  discount_amount     numeric(14,2) not null default 0,
  tax_amount          numeric(14,2) not null default 0,
  total               numeric(14,2) not null default 0,
  payment_terms       jsonb not null default '[]'::jsonb,   -- [{label, percent, amount, due}]
  included_features   jsonb not null default '[]'::jsonb,   -- [string]
  exclusions          jsonb not null default '[]'::jsonb,   -- [string]
  revisions_included  int not null default 2 check (revisions_included >= 0),
  maintenance_terms   text,
  domain_hosting_terms text,
  delivery_timeline   text,
  terms_conditions    text,
  admin_note          text,          -- admin-only; never selected for clients
  client_response_note text,
  sent_at             timestamptz,
  first_viewed_at     timestamptz,
  view_count          int not null default 0,
  responded_at        timestamptz,
  responded_by        uuid references users(id) on delete set null,
  accepted_at         timestamptz,
  created_by          uuid references users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (quotation_id, version_no)
);
create index quotation_versions_project_idx on quotation_versions (project_id, status);
create trigger quotation_versions_updated before update on quotation_versions for each row execute function set_updated_at();

create table quotation_items (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references quotation_versions(id) on delete cascade,
  position    int not null,
  description text not null check (length(description) between 1 and 500),
  details     text,
  quantity    numeric(12,2) not null default 1 check (quantity > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  amount      numeric(14,2) not null
);
create index quotation_items_version_idx on quotation_items (version_id, position);

create table quotation_acceptances (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null unique references quotation_versions(id) on delete cascade,
  quotation_id    uuid not null references quotations(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  user_id         uuid not null references users(id) on delete restrict,
  version_no      int not null,
  signer_name     text not null,
  total           numeric(14,2) not null,
  currency        text not null,
  content_hash    text not null,
  terms_snapshot  jsonb not null,
  ip              text,
  user_agent      text,
  accepted_at     timestamptz not null default now()
);

-- Accepted quotation versions can never change; drafts are the only editable state.
create or replace function protect_quotation_version() returns trigger
  language plpgsql as $$
begin
  if current_setting('app.purge', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if; return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft quotation versions can be deleted' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.accepted_at is not null then
    raise exception 'Accepted quotation versions are immutable; create a new version instead' using errcode = 'check_violation';
  end if;
  if old.status <> 'draft' and (
       new.subtotal is distinct from old.subtotal or new.total is distinct from old.total
    or new.tax_rate is distinct from old.tax_rate or new.discount_value is distinct from old.discount_value
    or new.payment_terms is distinct from old.payment_terms or new.included_features is distinct from old.included_features
    or new.exclusions is distinct from old.exclusions or new.terms_conditions is distinct from old.terms_conditions
    or new.project_description is distinct from old.project_description or new.valid_until is distinct from old.valid_until
    or new.revisions_included is distinct from old.revisions_included or new.maintenance_terms is distinct from old.maintenance_terms
    or new.domain_hosting_terms is distinct from old.domain_hosting_terms or new.delivery_timeline is distinct from old.delivery_timeline) then
    raise exception 'Sent quotation content cannot be edited; create a revised version' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger quotation_versions_protect before update or delete on quotation_versions
  for each row execute function protect_quotation_version();

create or replace function protect_quotation_items() returns trigger
  language plpgsql as $$
declare v_status text;
begin
  if current_setting('app.purge', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if; return new;
  end if;
  select status into v_status from quotation_versions where id = coalesce(new.version_id, old.version_id);
  if v_status is distinct from 'draft' and v_status is not null then
    raise exception 'Line items of a sent quotation cannot be modified' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger quotation_items_protect before insert or update or delete on quotation_items
  for each row execute function protect_quotation_items();

create or replace function forbid_change() returns trigger
  language plpgsql as $$
begin
  -- sample-data purge (scripts/sample-data.ts) is the only path allowed to delete these rows
  if tg_op = 'DELETE' and current_setting('app.purge', true) = 'on' then return old; end if;
  raise exception '% rows are append-only', tg_table_name using errcode = 'check_violation';
end $$;
create trigger quotation_acceptances_append_only before update or delete on quotation_acceptances
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------------
-- Invoices & payments
-- ---------------------------------------------------------------------------
create table invoices (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects(id) on delete cascade,
  quotation_version_id uuid references quotation_versions(id) on delete set null,
  number               text not null unique,
  title                text not null,
  description          text,
  payment_term_label   text,
  amount               numeric(14,2) not null check (amount > 0),
  currency             text not null default 'INR',
  status               text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','void')),
  issue_date           date,
  due_date             date,
  issued_at            timestamptz,
  created_by           uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index invoices_project_idx on invoices (project_id);
create trigger invoices_updated before update on invoices for each row execute function set_updated_at();

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  invoice_id          uuid references invoices(id) on delete set null,
  receipt_number      text unique,
  amount              numeric(14,2) not null check (amount > 0),
  currency            text not null default 'INR',
  method              text not null check (method in ('bank_transfer','upi','cash','cheque','card_offline','razorpay','other')),
  status              text not null default 'pending' check (status in ('pending','confirmed','failed','refunded')),
  paid_on             date,
  reference           text,
  notes               text,
  source              text not null default 'manual' check (source in ('manual','razorpay')),
  provider_order_id   text,
  provider_payment_id text unique,
  verified_at         timestamptz,
  recorded_by         uuid references users(id) on delete set null,
  confirmed_by        uuid references users(id) on delete set null,
  confirmed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- an online payment can only be confirmed after server-side provider verification
  check (source = 'manual' or status <> 'confirmed' or verified_at is not null)
);
create index payments_project_idx on payments (project_id, status);
create index payments_invoice_idx on payments (invoice_id);
create trigger payments_updated before update on payments for each row execute function set_updated_at();

create table payment_orders (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  invoice_id        uuid not null references invoices(id) on delete cascade,
  provider          text not null default 'razorpay',
  provider_order_id text not null unique,
  amount            numeric(14,2) not null,
  currency          text not null default 'INR',
  status            text not null default 'created' check (status in ('created','paid','failed')),
  created_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Previews, updates, comments, documents
-- ---------------------------------------------------------------------------
create table previews (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  version_no    int not null,
  url           text not null check (url ~ '^https?://'),
  title         text,
  notes         text,
  status        text not null default 'ready_for_review'
                check (status in ('ready_for_review','changes_requested','approved','superseded')),
  embed_blocked boolean not null default false,
  published_by  uuid references users(id) on delete set null,
  published_at  timestamptz not null default now(),
  reviewed_by   uuid references users(id) on delete set null,
  reviewed_at   timestamptz,
  unique (project_id, version_no)
);
alter table approval_requests add constraint approval_requests_preview_fk foreign key (preview_id) references previews(id) on delete set null;

create table project_updates (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  milestone_id      uuid references milestones(id) on delete set null,
  author_id         uuid references users(id) on delete set null,
  kind              text not null default 'progress'
                    check (kind in ('progress','requirements','design','preview','milestone','testing','feedback_request','deployment','handover','general')),
  title             text not null check (length(title) between 1 and 200),
  body              text check (length(body) <= 20000),
  visibility        text not null default 'client' check (visibility in ('client','internal')),
  requests_feedback boolean not null default false,
  created_at        timestamptz not null default now()
);
create index project_updates_project_idx on project_updates (project_id, created_at desc);

create table comments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  target_type text not null check (target_type in ('thread','update','preview','milestone','quotation')),
  target_id   uuid,
  author_id   uuid references users(id) on delete set null,
  body        text not null check (length(body) between 1 and 10000),
  created_at  timestamptz not null default now(),
  check (target_type = 'thread' or target_id is not null)
);
create index comments_target_idx on comments (project_id, target_type, target_id, created_at);

create table documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  category     text not null check (category in ('quotation','invoice','requirements','brand_asset','screenshot','handover','contract','other')),
  name         text not null check (length(name) between 1 and 255),
  mime_type    text not null,
  size_bytes   int not null check (size_bytes > 0 and size_bytes <= 15728640),
  sha256       text not null,
  visibility   text not null default 'client' check (visibility in ('client','internal')),
  milestone_id uuid references milestones(id) on delete set null,
  preview_id   uuid references previews(id) on delete set null,
  update_id    uuid references project_updates(id) on delete set null,
  uploaded_by  uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index documents_project_idx on documents (project_id, category);

-- File contents live in the database so the app can run on stateless hosts.
create table document_blobs (
  document_id uuid primary key references documents(id) on delete cascade,
  data        bytea not null
);

-- ---------------------------------------------------------------------------
-- Notifications, delivery log, audit
-- ---------------------------------------------------------------------------
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, read_at, created_at desc);

create table message_deliveries (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null check (channel in ('email','whatsapp')),
  recipient   text not null,
  subject     text,
  purpose     text not null,
  status      text not null check (status in ('sent','failed','not_configured')),
  error       text,
  project_id  uuid references projects(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table audit_logs (
  id          bigserial primary key,
  actor_id    uuid,          -- no FK: audit rows must survive deletion of the actor
  actor_role  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  project_id  uuid,          -- no FK: audit rows must survive project deletion
  data        jsonb not null default '{}'::jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_logs_project_idx on audit_logs (project_id, created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create trigger audit_logs_append_only before update or delete on audit_logs
  for each row execute function forbid_change();

create table counters (
  name  text not null,
  year  int not null,
  value int not null default 0,
  primary key (name, year)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'client_profiles','users','user_credentials','sessions','login_attempts','projects','project_internal_notes',
    'project_members','client_invitations','milestones','milestone_history','approval_requests',
    'quotation_templates','quotations','quotation_versions','quotation_items','quotation_acceptances',
    'invoices','payments','payment_orders','previews','project_updates','comments','documents','document_blobs',
    'notifications','message_deliveries','audit_logs','counters'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy staff_all on %I for all using (app_is_staff()) with check (app_is_staff())', t);
  end loop;
end $$;

-- Clients: read-only access scoped to their own records.
create policy client_read on client_profiles for select using (app_role() = 'client' and id = app_client_id());
create policy client_read on users for select using (
  app_role() = 'client' and (id = app_uid() or role = 'admin' or client_id = app_client_id()));
create policy client_read on projects for select using (app_role() = 'client' and app_is_member(id));
create policy client_read on project_members for select using (app_role() = 'client' and user_id = app_uid());
create policy client_read on milestones for select using (app_role() = 'client' and app_is_member(project_id));
create policy client_read on milestone_history for select using (app_role() = 'client' and app_is_member(project_id));
create policy client_read on approval_requests for select using (
  app_role() = 'client' and app_is_member(project_id) and status <> 'cancelled');
create policy client_read on quotations for select using (app_role() = 'client' and app_is_member(project_id));
create policy client_read on quotation_versions for select using (
  app_role() = 'client' and app_is_member(project_id) and status <> 'draft');
create policy client_read on quotation_items for select using (
  app_role() = 'client' and exists (select 1 from quotation_versions v where v.id = version_id));
create policy client_read on quotation_acceptances for select using (app_role() = 'client' and app_is_member(project_id));
create policy client_read on invoices for select using (
  app_role() = 'client' and app_is_member(project_id) and status <> 'draft');
create policy client_read on payments for select using (
  app_role() = 'client' and app_is_member(project_id) and status in ('confirmed','refunded'));
create policy client_read on previews for select using (app_role() = 'client' and app_is_member(project_id));
create policy client_read on project_updates for select using (
  app_role() = 'client' and app_is_member(project_id) and visibility = 'client');
create policy client_read on comments for select using (app_role() = 'client' and app_is_member(project_id));
create policy client_read on documents for select using (
  app_role() = 'client' and app_is_member(project_id) and visibility = 'client');
create policy client_read on document_blobs for select using (
  app_role() = 'client' and exists (select 1 from documents d where d.id = document_id));
create policy client_read on notifications for select using (app_role() = 'client' and user_id = app_uid());

-- Clients: the narrow set of writes they may perform directly.
create policy client_insert on comments for insert with check (
  app_role() = 'client' and app_is_member(project_id) and author_id = app_uid()
  and target_type in ('thread','update','preview','milestone','quotation'));
create policy client_insert on documents for insert with check (
  app_role() = 'client' and app_is_member(project_id) and uploaded_by = app_uid()
  and category in ('brand_asset','requirements','other') and visibility = 'client');
create policy client_insert on document_blobs for insert with check (
  app_role() = 'client' and exists (select 1 from documents d where d.id = document_id and d.uploaded_by = app_uid()));
create policy client_update on notifications for update using (app_role() = 'client' and user_id = app_uid())
  with check (user_id = app_uid());
create policy client_update on project_members for update using (app_role() = 'client' and user_id = app_uid())
  with check (user_id = app_uid());
