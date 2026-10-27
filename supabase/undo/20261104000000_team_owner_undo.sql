-- Removes teams.manager_id added by 20261104000000_team_owner.sql. The owners already chosen on the Teams page are lost.
-- Run in Supabase -> SQL Editor only if you need to go back.
begin;
alter table public.teams drop column if exists manager_id;
notify pgrst, 'reload schema';
commit;
