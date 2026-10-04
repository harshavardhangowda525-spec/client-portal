-- Clients with signed or financial records are archived instead of deleted.
alter table client_profiles add column archived_at timestamptz;
create index client_profiles_archived_idx on client_profiles (archived_at);
