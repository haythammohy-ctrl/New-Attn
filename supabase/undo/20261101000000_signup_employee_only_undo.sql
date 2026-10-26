-- Puts back the sign-up trigger and supervisor list from before 20261101000000_signup_employee_only.sql
-- (the versions in 20261028000000_attendance_leave_onboarding.sql, which look for the 'manager' role).
-- Run in Supabase -> SQL Editor only if you need to go back. One transaction.
begin;

create or replace function public.list_supervisors() returns table (id uuid, full_name text, job_title text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.job_title
  from public.profiles p
  where p.role = 'manager' and p.active
  order by p.full_name
$$;

revoke execute on function public.list_supervisors() from public;
grant execute on function public.list_supervisors() to anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nid text := nullif(btrim(coalesce(meta ->> 'national_id', '')), '');
  title text := nullif(btrim(coalesce(meta ->> 'job_title', '')), '');
  title_kind text;
  mgr uuid;
  mgr_team uuid;
  code text;
begin
  if nid is not null and not public.valid_national_id(nid) then raise exception 'invalid_national_id'; end if;

  if title is not null then
    select jt.kind into title_kind from public.job_titles jt where jt.name = title;
    if not found then title := null; end if;
    if title_kind is distinct from 'employee' then raise exception 'signup_role_forbidden'; end if;
  end if;
  if title_kind = 'employee' then code := public.next_employee_code(); end if;

  begin
    mgr := nullif(meta ->> 'manager_id', '')::uuid;
  exception when others then
    mgr := null;
  end;
  if mgr is not null then
    select p.team_id into mgr_team from public.profiles p where p.id = mgr and p.role = 'manager' and p.active;
    if not found then mgr := null; end if;
  end if;

  insert into public.profiles (id, full_name, email, role, active, job_title, manager_id, team_id, employee_code)
  values (
    new.id,
    coalesce(meta ->> 'full_name', ''),
    case when new.email like '%@staff.invalid' then null else new.email end,
    'employee',
    false, title, mgr, mgr_team, code
  );
  if nid is not null then
    insert into public.profile_private (id, national_id) values (new.id, nid);
  end if;
  return new;
end $$;

commit;
