-- Infinity Resolve — AI-assisted client requests, clarification, tickets, gap detection and email briefings.
-- Reuses existing tables wherever possible: files live in documents/document_blobs, email attempts are logged in
-- message_deliveries, in-app alerts use notifications, and every change is written to audit_logs.

select set_config('app.role', 'system', false);

-- ---------------------------------------------------------------------------
-- Tickets (one per client request; the clarification conversation belongs to the ticket)
-- ---------------------------------------------------------------------------
create table resolve_tickets (
  id                     uuid primary key default gen_random_uuid(),
  number                 text not null unique,
  project_id             uuid not null references projects(id) on delete cascade,
  client_id              uuid not null references client_profiles(id) on delete cascade,
  created_by             uuid references users(id) on delete set null,
  source                 text not null default 'text' check (source in ('text', 'voice', 'visual', 'admin')),
  category               text not null default 'other' check (category in
    ('question', 'modification', 'technical_issue', 'design_change', 'feature_request', 'complaint', 'urgent_support', 'other')),
  title                  text not null default 'New request' check (length(title) between 1 and 200),
  original_message       text not null check (length(original_message) between 1 and 10000),
  summary                text,                                 -- AI conversation summary
  requirement            text,                                 -- final confirmed, developer-ready requirement
  details                jsonb not null default '{}'::jsonb,   -- page, section, element, viewport, missing details…
  priority               text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  priority_reason        text,
  scope_assessment       text not null default 'unclear' check (scope_assessment in ('within_scope', 'additional_work', 'unclear')),
  scope_reason           text,
  status                 text not null default 'ai_clarification' check (status in
    ('new', 'ai_clarification', 'awaiting_client', 'awaiting_admin_review', 'approved', 'in_progress',
     'awaiting_client_verification', 'resolved', 'closed')),
  pending_summary        jsonb,                                -- AI summary shown to the client for confirmation
  ai_turns               int not null default 0,
  ai_failed              boolean not null default false,
  requirement_hash       text,                                 -- duplicate detection
  duplicate_of           uuid references resolve_tickets(id) on delete set null,
  preview_id             uuid references previews(id) on delete set null,
  assigned_to            uuid references users(id) on delete set null,
  target_date            date,
  confirmed_at           timestamptz,
  client_verified_at     timestamptz,
  resolved_at            timestamptz,
  closed_at              timestamptz,
  last_client_message_at timestamptz,
  last_team_message_at   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index resolve_tickets_project_idx on resolve_tickets (project_id, created_at desc);
create index resolve_tickets_status_idx on resolve_tickets (status, updated_at desc);
create index resolve_tickets_hash_idx on resolve_tickets (project_id, requirement_hash) where requirement_hash is not null;
create trigger resolve_tickets_updated before update on resolve_tickets for each row execute function set_updated_at();

-- Conversation: client, AI, team and system messages. Internal notes are visibility 'internal'.
create table resolve_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references resolve_tickets(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  author_type text not null check (author_type in ('client', 'ai', 'team', 'system')),
  author_id   uuid references users(id) on delete set null,
  visibility  text not null default 'client' check (visibility in ('client', 'internal')),
  kind        text not null default 'message' check (kind in ('message', 'question', 'summary', 'note', 'status', 'transcript')),
  body        text not null check (length(body) between 1 and 10000),
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index resolve_messages_ticket_idx on resolve_messages (ticket_id, created_at);
create index resolve_messages_author_idx on resolve_messages (author_id, created_at desc);

-- Attachments (screenshots, annotated screenshots, voice recordings) are ordinary private documents.
alter table documents add column resolve_ticket_id uuid references resolve_tickets(id) on delete cascade;
alter table documents add column expires_at timestamptz;  -- retention for voice recordings
create index documents_resolve_idx on documents (resolve_ticket_id) where resolve_ticket_id is not null;
alter table documents drop constraint documents_category_check;
alter table documents add constraint documents_category_check check (category in
  ('quotation', 'invoice', 'requirements', 'brand_asset', 'screenshot', 'handover', 'contract', 'other', 'app_build', 'resolve', 'voice'));

-- ---------------------------------------------------------------------------
-- Communication gaps, administrator action items, email briefings, AI activity
-- ---------------------------------------------------------------------------
create table resolve_gaps (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  ticket_id      uuid references resolve_tickets(id) on delete cascade,
  kind           text not null check (kind in ('unanswered_question', 'missing_details', 'contradiction', 'repeated_complaint',
                   'no_owner', 'pending_approval', 'pending_client_approval', 'overdue_response', 'overdue_ticket',
                   'awaiting_client', 'pending_verification', 'scope_conflict', 'changed_instruction')),
  severity       text not null default 'normal' check (severity in ('low', 'normal', 'high', 'critical')),
  description    text not null,
  missing        text,
  recommendation text,
  status         text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  dedupe_key     text not null unique,
  detected_at    timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_by    uuid references users(id) on delete set null,
  resolution     text
);
create index resolve_gaps_open_idx on resolve_gaps (status, detected_at desc);

create table resolve_action_items (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  ticket_id    uuid references resolve_tickets(id) on delete cascade,
  gap_id       uuid references resolve_gaps(id) on delete set null,
  description  text not null check (length(description) between 1 and 1000),
  priority     text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  due_date     date,
  status       text not null default 'open' check (status in ('open', 'done', 'needs_info')),
  assigned_to  uuid references users(id) on delete set null,
  source       text not null default 'briefing' check (source in ('briefing', 'gap', 'manual')),
  dedupe_key   text unique,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references users(id) on delete set null
);
create index resolve_action_items_open_idx on resolve_action_items (status, priority, created_at desc);
create trigger resolve_action_items_updated before update on resolve_action_items for each row execute function set_updated_at();

create table resolve_briefings (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('ticket', 'daily', 'urgent')),
  ticket_id   uuid references resolve_tickets(id) on delete cascade,
  period      text,                 -- e.g. the IST date of a daily summary
  dedupe_key  text not null unique, -- one briefing per ticket / day / alert reason
  recipient   text not null,
  subject     text not null,
  html        text not null,
  body        text not null,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'not_configured', 'skipped')),
  error       text,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index resolve_briefings_created_idx on resolve_briefings (created_at desc);

