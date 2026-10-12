-- Keep-alive for Supabase's free plan, which pauses projects after seven days without activity.
-- Vercel Cron calls /api/keepalive daily with the publishable key; this function is the only
-- thing anon may execute. It reads no data and returns the server time.

create or replace function public.keepalive()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select now()
$$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
