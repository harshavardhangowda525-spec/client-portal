-- Infinity Web & Apps — maintenance tracking, expiry notifications and monthly maintenance billing.
-- Reuses existing tables wherever possible: client contact details stay on client_profiles,
-- monthly bills are ordinary invoices, payments use the existing payments table, and every
-- email/WhatsApp attempt is logged in message_deliveries (now with idempotency keys).

-- Row Level Security is forced on settings tables, so identify this script as a system process
-- (session-level so it also works when pasted into a SQL editor that auto-commits each statement).
select set_config('app.role', 'system', false);

-- ---------------------------------------------------------------------------
-- Project maintenance fields
-- ---------------------------------------------------------------------------
alter table projects
  add column proposal_started_at            timestamptz,
  add column free_maintenance_start_date    date,
  add column free_maintenance_end_date      date,
  add column maintenance_dates_overridden   boolean not null default false,
  add column maintenance_status             text check (maintenance_status in (
    'FREE_MAINTENANCE_ACTIVE', 'EXPIRING_SOON', 'FREE_MAINTENANCE_EXPIRED', 'AWAITING_CLIENT_CONFIRMATION',
    'PAID_MAINTENANCE_ACTIVE', 'PAYMENT_OVERDUE', 'MAINTENANCE_CANCELLED')),
  add column monthly_maintenance_fee        numeric(14,2) check (monthly_maintenance_fee >= 0), -- null = default from settings
  add column maintenance_billing_start_date date,
  add column next_billing_date              date,
  add column maintenance_activated_at       timestamptz,
  add column maintenance_cancelled_at       timestamptz,
  add column maintenance_exempt             boolean not null default false,
  add column maintenance_paused             boolean not null default false,
  add column maintenance_covers_hosting     boolean not null default false,
  add check (free_maintenance_end_date is null or free_maintenance_start_date is null or free_maintenance_end_date > free_maintenance_start_date);
create index projects_maintenance_idx on projects (maintenance_status, free_maintenance_end_date);

-- ---------------------------------------------------------------------------
-- Delivery log: idempotency + retries (one row per logical notification per channel)
-- ---------------------------------------------------------------------------
alter table message_deliveries drop constraint message_deliveries_status_check;
alter table message_deliveries
  add constraint message_deliveries_status_check check (status in ('pending', 'sent', 'failed', 'not_configured', 'skipped')),
  add column idempotency_key text unique,
  add column kind            text,
  add column audience        text check (audience in ('client', 'admin')),
  add column body            text,
  add column attempts        int not null default 1,
  add column next_retry_at   timestamptz,
  add column updated_at      timestamptz not null default now();
create index message_deliveries_project_idx on message_deliveries (project_id, created_at desc);
create index message_deliveries_retry_idx on message_deliveries (status, next_retry_at) where status = 'failed';

-- ---------------------------------------------------------------------------
-- Monthly maintenance invoices are ordinary invoices with a billing period.
-- ---------------------------------------------------------------------------
alter table invoices
  add column kind                 text not null default 'project' check (kind in ('project', 'maintenance')),
  add column billing_period_start date,
  add column billing_period_end   date;
create unique index invoices_maintenance_period_uq on invoices (project_id, billing_period_start)
  where kind = 'maintenance' and status <> 'void';

-- Clients can report a payment (e.g. after scanning the UPI QR); it stays pending until an admin confirms it.
alter table payments add column reported_by uuid references users(id) on delete set null;
drop policy client_read on payments;
create policy client_read on payments for select using (
  app_role() = 'client' and app_is_member(project_id)
  and (status in ('confirmed', 'refunded') or (status = 'pending' and reported_by = app_uid())));

-- ---------------------------------------------------------------------------
-- Explicit consent to recurring maintenance billing (append-only)
-- ---------------------------------------------------------------------------
create table maintenance_consents (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  signer_name    text not null,
  monthly_fee    numeric(14,2) not null,
  tax_label      text,
  tax_rate       numeric(6,3) not null default 0,
  monthly_total  numeric(14,2) not null,
  billing_start  date not null,
  terms_snapshot jsonb not null,
  ip             text,
  user_agent     text,
  created_at     timestamptz not null default now()
);
create index maintenance_consents_project_idx on maintenance_consents (project_id, created_at desc);
create trigger maintenance_consents_append_only before update or delete on maintenance_consents
  for each row execute function forbid_change();

alter table maintenance_consents enable row level security;
alter table maintenance_consents force row level security;
create policy staff_all on maintenance_consents for all using (app_is_staff()) with check (app_is_staff());
create policy client_read on maintenance_consents for select using (app_role() = 'client' and app_is_member(project_id));

-- ---------------------------------------------------------------------------
-- Settings (editable in Admin → Settings)
-- ---------------------------------------------------------------------------
insert into app_settings (key, value) values
  ('maintenance', '{
    "trigger": "proposal_initiated",
    "free_months": 6,
    "default_fee": 500,
    "expiring_soon_days": 30,
    "reminder_days": [30, 7],
    "billing_reminder_days": 3,
    "catch_up_days": 2,
    "retry_max_attempts": 3,
    "retry_delay_hours": 6,
    "admin_email": "",
    "admin_whatsapp": "",
    "whatsapp_template": "",
    "whatsapp_language": "en",
    "included": ["Minor bug fixes", "Minor technical glitches", "Routine maintenance of the agreed project"],
    "hosting_line": "Hosting and domain renewal costs covered by the maintenance agreement",
    "excluded": ["Major redesigns", "New features", "New integrations", "Significant backend redevelopment", "Work outside the agreed maintenance scope"],
    "cancellation_terms": "You can cancel at any time from your client portal. Cancelling stops future monthly invoices; months already invoiced remain payable. No refunds for partial months.",
    "payment_terms": "Each month an invoice is issued a few days before the billing date and is due on the billing date. Pay by scanning the UPI QR code or by bank transfer, then report the payment reference in the portal.",
    "templates": {}
  }'),
  ('payment_details', '{"upi_id": "", "payee_name": "", "account_holder": "", "account_number": "", "ifsc": "", "bank_name": "", "branch": "", "instructions": ""}')
on conflict (key) do nothing;

select set_config('app.role', '', false);
