-- Removes the my_chain() function added by 20261103000000_reporting_chain.sql. Nothing else changed in that upgrade.
-- Run in Supabase -> SQL Editor only if you need to go back.
begin;
drop function if exists public.my_chain();
commit;
