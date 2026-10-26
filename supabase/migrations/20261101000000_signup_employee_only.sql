-- The employee sign-up page no longer asks for a job title, and its supervisor list shows supervisors only.
-- Run once in Supabase -> SQL Editor, AFTER 20261031000000_role_rename_chain.sql. Safe to run twice.
-- One transaction: if any statement fails, nothing is applied. supabase/undo/20261101000000_signup_employee_only_undo.sql
-- puts the previous versions back.
begin;

-- The sign-up form lists the people an employee can report to: supervisors only (not managers or assistant managers).
create or replace function public.list_supervisors() returns table (id uuid, full_name text, job_title text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.job_title
  from public.profiles p
  where p.role = 'supervisor' and p.active
  order by p.full_name
$$;

revoke execute on function public.list_supervisors() from public;
grant execute on function public.list_supervisors() to anon, authenticated;

-- Stores the sign-up answers. Anyone who registers with a national id is a regular employee: the database gives
-- them the default employee job title and the next employee number, whatever the browser sent. Accounts an admin
-- creates for supervisors / assistant managers / managers carry no national id and get their title afterwards.
-- Role and activation state are never taken from user-supplied metadata.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nid text := nullif(btrim(coalesce(meta ->> 'national_id', '')), '');
  title text;
  mgr uuid;
  mgr_team uuid;
  code text;
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
