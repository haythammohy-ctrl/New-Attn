-- Attendance & Payroll: Supabase schema.
-- Run the whole file once in Supabase -> SQL Editor. Safe to read top to bottom.
--
-- Security model: the browser only holds the public anon key. Row-level security
-- (RLS) limits access according to role and permissions. Check-in and check-out
-- go through server functions that use the server clock and validate GPS coordinates.

-- ---------------------------------------------------------------- settings
create table public.settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'شركتي',
  timezone text not null default 'Africa/Cairo',
  currency text not null default 'EGP',
  days_in_month_mode text not null default '30' check (days_in_month_mode in ('30', 'actual')),
  prorate_hire_month boolean not null default false,
  social_insurance_percent numeric not null default 0 check (social_insurance_percent >= 0),
  tax_percent numeric not null default 0 check (tax_percent >= 0),
  overtime_multiplier numeric not null default 1.5 check (overtime_multiplier >= 0),
  overtime_threshold_min int not null default 30 check (overtime_threshold_min >= 0),
  late_factor numeric not null default 1 check (late_factor >= 0),
  absence_factor numeric not null default 1 check (absence_factor >= 0),
  max_accuracy_m int not null default 100 check (max_accuracy_m > 0),
  checkin_window_min int not null default 60 check (checkin_window_min >= 0)
);
insert into public.settings default values;

create table public.work_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m int not null default 100 check (radius_m > 0)
);

-- The branch every new employee starts on (chosen in Settings; handle_new_user reads it).
alter table public.settings
  add column default_location_id uuid references public.work_locations (id) on delete set null;

-- working_days uses 0 = Sunday ... 6 = Saturday. A shift may cross midnight:
-- end_time <= start_time means it ends the next day (e.g. 23:00 -> 07:00).
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time not null,
  end_time time not null,
  grace_minutes int not null default 10 check (grace_minutes >= 0),
  working_days int[] not null default '{0,1,2,3,4}',
  check (end_time <> start_time)
);
insert into public.shifts (name, start_time, end_time) values ('وردية الصباح', '09:00', '17:00');

-- ---------------------------------------------------------------- people
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  role text not null default 'employee' check (role in ('employee', 'supervisor', 'assistant_manager', 'manager', 'admin')),
  manager_id uuid references public.profiles (id) on delete set null,
  shift_id uuid references public.shifts (id) on delete set null,
  location_id uuid references public.work_locations (id) on delete set null,
  hire_date date,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Salary lives apart from profiles so managers can see their team without seeing pay.
create table public.salary_structures (
  employee_id uuid primary key references public.profiles (id) on delete cascade,
  base_salary numeric not null default 0 check (base_salary >= 0),
  allowances jsonb not null default '[]'
);

-- Public registration always creates an inactive employee; privileged roles are assigned by an admin.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    'employee',
    false
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role helpers. security definer lets them read profiles without tripping RLS recursion.
create function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function public.is_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('assistant_manager', 'admin'), false)
$$;

create function public.is_manager_of(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_name() in ('supervisor', 'assistant_manager', 'manager', 'admin'), false)
     and exists (select 1 from public.profiles p where p.id = emp and p.manager_id = auth.uid())
$$;

-- ---------------------------------------------------------------- attendance
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,          -- the day the shift STARTS (a night shift belongs to the evening it began)
  shift_id uuid references public.shifts (id) on delete set null,
  check_in_at timestamptz,
  check_in_lat double precision,
  check_in_lng double precision,
  check_out_at timestamptz,
  check_out_lat double precision,
  check_out_lng double precision,
  late_minutes int not null default 0,
  early_leave_minutes int not null default 0,
  overtime_minutes int not null default 0,
  status text not null default 'present' check (status in ('present', 'absent', 'excused')),
  verification_status text not null default 'approved' check (verification_status in ('pending', 'approved', 'rejected')),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  verification_note text,
  source text not null default 'manual' check (source in ('gps', 'manual')),
  note text,
  edited_by uuid references public.profiles (id),
  unique (employee_id, work_date)
);

create function public.haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- Shared by check_in/check_out: resolves the caller and verifies GPS against their branch.
create function public.assert_at_work(p_lat double precision, p_lng double precision, p_accuracy double precision)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  s public.settings;
  loc public.work_locations;
begin
  select * into me from public.profiles where id = auth.uid() and active;
  if me.id is null then raise exception 'not_active'; end if;
  select * into s from public.settings where id = 1;
  select * into loc from public.work_locations where id = me.location_id;
  if loc.id is null then raise exception 'no_location'; end if;
  if p_lat is null or p_lng is null or p_accuracy is null or p_accuracy > s.max_accuracy_m then
    raise exception 'low_accuracy';
  end if;
  if public.haversine_m(p_lat, p_lng, loc.lat, loc.lng) > loc.radius_m then
    raise exception 'out_of_range';
  end if;
  return me;
end $$;

-- The employee picks one of the shifts defined in the app when they check in. The pick is only
-- accepted while that shift is open: from checkin_window_min before its start until its end.
-- Yesterday, today and tomorrow are tried so a night shift still counts after midnight.
create function public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_shift_id uuid)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  s public.settings;
  sh public.shifts;
  d date;
  today date;
  nowm timestamptz := date_trunc('minute', now());
  st timestamptz;
  en timestamptz;
  best_start timestamptz;
  best_date date;
  late int := 0;
  rec public.attendance;
