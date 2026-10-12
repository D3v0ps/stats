-- Login throttle. login_gate/login_record live in public so PostgREST can reach them,
-- but only service_role may execute them (src/lib/db/admin.ts). Rules:
-- * per ip_hash: 5 failures within 15 minutes lock that hash for 15 minutes, doubling
--   with every further lockout in the last 24 hours (cap 24 hours); a successful login
--   resets the history;
-- * more than 50 failures in the last hour across all hashes add delay_ms (up to
--   3000) for everyone, never a hard global lock;
-- * attempts older than 24 hours are deleted opportunistically.
-- ip_hash must look like a hash (no dots or colons), so a raw IP is never stored.

grant select, insert, delete on private.login_attempts to service_role;

create or replace function private.login_lock_state(p_ip_hash text, p_now timestamptz)
returns table (locked_until timestamptz, lockouts integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_since timestamptz := p_now - interval '24 hours';
  v_last_ok timestamptz;
  v_until timestamptz;
  v_count integer := 0;
  v_window timestamptz[] := '{}';
  v_at timestamptz;
begin
  select max(a.at) into v_last_ok
  from private.login_attempts a
  where a.ip_hash = p_ip_hash and a.ok and a.at > v_since and a.at <= p_now;

  for v_at in
    select a.at
    from private.login_attempts a
    where a.ip_hash = p_ip_hash
      and not a.ok
      and a.at > coalesce(greatest(v_since, v_last_ok), v_since)
      and a.at <= p_now
    order by a.at
  loop
    -- Attempts made while locked do not count towards the next lockout.
    if v_until is not null and v_at < v_until then
      continue;
    end if;
    v_window := array(select w from unnest(v_window) as w where w > v_at - interval '15 minutes')
      || v_at;
    if cardinality(v_window) >= 5 then
      v_count := v_count + 1;
      v_until := v_at + least(interval '15 minutes' * power(2, v_count - 1), interval '24 hours');
      v_window := '{}';
    end if;
  end loop;

  locked_until := v_until;
  lockouts := v_count;
  return next;
end;
$$;

create or replace function public.login_gate(p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_until timestamptz;
  v_failures bigint;
  v_delay integer := 0;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[A-Za-z0-9+/=_-]{16,128}$' then
    raise exception 'Ogiltig ip-hash' using errcode = 'invalid_parameter_value';
  end if;

  select st.locked_until into v_until from private.login_lock_state(p_ip_hash, v_now) st;

  select count(*) into v_failures
  from private.login_attempts a
  where not a.ok and a.at > v_now - interval '1 hour';
  if v_failures > 50 then
    v_delay := least(3000, 1000 + (v_failures - 51) * 50)::integer;
  end if;

  if v_until is not null and v_until > v_now then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_s', ceil(extract(epoch from v_until - v_now))::integer,
      'delay_ms', v_delay
    );
  end if;
  return jsonb_build_object('allowed', true, 'retry_after_s', 0, 'delay_ms', v_delay);
end;
$$;

create or replace function public.login_record(p_ip_hash text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ip_hash is null or p_ip_hash !~ '^[A-Za-z0-9+/=_-]{16,128}$' then
    raise exception 'Ogiltig ip-hash' using errcode = 'invalid_parameter_value';
  end if;
  if p_ok is null then
    raise exception 'Utfall saknas' using errcode = 'invalid_parameter_value';
  end if;
  insert into private.login_attempts (ip_hash, ok) values (p_ip_hash, p_ok);
  delete from private.login_attempts a where a.at < now() - interval '24 hours';
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.login_gate(text) from public, anon, authenticated;
revoke execute on function public.login_record(text, boolean) from public, anon, authenticated;
grant execute on function public.login_gate(text) to service_role;
grant execute on function public.login_record(text, boolean) to service_role;
