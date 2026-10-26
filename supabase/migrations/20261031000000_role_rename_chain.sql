-- Rename the roles to the chain of responsibility used by the UI and the permission matrix:
--   admin > manager > assistant_manager > supervisor > employee
--   hr      -> assistant_manager   (runs several teams; does the operational work)
--   manager -> supervisor          (runs one team)
--   manager (new)                  (above the assistant manager; oversees and reports, read only)
-- Safe to run more than once.

-- 1. Widen the check constraints first, so the new names are allowed.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('employee', 'supervisor', 'assistant_manager', 'manager', 'admin'));

alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role in ('employee', 'supervisor', 'assistant_manager', 'manager'));

-- 2. Move the existing rows to the new names.
update public.profiles set role = 'supervisor' where role = 'manager';
update public.profiles set role = 'assistant_manager' where role = 'hr';

update public.role_permissions set role = 'supervisor' where role = 'manager';
update public.role_permissions set role = 'assistant_manager' where role = 'hr';

-- 3. The read-only manager: every feature visible, nothing editable.
insert into public.role_permissions (role, feature, access) values
  ('manager', 'attendance', 'all_view'),
  ('manager', 'attendance_excuse', 'all_view'),
  ('manager', 'leave_approvals', 'all_view'),
  ('manager', 'employees', 'all_view'),
  ('manager', 'national_ids', 'all_view'),
  ('manager', 'salaries', 'all_view'),
  ('manager', 'adjustments', 'all_view'),
  ('manager', 'payroll', 'all_view'),
  ('manager', 'payroll_approve', 'none'),
  ('manager', 'setup', 'all_view'),
  ('manager', 'rules', 'all_view'),
  ('manager', 'backup', 'none')
on conflict (role, feature) do update set access = excluded.access;

-- A manager never holds an edit permission in the database either.
update public.role_permissions
set access = replace(access, '_edit', '_view')
where role = 'manager' and access like '%\_edit' escape '\';

-- 4. Re-install the helpers that name roles.
create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('assistant_manager', 'admin'), false)
$$;

create or replace function public.is_manager_of(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('supervisor', 'assistant_manager', 'manager', 'admin'), false)
     and exists (select 1 from public.profiles p where p.id = emp and p.manager_id = auth.uid())
$$;

create or replace function public.same_team(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select emp = auth.uid() or exists (
    select 1
    from public.profiles me
    join public.profiles e on e.id = emp
    where me.id = auth.uid() and me.active
      and (
        (e.team_id is not null and e.team_id = me.team_id and (e.role <> 'supervisor' or e.id = me.id))
        or (me.role = 'assistant_manager' and exists (
          select 1 from public.teams t where t.id = e.team_id and t.manager_id = me.id))
      )
  )
$$;

-- A manager reports only: refuse every edit policy for the role, whatever the matrix says.
create or replace function public.my_access(p_feature text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.current_role_name() = 'admin' then 'all_edit'
    when public.current_role_name() = 'manager'
      then replace(coalesce((select rp.access from public.role_permissions rp
                             where rp.role = 'manager' and rp.feature = p_feature), 'none'), '_edit', '_view')
    else coalesce((select rp.access from public.role_permissions rp
                   where rp.role = public.current_role_name() and rp.feature = p_feature), 'none')
  end
$$;