begin
  me := public.assert_at_work(p_lat, p_lng, p_accuracy);
  select * into s from public.settings where id = 1;
  select * into sh from public.shifts where id = p_shift_id;
  if sh.id is null then raise exception 'bad_shift'; end if;
  today := (now() at time zone s.timezone)::date;

  foreach d in array array[today - 1, today, today + 1] loop
    st := (d + sh.start_time) at time zone s.timezone;
    en := ((case when sh.end_time <= sh.start_time then d + 1 else d end) + sh.end_time) at time zone s.timezone;
    if nowm >= st - make_interval(mins => s.checkin_window_min) and nowm < en then
      if best_start is null
         or abs(extract(epoch from nowm - st)) < abs(extract(epoch from nowm - best_start)) then
        best_start := st;
        best_date := d;
      end if;
    end if;
  end loop;
  if best_start is null then raise exception 'shift_not_open'; end if;

  if exists (select 1 from public.attendance
             where employee_id = me.id and work_date = best_date and check_in_at is not null) then
    raise exception 'already_checked_in';
  end if;

  if nowm > best_start + make_interval(mins => sh.grace_minutes) then
    late := (extract(epoch from nowm - best_start) / 60)::int;
  end if;

  perform set_config('app.self_service', '1', true);
  insert into public.attendance (employee_id, work_date, shift_id, check_in_at, check_in_lat, check_in_lng, late_minutes, status, verification_status, source)
  values (me.id, best_date, sh.id, now(), p_lat, p_lng, late, 'present', 'pending', 'gps')
  on conflict (employee_id, work_date) do update
    set shift_id = excluded.shift_id, check_in_at = excluded.check_in_at,
        check_in_lat = excluded.check_in_lat, check_in_lng = excluded.check_in_lng,
        late_minutes = excluded.late_minutes, status = 'present',
        verification_status = 'pending', verified_by = null, verified_at = null, verification_note = null,
        source = 'gps'
  returning * into rec;
  return rec;
end $$;

-- Check-out closes the latest open check-in (so a forgotten check-out never blocks the next shift).
create function public.check_out(p_lat double precision, p_lng double precision, p_accuracy double precision)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  s public.settings;
  sh public.shifts;
  nowm timestamptz := date_trunc('minute', now());
  en timestamptz;
  early_min int := 0;
  ot_min int := 0;
  rec public.attendance;
begin
  me := public.assert_at_work(p_lat, p_lng, p_accuracy);
  select * into s from public.settings where id = 1;

  select * into rec from public.attendance
  where employee_id = me.id and check_in_at is not null
  order by check_in_at desc limit 1;
  if rec.id is null or rec.check_in_at < now() - interval '36 hours' then
    raise exception 'not_checked_in';
  end if;
  if rec.check_out_at is not null then raise exception 'already_checked_out'; end if;

  select * into sh from public.shifts where id = coalesce(rec.shift_id, me.shift_id);
  if sh.id is not null then
    en := ((case when sh.end_time <= sh.start_time then rec.work_date + 1 else rec.work_date end) + sh.end_time)
          at time zone s.timezone;
    early_min := greatest(0, (extract(epoch from en - nowm) / 60)::int);
    if nowm > en and nowm - en >= make_interval(mins => s.overtime_threshold_min) then
      ot_min := (extract(epoch from nowm - en) / 60)::int;
    end if;
  end if;

  update public.attendance
  set check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
      early_leave_minutes = early_min, overtime_minutes = ot_min
  where id = rec.id
  returning * into rec;
  return rec;
end $$;

-- Only signed-in users may call the punch functions; the helper stays private.
revoke execute on function public.check_in(double precision, double precision, double precision, uuid) from public, anon;
revoke execute on function public.check_out(double precision, double precision, double precision) from public, anon;
revoke execute on function public.assert_at_work(double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.check_in(double precision, double precision, double precision, uuid) to authenticated;
grant execute on function public.check_out(double precision, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------- leave
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  paid boolean not null default true,
  kind text not null default 'paid_leave'
    check (kind in ('paid_leave', 'unpaid_leave', 'day_off', 'public_holiday', 'absence', 'excused_absence')),
  annual_days int not null default 0 check (annual_days >= 0)   -- 0 = no yearly cap
);
insert into public.leave_types (name, paid, kind, annual_days) values
  ('Annual leave', true, 'paid_leave', 21),
  ('Unpaid leave', false, 'unpaid_leave', 0),
  ('Day off', true, 'day_off', 0),
  ('Public holiday', true, 'public_holiday', 0),
  ('Absence', false, 'absence', 0),
  ('Excused absence', true, 'excused_absence', 0);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id),
  from_date date not null,
  to_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null unique
);

-- ---------------------------------------------------------------- payroll
-- month is always the first day of the month.
create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  month date not null,
  type text not null check (type in ('bonus', 'deduction', 'advance')),
  amount numeric not null check (amount >= 0),
  note text
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  month date not null,
  base_salary numeric not null default 0,
  allowances_total numeric not null default 0,
  overtime_pay numeric not null default 0,
  bonuses numeric not null default 0,
  absence_deduction numeric not null default 0,
  late_deduction numeric not null default 0,
  insurance_deduction numeric not null default 0,
  tax_deduction numeric not null default 0,
  other_deductions numeric not null default 0,
  advances numeric not null default 0,
  net numeric not null default 0,
  details jsonb not null default '{}',
  unique (run_id, employee_id)
);

alter table public.payslips add column if not exists insurance_deduction numeric not null default 0;
alter table public.payslips add column if not exists tax_deduction numeric not null default 0;

-- Once a month is approved it is locked: no edits, no deletes, no going back to draft.
create function public.guard_payslips() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from public.payroll_runs where id = coalesce(new.run_id, old.run_id);
  if st is not null and st <> 'draft' then raise exception 'run_locked'; end if;
  return coalesce(new, old);
