-- The reporting chain: employee -> supervisor -> assistant manager -> manager. A supervisor can now read the name of
-- the assistant manager in charge of their team, and that assistant manager's manager; an assistant manager can read
-- the name of their manager. Names only: the function returns nothing else about those people.
-- Run once in Supabase -> SQL Editor, AFTER 20261102000000_default_branch.sql. Safe to run twice.
-- supabase/undo/20261103000000_reporting_chain_undo.sql removes it again.
begin;

-- supervisor        -> the assistant manager in charge of their team (teams.manager_id), then that person's manager
-- assistant manager -> their manager (profiles.manager_id)
-- anyone else       -> no rows
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

commit;
