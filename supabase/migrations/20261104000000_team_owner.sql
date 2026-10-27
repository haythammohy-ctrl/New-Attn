-- Gives a team an owner: the assistant manager in charge of it (Teams page -> Edit Team -> "المسؤول عن الفريق").
-- Existing databases did not have this column (only a fresh install from schema.sql did), so saving a team's owner
-- failed with "the database needs an upgrade", and my_chain() could not find a supervisor's assistant manager.
-- Run once in Supabase -> SQL Editor. Safe to run twice and safe to run any time. It only adds an empty column.
-- supabase/undo/20261104000000_team_owner_undo.sql removes it again.
begin;

alter table public.teams
  add column if not exists manager_id uuid references public.profiles (id) on delete set null;

-- Make the API notice the new column straight away.
notify pgrst, 'reload schema';

commit;