end $$;

create trigger payslips_guard
  before insert or update or delete on public.payslips
  for each row execute function public.guard_payslips();

create function public.guard_runs() returns trigger
language plpgsql as $$
declare
  rank_of constant jsonb := '{"draft":0,"approved":1,"paid":2}';
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'run_locked'; end if;
    return old;
  end if;
  if (rank_of ->> new.status)::int < (rank_of ->> old.status)::int
     or (old.status <> 'draft' and new.month <> old.month) then
    raise exception 'run_locked';
  end if;
  return new;
end $$;

create trigger payroll_runs_guard
  before update or delete on public.payroll_runs
  for each row execute function public.guard_runs();

-- ---------------------------------------------------------------- row level security
do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'work_locations', 'shifts', 'profiles', 'salary_structures', 'attendance',
    'leave_types', 'leave_requests', 'holidays', 'adjustments', 'payroll_runs', 'payslips'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Reference data: everyone signed in can read, only HR can change.
  foreach t in array array['settings', 'work_locations', 'shifts', 'leave_types', 'holidays'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_hr()) with check (public.is_hr())', t || '_hr_write', t);
  end loop;
end $$;

-- profiles: you, your team, or everyone if HR. Only HR edits (so nobody can promote themselves).
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_hr() or public.is_manager_of(id));
create policy profiles_hr_write on public.profiles for update to authenticated
  using (public.is_hr()) with check (public.is_hr());
create policy profiles_hr_delete on public.profiles for delete to authenticated
  using (public.is_hr());

create policy salary_read on public.salary_structures for select to authenticated
  using (employee_id = auth.uid() or public.is_hr());
create policy salary_hr_write on public.salary_structures for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

-- attendance: employees only write through check_in/check_out. HR corrections are audited via edited_by.
create policy attendance_read on public.attendance for select to authenticated
  using (employee_id = auth.uid() or public.is_hr() or public.is_manager_of(employee_id));
create policy attendance_hr_insert on public.attendance for insert to authenticated
  with check (public.is_hr() and edited_by = auth.uid());
create policy attendance_hr_update on public.attendance for update to authenticated
  using (public.is_hr()) with check (public.is_hr() and edited_by = auth.uid());
create policy attendance_hr_delete on public.attendance for delete to authenticated
  using (public.is_hr());

create policy leave_read on public.leave_requests for select to authenticated
  using (employee_id = auth.uid() or public.is_hr() or public.is_manager_of(employee_id));
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (employee_id = auth.uid() and status = 'pending' and public.current_role_name() is not null);
create policy leave_decide on public.leave_requests for update to authenticated
  using (public.is_hr() or public.is_manager_of(employee_id))
  with check ((public.is_hr() or public.is_manager_of(employee_id))
              and (status = 'pending' or decided_by = auth.uid()));
create policy leave_delete on public.leave_requests for delete to authenticated
  using (public.is_hr() or (employee_id = auth.uid() and status = 'pending'));

create policy adjustments_hr on public.adjustments for all to authenticated
  using (public.is_hr()) with check (public.is_hr());
create policy runs_hr on public.payroll_runs for all to authenticated
  using (public.is_hr()) with check (public.is_hr());

create policy payslips_hr on public.payslips for all to authenticated
  using (public.is_hr()) with check (public.is_hr());
-- Employees see their own payslip only after HR approves the month. The check is a
-- security definer function because employees have no read access to payroll_runs itself.
create function public.run_is_released(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payroll_runs where id = rid and status in ('approved', 'paid'))
$$;

create policy payslips_own on public.payslips for select to authenticated
  using (employee_id = auth.uid() and public.run_is_released(run_id));

-- ================================================================ BEGIN PERMISSIONS
-- Roles, teams, the permission matrix and the rules that replace the simple HR/admin policies above.

-- ---------------------------------------------------------------- teams, job titles, permission matrix
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- A team belongs to one assistant manager (role 'assistant_manager'), who may own several teams.
-- A supervisor (role 'supervisor') is a member of a team through profiles.team_id, many per team.
alter table public.teams add column if not exists manager_id uuid references public.profiles (id) on delete set null;

alter table public.profiles add column if not exists team_id uuid references public.teams (id) on delete set null;
alter table public.profiles add column if not exists job_title text;   -- free text, e.g. "أسيست سوبر فيزر"

create table if not exists public.role_permissions (
  role text not null check (role in ('employee', 'supervisor', 'assistant_manager', 'manager')),
  feature text not null,
  access text not null default 'none'
    check (access in ('none', 'team_view', 'team_edit', 'all_view', 'all_edit')),
  primary key (role, feature)
);

