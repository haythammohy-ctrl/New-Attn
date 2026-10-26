-- A default branch for new employees: every employee who registers (or whom an admin adds) is put on it, so they
-- can clock in without waiting for HR to pick a branch. The admin picks it in Settings -> General Settings.
-- Run once in Supabase -> SQL Editor, AFTER 20261101000000_signup_employee_only.sql. Safe to run twice.
-- One transaction: if any statement fails, nothing is applied. supabase/undo/20261102000000_default_branch_undo.sql
-- puts the previous sign-up trigger back and removes the setting.
begin;

alter table public.settings
  add column if not exists default_location_id uuid references public.work_locations (id) on delete set null;

-- Start with the branch called "DC Hassan Allam"; if there is no such name but only one branch, use that one.
update public.settings
set default_location_id = (select l.id from public.work_locations l where l.name = 'DC Hassan Allam' order by l.id limit 1)
where id = 1 and default_location_id is null;

update public.settings
set default_location_id = (select l.id from public.work_locations l)
where id = 1 and default_location_id is null and (select count(*) from public.work_locations) = 1;

-- Employees who registered before this and still have no branch get the default one. Nobody who already has a
-- branch is changed, and supervisors / assistant managers / managers are left alone.
update public.profiles p
set location_id = s.default_location_id
from public.settings s
where s.id = 1 and s.default_location_id is not null and p.role = 'employee' and p.location_id is null;

-- Same as 20261101000000_signup_employee_only.sql, plus the branch for the new employee.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nid text := nullif(btrim(coalesce(meta ->> 'national_id', '')), '');
  title text;
  mgr uuid;
  mgr_team uuid;
  code text;
  loc uuid;
begin
  if nid is not null and not public.valid_national_id(nid) then raise exception 'invalid_national_id'; end if;

  if nid is not null then
    select jt.name into title
    from public.job_titles jt
    where jt.kind = 'employee'
    order by (jt.name = 'موظف') desc, jt.name
    limit 1;
    title := coalesce(title, 'موظف');
    code := public.next_employee_code();
    select s.default_location_id into loc from public.settings s where s.id = 1;
  end if;

  begin
    mgr := nullif(meta ->> 'manager_id', '')::uuid;
  exception when others then
    mgr := null;
  end;
  if mgr is not null then
    select p.team_id into mgr_team from public.profiles p where p.id = mgr and p.role = 'supervisor' and p.active;
    if not found then mgr := null; end if;
  end if;

  insert into public.profiles (id, full_name, email, role, active, job_title, manager_id, team_id, employee_code, location_id)
  values (
    new.id,
    coalesce(meta ->> 'full_name', ''),
    case when new.email like '%@staff.invalid' then null else new.email end,
    'employee',
    false, title, mgr, mgr_team, code, loc
  );

  if nid is not null then
    insert into public.profile_private (id, national_id) values (new.id, nid);
  end if;
  return new;
end $$;

commit;
