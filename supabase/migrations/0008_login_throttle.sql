-- Login throttle. login_gate/login_record live in public so PostgREST can reach them,
-- but only service_role may execute them (src/lib/db/admin.ts).
--
-- The gate is atomic: under a per-ip_hash advisory lock it decides and, when it lets an
-- attempt through, inserts that attempt as pending (ok null). A pending attempt counts
-- as a failure until login_record(attempt_id, ok) finalizes it, so a burst of parallel
-- requests cannot all pass the gate before the first of them is recorded: the sixth
-- gate of a burst already sees five failures. An attempt that is never finalized (the
-- server died, Auth was unreachable) stays a failure, which fails closed.
--
-- Rules:
-- * per ip_hash: 5 failures within 15 minutes lock that hash for 15 minutes, doubling
--   with every further lockout in the last 24 hours (cap 24 hours); a successful login
--   resets the history;
-- * more than 50 failures in the last hour across all hashes add delay_ms (up to
--   3000) for everyone, never a hard global lock;
-- * attempts older than 24 hours are deleted opportunistically.
-- ip_hash must look like a hash (no dots or colons), so a raw IP is never stored.

grant select, insert, update, delete on private.login_attempts to service_role;

-- Lock state of one ip_hash at p_now. Failed and pending attempts after the last success
-- (within 24 hours) are replayed in order; attempts made while locked do not count.
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
      and a.ok is not true
      and a.at > coalesce(greatest(v_since, v_last_ok), v_since)
      and a.at <= p_now
    order by a.at
  loop
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

-- Decide on one login attempt and, when allowed, register it as pending.
-- Returns {allowed, retry_after_s, delay_ms, attempt_id}; attempt_id is null when the
-- attempt is refused (nothing is registered for a refused attempt).
create or replace function public.login_gate(p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_until timestamptz;
  v_failures bigint;
  v_delay integer := 0;
  v_attempt uuid;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[A-Za-z0-9+/=_-]{16,128}$' then
    raise exception 'Ogiltig ip-hash' using errcode = 'invalid_parameter_value';
  end if;

  -- One gate per ip_hash at a time; the lock is held until this transaction commits, so
  -- the next gate for the hash sees the pending attempt inserted here.
  perform pg_advisory_xact_lock(hashtext('login:' || p_ip_hash));
  -- Taken after the lock: now() is the transaction start, which can predate an attempt
  -- committed by a gate that held the lock while this one waited.
  v_now := clock_timestamp();

  select st.locked_until into v_until from private.login_lock_state(p_ip_hash, v_now) st;

  select count(*) into v_failures
  from private.login_attempts a
  where a.ok is not true and a.at > v_now - interval '1 hour';
  if v_failures > 50 then
    v_delay := least(3000, 1000 + (v_failures - 51) * 50)::integer;
  end if;

  delete from private.login_attempts a where a.at < v_now - interval '24 hours';

  if v_until is not null and v_until > v_now then
    return jsonb_build_object(
      'allowed', false,
      'retry_after_s', ceil(extract(epoch from v_until - v_now))::integer,
      'delay_ms', v_delay,
      'attempt_id', null
    );
  end if;

  insert into private.login_attempts (ip_hash, at, ok)
  values (p_ip_hash, v_now, null)
  returning id into v_attempt;
  return jsonb_build_object(
    'allowed', true,
    'retry_after_s', 0,
    'delay_ms', v_delay,
    'attempt_id', v_attempt
  );
end;
$$;

-- Finalize a pending attempt with the answer from Auth (true = signed in).
create or replace function public.login_record(p_attempt_id uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attempt_id is null then
    raise exception 'Inloggningsförsök saknas' using errcode = 'invalid_parameter_value';
  end if;
  if p_ok is null then
    raise exception 'Utfall saknas' using errcode = 'invalid_parameter_value';
  end if;
  update private.login_attempts a set ok = p_ok where a.id = p_attempt_id and a.ok is null;
  if not found then
    raise exception 'Inloggningsförsöket finns inte eller är redan avslutat'
      using errcode = 'no_data_found';
  end if;
end;
$$;

revoke execute on all functions in schema private from public;
revoke execute on function public.login_gate(text) from public, anon, authenticated;
revoke execute on function public.login_record(uuid, boolean) from public, anon, authenticated;
grant execute on function public.login_gate(text) to service_role;
grant execute on function public.login_record(uuid, boolean) to service_role;