-- Starting values. Existing rows are never overwritten, so re-running keeps the admin's changes.
insert into public.role_permissions (role, feature, access) values
  ('assistant_manager', 'attendance', 'all_edit'),
  ('assistant_manager', 'attendance_excuse', 'all_edit'),
  ('assistant_manager', 'leave_approvals', 'all_edit'),
  ('assistant_manager', 'employees', 'all_edit'),
  ('assistant_manager', 'salaries', 'all_edit'),
  ('assistant_manager', 'adjustments', 'all_edit'),
  ('assistant_manager', 'payroll', 'all_edit'),
  ('assistant_manager', 'payroll_approve', 'none'),
  ('assistant_manager', 'setup', 'all_edit'),
  ('assistant_manager', 'rules', 'all_view'),
  ('assistant_manager', 'backup', 'none'),
  ('supervisor', 'attendance', 'team_edit'),
  ('supervisor', 'attendance_excuse', 'none'),
  ('supervisor', 'leave_approvals', 'team_edit'),
  ('supervisor', 'employees', 'team_view'),
  ('supervisor', 'salaries', 'none'),
  ('supervisor', 'adjustments', 'none'),
  ('supervisor', 'payroll', 'none'),
  ('supervisor', 'payroll_approve', 'none'),
  ('supervisor', 'setup', 'none'),
  ('supervisor', 'rules', 'none'),
  ('supervisor', 'backup', 'none'),
  ('employee', 'attendance', 'none'),
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
  ('manager', 'backup', 'none'),
  ('employee', 'attendance_excuse', 'none'),
  ('employee', 'leave_approvals', 'none'),
  ('employee', 'employees', 'none'),
  ('employee', 'salaries', 'none'),
  ('employee', 'adjustments', 'none'),
  ('employee', 'payroll', 'none'),
  ('employee', 'payroll_approve', 'none'),
  ('employee', 'setup', 'none'),
  ('employee', 'rules', 'none'),
  ('employee', 'backup', 'none')
on conflict (role, feature) do nothing;

-- Every manual change to attendance (not check-in/out) leaves a row here: who, when, before, after, why.
create table if not exists public.attendance_edits (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid,
  employee_id uuid not null,
  work_date date not null,
  actor_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  reason text,
  at timestamptz not null default now()
);

alter table public.teams enable row level security;
alter table public.role_permissions enable row level security;
alter table public.attendance_edits enable row level security;

-- ---------------------------------------------------------------- permission helpers
-- What the signed-in user may do with a feature. The admin always gets everything.
-- The manager role is read-only by design: whatever the matrix says, its access is
-- downgraded from *_edit to *_view here, so the database itself never lets a manager write.
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

