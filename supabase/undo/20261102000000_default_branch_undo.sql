-- Goes back to the sign-up trigger from 20261101000000_signup_employee_only.sql (no branch) and removes the
-- default-branch setting. Branches already given to employees stay as they are.
-- Run in Supabase -> SQL Editor only if you need to go back. One transaction.
begin;

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

alter table public.settings drop column if exists default_location_id;

commit;
