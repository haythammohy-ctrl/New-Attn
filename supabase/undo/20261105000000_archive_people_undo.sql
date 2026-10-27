-- Removes what 20261105000000_archive_people.sql added. People who were archived stay switched off (active = false);
-- they would then show up in "new requests" on the Employees page, where the admin can review or reactivate them.
-- Run in Supabase -> SQL Editor only if you need to go back. One transaction.
begin;

drop function if exists public.archive_person(uuid, boolean);
drop trigger if exists profiles_archive_guard on public.profiles;
drop function if exists public.profiles_archive_guard();
alter table public.profiles drop column if exists archived;

notify pgrst, 'reload schema';

commit;