create or replace function public.same_team(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  -- A supervisor (role 'supervisor') covers the employees on their own team, not co-supervisors.
  -- An assistant manager (role 'assistant_manager') covers the teams they own in teams.manager_id.
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

-- p_level is 'view' or 'edit'. With no employee given, only "all" scopes can match.
create or replace function public.can_access(p_feature text, p_level text, emp uuid default null)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  a text := public.my_access(p_feature);
begin
  if a = 'none' then return false; end if;
  if p_level = 'edit' and a not in ('team_edit', 'all_edit') then return false; end if;
  if a in ('all_view', 'all_edit') then return true; end if;
  return emp is not null and public.same_team(emp);
end $$;

-- Who may appear in the people list: yourself, and anyone you may see through any feature.
create or replace function public.can_see_person(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select emp = auth.uid()
      or public.can_access('employees', 'view', emp)
      or public.can_access('attendance', 'view', emp)
      or public.can_access('leave_approvals', 'view', emp)
      or public.can_access('salaries', 'view', emp)
      or public.can_access('adjustments', 'view', emp)
      or public.can_access('payroll', 'view', emp)
$$;

create or replace function public.my_permissions() returns table (feature text, access text)
language sql stable security definer set search_path = public as $$
  select f.feature, public.my_access(f.feature)
  from (select distinct rp.feature from public.role_permissions rp) f
$$;

-- The one thing every employee may change about themselves.
create or replace function public.update_my_phone(p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set phone = nullif(btrim(p_phone), '') where id = auth.uid();
end $$;

revoke execute on function public.my_access(text) from public, anon;
revoke execute on function public.same_team(uuid) from public, anon;
revoke execute on function public.can_access(text, text, uuid) from public, anon;
revoke execute on function public.can_see_person(uuid) from public, anon;
revoke execute on function public.my_permissions() from public, anon;
revoke execute on function public.update_my_phone(text) from public, anon;
grant execute on function public.my_access(text) to authenticated;
grant execute on function public.same_team(uuid) to authenticated;
grant execute on function public.can_access(text, text, uuid) to authenticated;
grant execute on function public.can_see_person(uuid) to authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.update_my_phone(text) to authenticated;

-- ---------------------------------------------------------------- guards (rules a policy cannot express)
-- check_in()/check_out() mark their own writes with app.self_service, so these rules only judge manual edits.
create or replace function public.attendance_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  emp uuid;
  wd date;
begin
  if current_setting('app.attendance_verification', true) = '1' then
    if tg_op <> 'UPDATE'
       or old.verification_status <> 'pending'
       or new.verification_status not in ('approved', 'rejected')
       or new.verified_by is distinct from auth.uid()
       or new.edited_by is distinct from auth.uid()
       or (new.verification_status = 'rejected' and coalesce(btrim(new.verification_note), '') = '')
       or (to_jsonb(new) - array['verification_status', 'verified_by', 'verified_at', 'verification_note', 'edited_by'])
          is distinct from
          (to_jsonb(old) - array['verification_status', 'verified_by', 'verified_at', 'verification_note', 'edited_by']) then
      raise exception 'forbidden';
    end if;
    insert into public.attendance_edits (attendance_id, employee_id, work_date, actor_id, action, old_data, new_data, reason)
    values (new.id, new.employee_id, new.work_date, auth.uid(), 'update', to_jsonb(old), to_jsonb(new), new.verification_note);
    return new;
  end if;
  -- a session without a signed-in app user (the SQL Editor, a server job) is an operator: not judged here
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if current_setting('app.self_service', true) = '1' then
    if tg_op = 'INSERT' then
      new.verification_status := 'pending';
      new.verified_by := null;
      new.verified_at := null;
      new.verification_note := null;
      new.source := 'gps';
    elsif new.check_in_at is distinct from old.check_in_at then
      new.verification_status := 'pending';
      new.verified_by := null;
      new.verified_at := null;
      new.verification_note := null;
      new.source := 'gps';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'approved';
    new.verified_by := null;
    new.verified_at := null;
    new.verification_note := null;
    new.source := 'manual';
  elsif tg_op = 'UPDATE'
     and (
       new.verification_status is distinct from old.verification_status
       or new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at
       or new.verification_note is distinct from old.verification_note
       or new.source is distinct from old.source
     ) then
    raise exception 'forbidden';
  end if;

  actor_role := public.current_role_name();
  if actor_role is null then raise exception 'forbidden'; end if;
  if tg_op = 'DELETE' then
    emp := old.employee_id;
    wd := old.work_date;
  else
    emp := new.employee_id;
    wd := new.work_date;
  end if;

  if tg_op = 'DELETE' then
    if actor_role <> 'admin' then raise exception 'forbidden'; end if;
  else
    -- nobody edits their own attendance except the admin
    if emp = auth.uid() and actor_role <> 'admin' then raise exception 'self_edit'; end if;
    -- after payroll is approved, only the HR manager and system administrator may still edit it
    if actor_role not in ('assistant_manager', 'admin')
       and exists (select 1 from public.payroll_runs r
                   where r.month = date_trunc('month', wd::timestamp)::date and r.status <> 'draft') then
      raise exception 'month_locked';
    end if;
    -- every edit needs a reason, and a new one each time
    if coalesce(btrim(new.note), '') = '' then raise exception 'reason_required'; end if;
    if tg_op = 'UPDATE' and new.note is not distinct from old.note then raise exception 'reason_required'; end if;
    -- turning a day into / out of excused or absent changes the deduction, so it has its own permission
    if (tg_op = 'INSERT' and new.status <> 'present')
       or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
      if not public.can_access('attendance_excuse', 'edit', emp) then raise exception 'forbidden_status'; end if;
    end if;
  end if;

  insert into public.attendance_edits (attendance_id, employee_id, work_date, actor_id, action, old_data, new_data, reason)
  values (
    case when tg_op = 'DELETE' then old.id else new.id end,
    emp, wd, auth.uid(), lower(tg_op),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    case when tg_op = 'DELETE' then null else new.note end
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function public.verify_attendance(p_id uuid, p_decision text, p_note text default '')
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  rec public.attendance;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then raise exception 'reason_required'; end if;
  select * into rec from public.attendance where id = p_id for update;
  if rec.id is null or rec.verification_status <> 'pending' then raise exception 'verification_not_pending'; end if;
  if rec.employee_id = auth.uid() or not public.can_access('attendance', 'edit', rec.employee_id) then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from public.payroll_runs r where r.month = date_trunc('month', rec.work_date::timestamp)::date and r.status <> 'draft') then
    raise exception 'month_locked';
  end if;
  perform set_config('app.attendance_verification', '1', true);
  update public.attendance
  set verification_status = p_decision,
      verified_by = auth.uid(),
      verified_at = now(),
      verification_note = case when p_decision = 'approved' then null else btrim(p_note) end,
      edited_by = auth.uid()
  where id = p_id
  returning * into rec;
  return rec;
end $$;

revoke execute on function public.verify_attendance(uuid, text, text) from public, anon;
grant execute on function public.verify_attendance(uuid, text, text) to authenticated;

-- An employee who missed clock-out requests a correction with their actual out time and reason.
create or replace function public.request_checkout_correction(p_attendance_id uuid, p_out_time text, p_reason text)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  rec public.attendance;
begin
  select * into rec from public.attendance where id = p_attendance_id and employee_id = auth.uid() for update;
  if rec.id is null then raise exception 'forbidden'; end if;
  if rec.check_out_at is not null then raise exception 'already_checked_out'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;

  perform set_config('app.attendance_verification', '1', true);
  update public.attendance
  set note = 'طلب تسجيل الانصراف (' || coalesce(p_out_time, '') || '): ' || btrim(p_reason),
      verification_status = 'pending',
      edited_by = auth.uid()
  where id = rec.id
  returning * into rec;
  return rec;
end $$;

revoke execute on function public.request_checkout_correction(uuid, text, text) from public, anon;
grant execute on function public.request_checkout_correction(uuid, text, text) to authenticated;

drop trigger if exists attendance_guard on public.attendance;
create trigger attendance_guard
  before insert or update or delete on public.attendance
  for each row execute function public.attendance_guard();

-- Only the admin touches admin accounts or hands out the HR/admin roles; nobody changes their own role or active flag.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor_role text := public.current_role_name();
begin
  if auth.uid() is null then return new; end if;   -- operator session (SQL Editor): not judged here
  if actor_role is null then raise exception 'forbidden'; end if;
  if actor_role = 'admin' then return new; end if;
  if old.role = 'admin' then raise exception 'role_forbidden'; end if;
  if new.role is distinct from old.role
     and ((new.role in ('assistant_manager', 'manager', 'admin') or old.role in ('assistant_manager', 'manager', 'admin'))) then
    raise exception 'role_forbidden';
  end if;
  if new.id = auth.uid() and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'role_forbidden';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- "Delete" a person = archive them: the account stops working and they disappear from the lists, but everything they
-- did (attendance, leave, payslips) stays, and their national id stays reserved. The admin can restore them.
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

-- Payroll months: no going back once approved, and approving needs its own permission.
create or replace function public.guard_runs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rank_of constant jsonb := '{"draft":0,"approved":1,"paid":2}';
  operator_session boolean := auth.uid() is null;   -- SQL Editor / server job: no approval permission to check
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'run_locked'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and not operator_session and public.my_access('payroll_approve') <> 'all_edit' then
      raise exception 'forbidden';
    end if;
    return new;
  end if;
  if (rank_of ->> new.status)::int < (rank_of ->> old.status)::int
     or (old.status <> 'draft' and new.month <> old.month) then
    raise exception 'run_locked';
  end if;
  if new.status <> old.status and new.status in ('approved', 'paid')
     and not operator_session and public.my_access('payroll_approve') <> 'all_edit' then
    raise exception 'forbidden';
  end if;
  return new;
end $$;

drop trigger if exists payroll_runs_guard on public.payroll_runs;
create trigger payroll_runs_guard
  before insert or update or delete on public.payroll_runs
  for each row execute function public.guard_runs();

-- Same lock as before, written so it never reads NEW on a delete or OLD on an insert.
create or replace function public.guard_payslips() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  st text;
begin
  if tg_op = 'DELETE' then
    select status into st from public.payroll_runs where id = old.run_id;
  else
    select status into st from public.payroll_runs where id = new.run_id;
  end if;
  if st is not null and st <> 'draft' then raise exception 'run_locked'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- check-in / check-out
-- The marker lets attendance_guard identify this as the employee's own check-in.
create or replace function public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_shift_id uuid)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  s public.settings;
  sh public.shifts;
  d date;
  today date;
  nowm timestamptz := date_trunc('minute', now());
  st timestamptz;
  en timestamptz;
  best_start timestamptz;
  best_date date;
  late int := 0;
  rec public.attendance;
begin
  perform set_config('app.self_service', '1', true);
  me := public.assert_at_work(p_lat, p_lng, p_accuracy);
  select * into s from public.settings where id = 1;
  select * into sh from public.shifts where id = p_shift_id;
  if sh.id is null then raise exception 'bad_shift'; end if;
  today := (now() at time zone s.timezone)::date;

  foreach d in array array[today - 1, today, today + 1] loop
    st := (d + sh.start_time) at time zone s.timezone;
    en := ((case when sh.end_time <= sh.start_time then d + 1 else d end) + sh.end_time) at time zone s.timezone;
    if nowm >= st - make_interval(mins => s.checkin_window_min) and nowm < en then
      if best_start is null
         or abs(extract(epoch from nowm - st)) < abs(extract(epoch from nowm - best_start)) then
        best_start := st;
        best_date := d;
      end if;
    end if;
  end loop;
  if best_start is null then raise exception 'shift_not_open'; end if;

  if exists (select 1 from public.attendance
             where employee_id = me.id and work_date = best_date and check_in_at is not null) then
    raise exception 'already_checked_in';
  end if;

  if nowm > best_start + make_interval(mins => sh.grace_minutes) then
    late := (extract(epoch from nowm - best_start) / 60)::int;
  end if;

  insert into public.attendance (employee_id, work_date, shift_id, check_in_at, check_in_lat, check_in_lng, late_minutes, status)
  values (me.id, best_date, sh.id, now(), p_lat, p_lng, late, 'present')
  on conflict (employee_id, work_date) do update
    set shift_id = excluded.shift_id, check_in_at = excluded.check_in_at,
        check_in_lat = excluded.check_in_lat, check_in_lng = excluded.check_in_lng,
        late_minutes = excluded.late_minutes, status = 'present'
  returning * into rec;
  return rec;
end $$;

create or replace function public.check_out(p_lat double precision, p_lng double precision, p_accuracy double precision)
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  s public.settings;
  sh public.shifts;
  nowm timestamptz := date_trunc('minute', now());
  en timestamptz;
  early_min int := 0;
  ot_min int := 0;
  rec public.attendance;
begin
  perform set_config('app.self_service', '1', true);
  me := public.assert_at_work(p_lat, p_lng, p_accuracy);
  select * into s from public.settings where id = 1;

  select * into rec from public.attendance
  where employee_id = me.id and check_in_at is not null
  order by check_in_at desc limit 1;
  if rec.id is null or rec.check_in_at < now() - interval '36 hours' then
    raise exception 'not_checked_in';
  end if;
  if rec.check_out_at is not null then raise exception 'already_checked_out'; end if;

  select * into sh from public.shifts where id = coalesce(rec.shift_id, me.shift_id);
  if sh.id is not null then
    en := ((case when sh.end_time <= sh.start_time then rec.work_date + 1 else rec.work_date end) + sh.end_time)
          at time zone s.timezone;
    early_min := greatest(0, (extract(epoch from en - nowm) / 60)::int);
    if nowm > en and nowm - en >= make_interval(mins => s.overtime_threshold_min) then
      ot_min := (extract(epoch from nowm - en) / 60)::int;
    end if;
  end if;

  update public.attendance
  set check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
      early_leave_minutes = early_min, overtime_minutes = ot_min
  where id = rec.id
  returning * into rec;
  return rec;
end $$;

-- ---------------------------------------------------------------- row level security
-- Replace every earlier policy on these tables, whatever it was called.
do $$
declare
  p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('settings', 'work_locations', 'shifts', 'profiles', 'salary_structures', 'attendance',
                        'leave_types', 'leave_requests', 'holidays', 'adjustments', 'payroll_runs', 'payslips',
                        'teams', 'role_permissions', 'attendance_edits')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- Reference data: everyone signed in reads it (the app needs it); changing it needs "setup".
create policy work_locations_read on public.work_locations for select to authenticated using (true);
create policy work_locations_write on public.work_locations for all to authenticated
  using (public.can_access('setup', 'edit')) with check (public.can_access('setup', 'edit'));
create policy shifts_read on public.shifts for select to authenticated using (true);
create policy shifts_write on public.shifts for all to authenticated
  using (public.can_access('setup', 'edit')) with check (public.can_access('setup', 'edit'));
create policy holidays_read on public.holidays for select to authenticated using (true);
create policy holidays_write on public.holidays for all to authenticated
  using (public.can_access('setup', 'edit')) with check (public.can_access('setup', 'edit'));
create policy leave_types_read on public.leave_types for select to authenticated using (true);
create policy leave_types_write on public.leave_types for all to authenticated
  using (public.can_access('setup', 'edit')) with check (public.can_access('setup', 'edit'));

-- The general settings row is read by the whole app; only "rules" edit may change it (never delete it).
create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_insert on public.settings for insert to authenticated
  with check (public.can_access('rules', 'edit'));
create policy settings_update on public.settings for update to authenticated
  using (public.can_access('rules', 'edit')) with check (public.can_access('rules', 'edit'));

create policy teams_read on public.teams for select to authenticated using (true);
create policy teams_write on public.teams for all to authenticated
  using (public.can_access('employees', 'edit')) with check (public.can_access('employees', 'edit'));

-- People: yourself, plus whoever one of your permissions covers. Role and admin protection is in profiles_guard.
create policy profiles_read on public.profiles for select to authenticated
  using (public.can_see_person(id));
create policy profiles_update on public.profiles for update to authenticated
  using (public.can_access('employees', 'edit', id)) with check (public.can_access('employees', 'edit', id));
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.current_role_name() = 'admin');

create policy salary_read on public.salary_structures for select to authenticated
  using (employee_id = auth.uid()
         or public.can_access('salaries', 'view', employee_id)
         or public.can_access('payroll', 'view', employee_id));
create policy salary_write on public.salary_structures for all to authenticated
  using (public.can_access('salaries', 'edit', employee_id))
  with check (public.can_access('salaries', 'edit', employee_id));

create policy adjustments_read on public.adjustments for select to authenticated
  using (public.can_access('adjustments', 'view', employee_id) or public.can_access('payroll', 'view', employee_id));
create policy adjustments_write on public.adjustments for all to authenticated
  using (public.can_access('adjustments', 'edit', employee_id))
  with check (public.can_access('adjustments', 'edit', employee_id));

-- Attendance: employees write only through check_in/check_out. Manual edits go through attendance_guard.
create policy attendance_read on public.attendance for select to authenticated
  using (employee_id = auth.uid() or public.can_access('attendance', 'view', employee_id));
create policy attendance_insert on public.attendance for insert to authenticated
  with check (public.can_access('attendance', 'edit', employee_id) and edited_by = auth.uid());
create policy attendance_update on public.attendance for update to authenticated
  using (public.can_access('attendance', 'edit', employee_id))
  with check (public.can_access('attendance', 'edit', employee_id) and edited_by = auth.uid());
create policy attendance_delete on public.attendance for delete to authenticated
  using (public.current_role_name() = 'admin');

create policy attendance_edits_read on public.attendance_edits for select to authenticated
  using (public.can_access('attendance', 'view', employee_id));

create policy leave_read on public.leave_requests for select to authenticated
  using (employee_id = auth.uid() or public.can_access('leave_approvals', 'view', employee_id));
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (employee_id = auth.uid() and status = 'pending' and public.current_role_name() is not null);
-- Nobody decides their own request except the admin.
create policy leave_decide on public.leave_requests for update to authenticated
  using (public.can_access('leave_approvals', 'edit', employee_id))
  with check (public.can_access('leave_approvals', 'edit', employee_id)
              and (employee_id <> auth.uid() or public.current_role_name() = 'admin')
              and (status = 'pending' or decided_by = auth.uid()));
create policy leave_delete on public.leave_requests for delete to authenticated
  using ((public.can_access('leave_approvals', 'edit', employee_id)
          and (employee_id <> auth.uid() or public.current_role_name() = 'admin'))
         or (employee_id = auth.uid() and status = 'pending'));

create policy runs_read on public.payroll_runs for select to authenticated
  using (public.can_access('payroll', 'view'));
create policy runs_write on public.payroll_runs for all to authenticated
  using (public.can_access('payroll', 'edit')) with check (public.can_access('payroll', 'edit'));

-- Employees see their own payslip only after the month is approved (run_is_released is from schema.sql).
create policy payslips_read on public.payslips for select to authenticated
  using ((employee_id = auth.uid() and public.run_is_released(run_id))
         or public.can_access('payroll', 'view', employee_id));
create policy payslips_write on public.payslips for all to authenticated
  using (public.can_access('payroll', 'edit', employee_id))
  with check (public.can_access('payroll', 'edit', employee_id));

-- The matrix itself: the admin only. Everyone else gets their own row set through my_permissions().
create policy role_permissions_admin on public.role_permissions for all to authenticated
  using (public.current_role_name() = 'admin') with check (public.current_role_name() = 'admin');

-- ================================================================ END PERMISSIONS

-- ================================================================ BEGIN REGISTRATION
-- Sign-up questions, job titles, employee numbers and the private national ID table.

-- ---------------------------------------------------------------- job titles, employee numbers, national ids
-- kind: 'employee' = a regular employee (email optional, gets an employee number, needs a direct manager);
--       'supervision' = supervisor, assistant manager... (email required, no employee number).
create table if not exists public.job_titles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null default 'employee' check (kind in ('employee', 'supervision'))
);

