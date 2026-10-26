-- Add leave classifications, supervisor attendance review, and safe public onboarding.
alter table public.settings
  add column if not exists prorate_hire_month boolean not null default false,
  add column if not exists social_insurance_percent numeric not null default 0
    check (social_insurance_percent >= 0),
  add column if not exists tax_percent numeric not null default 0
    check (tax_percent >= 0);

alter table public.attendance
  add column if not exists verification_status text not null default 'approved',
  add column if not exists verified_by uuid references public.profiles (id),
  add column if not exists verified_at timestamptz,
  add column if not exists verification_note text,
  add column if not exists source text not null default 'manual';
update public.attendance
set source = 'gps'
where check_in_lat is not null and check_in_lng is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_verification_status_check') then
    alter table public.attendance add constraint attendance_verification_status_check
      check (verification_status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_source_check') then
    alter table public.attendance add constraint attendance_source_check
      check (source in ('gps', 'manual'));
  end if;
end $$;

alter table public.leave_types
  add column if not exists kind text not null default 'paid_leave';
update public.leave_types
set kind = 'unpaid_leave'
where not paid and kind = 'paid_leave';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_types_kind_check') then
    alter table public.leave_types add constraint leave_types_kind_check
      check (kind in ('paid_leave', 'unpaid_leave', 'day_off', 'public_holiday', 'absence', 'excused_absence'));
  end if;
end $$;

insert into public.leave_types (name, paid, kind, annual_days)
select seed.name, seed.paid, seed.kind, seed.annual_days
from (values
  ('Day off', true, 'day_off', 0),
  ('Public holiday', true, 'public_holiday', 0),
  ('Absence', false, 'absence', 0),
  ('Excused absence', true, 'excused_absence', 0)
) as seed(name, paid, kind, annual_days)
where not exists (select 1 from public.leave_types lt where lt.kind = seed.kind);

create or replace function public.attendance_verification_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.self_service', true) = '1' then
    if tg_op = 'INSERT' then
      new.verification_status := 'pending';
      new.verified_by := null;
      new.verified_at := null;
      new.verification_note := null;
      new.source := 'gps';
    elsif tg_op = 'UPDATE' and new.check_in_at is distinct from old.check_in_at then
      new.verification_status := 'pending';
      new.verified_by := null;
      new.verified_at := null;
      new.verification_note := null;
      new.source := 'gps';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'approved';
    new.verified_by := null;
    new.verified_at := null;
    new.verification_note := null;
    new.source := 'manual';
    return new;
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if (
       new.verification_status is distinct from old.verification_status
       or new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at
       or new.verification_note is distinct from old.verification_note
       or new.source is distinct from old.source
     ) and current_setting('app.attendance_verification', true) is distinct from '1' then
    raise exception 'forbidden';
  end if;
  return new;
end $$;

drop trigger if exists attendance_verification_guard on public.attendance;
create trigger attendance_verification_guard
  before insert or update or delete on public.attendance
  for each row execute function public.attendance_verification_guard();

create or replace function public.verify_attendance(p_id uuid, p_decision text, p_note text default '')
returns public.attendance
language plpgsql security definer set search_path = public as $$
declare
  rec public.attendance;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required'; end if;
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
      verification_note = btrim(p_note),
      edited_by = auth.uid(),
      note = concat_ws(E'\n', nullif(note, ''), 'Supervisor review: ' || btrim(p_note))
  where id = p_id
  returning * into rec;
  return rec;
end $$;

revoke execute on function public.verify_attendance(uuid, text, text) from public, anon;
grant execute on function public.verify_attendance(uuid, text, text) to authenticated;

-- User metadata cannot grant a privileged role or activate a public registration.
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