create table resolve_ai_logs (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid references resolve_tickets(id) on delete cascade,
  project_id    uuid references projects(id) on delete cascade,
  operation     text not null check (operation in ('clarify', 'transcribe', 'briefing', 'gap_check', 'daily_summary')),
  provider      text not null,
  model         text,
  status        text not null check (status in ('ok', 'failed', 'not_configured', 'guarded')),
  latency_ms    int,
  input_tokens  int,
  output_tokens int,
  output        text,               -- what the AI returned (auditable); never the provider key
  error         text,
  created_at    timestamptz not null default now()
);
create index resolve_ai_logs_created_idx on resolve_ai_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: staff see everything; clients only their own projects' client-visible rows.
-- Client writes go through server functions that verify ownership first.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['resolve_tickets', 'resolve_messages', 'resolve_gaps', 'resolve_action_items', 'resolve_briefings', 'resolve_ai_logs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy staff_all on %I for all using (app_is_staff()) with check (app_is_staff())', t);
  end loop;
end $$;
create policy client_read on resolve_tickets for select using (app_role() = 'client' and app_is_member(project_id));
create policy client_read on resolve_messages for select using (app_role() = 'client' and app_is_member(project_id) and visibility = 'client');

-- ---------------------------------------------------------------------------
-- Settings (Admin → Infinity Resolve → Settings)
-- ---------------------------------------------------------------------------
insert into app_settings (key, value) values ('resolve', '{
  "ai_enabled": true,
  "admin_email": "",
  "daily_summary_hour": 20,
  "max_clarification_turns": 6,
  "unanswered_hours": 24,
  "approval_hours": 24,
  "client_followup_hours": 48,
  "verification_days": 5,
  "repeated_complaint_count": 2,
  "urgent_max_per_hour": 5,
  "voice_retention_days": 30,
  "client_messages_per_hour": 40,
  "client_tickets_per_day": 15
}') on conflict (key) do nothing;

select set_config('app.role', '', false);
