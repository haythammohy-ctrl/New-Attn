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
    if emp = auth.uid() and actor_role <> 'admin' then raise exception 'self_edit'; end if;
    if actor_role not in ('hr', 'admin')
       and exists (select 1 from public.payroll_runs r
                   where r.month = date_trunc('month', wd::timestamp)::date and r.status <> 'draft') then
      raise exception 'month_locked';
    end if;
    if coalesce(btrim(new.note), '') = '' then raise exception 'reason_required'; end if;
    if tg_op = 'UPDATE' and new.note is not distinct from old.note then raise exception 'reason_required'; end if;
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

drop policy if exists attendance_edits_read on public.attendance_edits;
create policy attendance_edits_read on public.attendance_edits for select to authenticated
  using (public.can_access('attendance', 'view', employee_id));