insert into public.job_titles (name, kind) values
  ('موظف', 'employee'),
  ('سوبر فيزر', 'supervision'),
  ('أسيست سوبر فيزر', 'supervision'),
  ('أسيستنت مانجر', 'supervision')
on conflict (name) do nothing;

alter table public.profiles add column if not exists employee_code text unique;
alter table public.settings add column if not exists employee_code_prefix text not null default 'DC'
  check (employee_code_prefix ~ '^[A-Za-z0-9]{1,8}$');

create sequence if not exists public.employee_code_seq;

-- 14 digits, first digit 2 (1900s) or 3 (2000s), then a real birth date YYMMDD.
create or replace function public.valid_national_id(nid text) returns boolean
language plpgsql immutable as $$
declare
  century int;
begin
  if nid is null or nid !~ '^[23][0-9]{13}$' then return false; end if;
  century := case substr(nid, 1, 1) when '2' then 1900 else 2000 end;
  perform make_date(century + substr(nid, 2, 2)::int, substr(nid, 4, 2)::int, substr(nid, 6, 2)::int);
  return true;
exception when others then
  return false;
end $$;

-- The national id lives apart from profiles (like salaries), so a team view of people never carries it.
create table if not exists public.profile_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  national_id text not null unique check (public.valid_national_id(national_id))
);

