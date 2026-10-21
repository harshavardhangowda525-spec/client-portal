-- Infinity Web & Apps — proposals replace quotations.
-- WARNING: this permanently deletes every quotation, quotation version, line item, acceptance record and
-- quotation template. Projects are priced and billed from their accepted proposal from now on.
-- Invoices and payments are kept; invoices that were raised from a quotation simply lose that reference.

select set_config('app.role', 'system', false);

alter table invoices drop column if exists quotation_version_id;

drop table if exists quotation_acceptances cascade;
drop table if exists quotation_items cascade;
drop table if exists quotation_versions cascade;
drop table if exists quotations cascade;
drop table if exists quotation_templates cascade;
drop function if exists protect_quotation_version();
drop function if exists protect_quotation_items();

-- Comments that belonged to quotations no longer have anything to attach to.
delete from comments where target_type = 'quotation';
alter table comments drop constraint comments_target_type_check;
alter table comments add constraint comments_target_type_check check (target_type in
  ('thread', 'update', 'preview', 'milestone', 'app_build'));
drop policy client_insert on comments;
create policy client_insert on comments for insert with check (
  app_role() = 'client' and app_is_member(project_id) and author_id = app_uid()
  and target_type in ('thread', 'update', 'preview', 'milestone', 'app_build'));

-- Old notification links pointed at the quotation pages; send them to the project's proposal instead.
update notifications set link = regexp_replace(link, '^(/portal/[0-9a-f-]{36})/quotation.*$', '\1/proposal')
  where link ~ '^/portal/[0-9a-f-]{36}/quotation';
update notifications set link = regexp_replace(link, '^(/admin/projects/[0-9a-f-]{36})/quotations.*$', '\1/proposal')
  where link ~ '^/admin/projects/[0-9a-f-]{36}/quotations';

select set_config('app.role', '', false);
