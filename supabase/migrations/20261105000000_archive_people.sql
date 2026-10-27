-- "Delete" a person = archive them: the account stops working and they disappear from the lists, but everything they
-- did (attendance, leave, payslips) stays, and their national id stays reserved. The admin can restore them.
-- Run once in Supabase -> SQL Editor. Safe to run twice. One transaction: if any statement fails, nothing is applied.
-- supabase/undo/20261105000000_archive_people_undo.sql removes it again (archived people stay switched off).
begin;

alter table public.profiles add column if not exists archived boolean not null default false;

-- Direct updates: only the admin archives or restores anybody, and nobody but the admin switches an archived account
-- back on. (An operator session in the SQL Editor has no signed-in user and is not judged here.)
create or replace function public.profiles_archive_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- An archived account is always switched off, whoever saves the row (for example an admin saving a stale edit form
  -- that still says "active").
  if new.archived then new.active := false; end if;
  if auth.uid() is null then return new; end if;
  if public.current_role_name() = 'admin' then return new; end if;
  if new.archived is distinct from old.archived then raise exception 'forbidden'; end if;
  if old.archived and new.active then raise exception 'forbidden'; end if;
  return new;
end $$;

drop trigger if exists profiles_archive_guard on public.profiles;
create trigger profiles_archive_guard
  before update on public.profiles
  for each row execute function public.profiles_archive_guard();

-- What the "Delete" and "Restore" buttons call. Admin only; never yourself, never another admin.
-- Archiving switches the account off (active = false); restoring switches it back on.
create or replace function public.archive_person(p_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles;
begin
  if public.current_role_name() is distinct from 'admin' or p_archived is null then raise exception 'forbidden'; end if;
  select p.* into target from public.profiles p where p.id = p_id;
  if target.id is null then raise exception 'forbidden'; end if;
  if target.id = auth.uid() then raise exception 'self_archive'; end if;
  if target.role = 'admin' then raise exception 'role_forbidden'; end if;
  update public.profiles set archived = p_archived, active = not p_archived where id = p_id;
end $$;

revoke execute on function public.archive_person(uuid, boolean) from public, anon;
grant execute on function public.archive_person(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
