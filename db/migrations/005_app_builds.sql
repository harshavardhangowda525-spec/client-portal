-- Infinity Web & Apps — mobile app builds the client can test, give feedback on and approve.
-- Mirrors website previews: one row per published version; files (APK, screenshots) live in documents;
-- feedback is stored in comments.

create table app_builds (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  version_no    int not null,
  platform      text not null check (platform in ('android', 'ios', 'both')),
  build_label   text check (length(build_label) <= 60),
  notes         text check (length(notes) <= 5000),
  android_url   text check (android_url ~ '^https://'),  -- APK download / Play internal testing / Firebase link
  ios_url       text check (ios_url ~ '^https://'),      -- TestFlight public link
  test_url      text check (test_url ~ '^https?://'),    -- Expo / web demo
  status        text not null default 'ready_for_review'
                check (status in ('ready_for_review', 'changes_requested', 'approved', 'superseded')),
  published_by  uuid references users(id) on delete set null,
  published_at  timestamptz not null default now(),
  reviewed_by   uuid references users(id) on delete set null,
  reviewed_at   timestamptz,
  unique (project_id, version_no)
);
create index app_builds_project_idx on app_builds (project_id, version_no desc);

alter table app_builds enable row level security;
alter table app_builds force row level security;
create policy staff_all on app_builds for all using (app_is_staff()) with check (app_is_staff());
create policy client_read on app_builds for select using (app_role() = 'client' and app_is_member(project_id));

-- Files attached to a build: the APK (category app_build) and screenshots.
alter table documents add column app_build_id uuid references app_builds(id) on delete cascade;
create index documents_app_build_idx on documents (app_build_id) where app_build_id is not null;
alter table documents drop constraint documents_category_check;
alter table documents add constraint documents_category_check check (category in
  ('quotation', 'invoice', 'requirements', 'brand_asset', 'screenshot', 'handover', 'contract', 'other', 'app_build'));

-- Clients may attach screenshots to their feedback on a build.
drop policy client_insert on documents;
create policy client_insert on documents for insert with check (
  app_role() = 'client' and app_is_member(project_id) and uploaded_by = app_uid() and visibility = 'client'
  and (category in ('brand_asset', 'requirements', 'other') or (category = 'screenshot' and app_build_id is not null)));

-- Feedback comments on builds.
alter table comments drop constraint comments_target_type_check;
alter table comments add constraint comments_target_type_check check (target_type in
  ('thread', 'update', 'preview', 'milestone', 'quotation', 'app_build'));
drop policy client_insert on comments;
create policy client_insert on comments for insert with check (
  app_role() = 'client' and app_is_member(project_id) and author_id = app_uid()
  and target_type in ('thread', 'update', 'preview', 'milestone', 'quotation', 'app_build'));
