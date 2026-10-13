-- Follow-ups from the Supabase advisors after the first deploy.

-- keepalive() only returns now(); it needs no elevated rights, so it runs as the caller.
alter function public.keepalive() security invoker;

-- Supabase creates public.rls_auto_enable() (an event-trigger function) and grants EXECUTE
-- on it to anon and authenticated, which exposes it as /rest/v1/rpc/rls_auto_enable.
-- Event triggers fire regardless of EXECUTE privileges, so revoking only closes the endpoint.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- Cover the two upload_slices foreign keys (cascades and joins from companies/uploads).
create index if not exists upload_slices_company_idx on public.upload_slices (company_id);
create index if not exists upload_slices_upload_dataset_scenario_idx
  on public.upload_slices (upload_id, dataset_id, scenario);