alter table public.job_titles enable row level security;
alter table public.profile_private enable row level security;

-- The sign-up form reads the job titles before anyone is signed in.
grant select on public.job_titles to anon;

-- Who may see / correct national ids: a new feature in the permission matrix. Existing rows are kept.
insert into public.role_permissions (role, feature, access) values
  ('assistant_manager', 'national_ids', 'all_edit'),
  ('supervisor', 'national_ids', 'none'),
  ('employee', 'national_ids', 'none')
on conflict (role, feature) do nothing;

-- ---------------------------------------------------------------- functions
create or replace function public.next_employee_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  prefix text;
  n bigint := nextval('public.employee_code_seq');
begin
  select employee_code_prefix into prefix from public.settings where id = 1;
  return coalesce(prefix, 'DC') || lpad(n::text, greatest(6, length(n::text)), '0');
end $$;

-- For an employee who has no number yet (someone who signed up before this, or whose job title changed).
create or replace function public.assign_employee_code(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  code text;
begin
  if not public.can_access('employees', 'edit', p_id) then raise exception 'forbidden'; end if;
  select employee_code into code from public.profiles where id = p_id;
  if not found then raise exception 'forbidden'; end if;
  if code is null then
    code := public.next_employee_code();
    update public.profiles set employee_code = code where id = p_id;
  end if;
  return code;
end $$;

-- The sign-up form needs the supervisors' names before anyone is signed in.
create or replace function public.list_supervisors() returns table (id uuid, full_name text, job_title text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.job_title
  from public.profiles p
  where p.role = 'supervisor' and p.active
  order by p.full_name
$$;

revoke execute on function public.next_employee_code() from public, anon, authenticated;
revoke execute on function public.assign_employee_code(uuid) from public, anon;
revoke execute on function public.list_supervisors() from public;
grant execute on function public.assign_employee_code(uuid) to authenticated;
grant execute on function public.list_supervisors() to anon, authenticated;

-- The reporting chain, names only: a supervisor reads the assistant manager in charge of their team and that
-- person's manager; an assistant manager reads their manager. Anyone else gets no rows.
create or replace function public.my_chain() returns table (relation text, id uuid, full_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles;
  assistant public.profiles;
  boss public.profiles;
  below_manager uuid;
begin
  select p.* into me from public.profiles p where p.id = auth.uid() and p.active;
  if me.id is null then return; end if;

  if me.role = 'supervisor' and me.team_id is not null then
    select a.* into assistant
    from public.teams t
    join public.profiles a on a.id = t.manager_id
    where t.id = me.team_id and a.role = 'assistant_manager' and a.active;
    if assistant.id is not null then
      relation := 'assistant_manager'; id := assistant.id; full_name := assistant.full_name;
      return next;
      below_manager := assistant.manager_id;
    end if;
  elsif me.role = 'assistant_manager' then
    below_manager := me.manager_id;
  end if;

  if below_manager is not null then
    select b.* into boss from public.profiles b where b.id = below_manager and b.role = 'manager' and b.active;
    if boss.id is not null then
      relation := 'manager'; id := boss.id; full_name := boss.full_name;
      return next;
    end if;
  end if;
end $$;

revoke execute on function public.my_chain() from public, anon;
grant execute on function public.my_chain() to authenticated;

-- Stores employee sign-up answers. Role and activation state are never taken from user-supplied metadata.
-- Anything wrong with the national id aborts the whole sign-up (nothing half-created).
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

  -- Anyone who registers with a national id is a regular employee: the database gives them the default employee
  -- job title and the next employee number, whatever the browser sent. Accounts an admin creates for supervisors /
  -- assistant managers / managers carry no national id and get their title afterwards.
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

-- ---------------------------------------------------------------- row level security
-- Job titles are public (the sign-up form reads them); changing them needs "setup".
drop policy if exists job_titles_read on public.job_titles;
drop policy if exists job_titles_write on public.job_titles;
create policy job_titles_read on public.job_titles for select to anon, authenticated using (true);
create policy job_titles_write on public.job_titles for all to authenticated
  using (public.can_access('setup', 'edit')) with check (public.can_access('setup', 'edit'));

drop policy if exists profile_private_read on public.profile_private;
drop policy if exists profile_private_write on public.profile_private;
create policy profile_private_read on public.profile_private for select to authenticated
  using (id = auth.uid() or public.can_access('national_ids', 'view', id));
create policy profile_private_write on public.profile_private for all to authenticated
  using (public.can_access('national_ids', 'edit', id)) with check (public.can_access('national_ids', 'edit', id));

-- ================================================================ END REGISTRATION
