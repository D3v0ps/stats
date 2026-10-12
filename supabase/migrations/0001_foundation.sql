-- MB Stats foundation: schemas, default privileges, pure helpers and the app-user allowlist.
--
-- Conventions for every migration:
-- * public holds app tables and the RPCs PostgREST exposes; private holds helpers.
-- * Every function sets search_path = '' and uses fully qualified names.
-- * Every public table has RLS enabled in the migration that creates it.
-- * anon never gets table or function privileges.

create schema if not exists private;
revoke all on schema private from public;
-- Policies and SECURITY INVOKER RPCs call private helpers as the caller.
grant usage on schema private to authenticated, service_role;

-- Supabase grants new public objects to anon/authenticated by default. Remove anon
-- entirely; authenticated gets explicit grants table by table. EXECUTE for PUBLIC on
-- functions is a global default that per-schema rules cannot remove, so every
-- migration that creates functions revokes it explicitly at the end.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------------------
-- Pure helpers
-- ---------------------------------------------------------------------------

-- Canonical key for dimension values and aliases. Mirrors normalizeValue() in
-- src/lib/core/normalize.ts: NFC, zero-width characters removed, every JS \s
-- whitespace run collapsed to one space, trimmed, lowercased.
create or replace function private.normalize_label(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(
    btrim(
      regexp_replace(
        regexp_replace(normalize(p_text, NFC), '[\u200b-\u200d\u2060]', '', 'g'),
        '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+',
        ' ',
        'g'
      ),
      ' '
    )
  )
$$;

-- dimension_values.code for a label. kostnadsstalle codes are scoped per company
-- ("MBAB:100"); the company prefix is kept uppercase so codes match SIE staging.
create or replace function private.dimension_code(p_dimension_key text, p_label text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_norm text := private.normalize_label(p_label);
begin
  if p_dimension_key = 'kostnadsstalle' and v_norm ~ '^[a-z]+:' then
    return upper(split_part(v_norm, ':', 1)) || substr(v_norm, strpos(v_norm, ':'));
  end if;
  return v_norm;
end;
$$;

-- True when the text contains a Swedish personnummer or samordningsnummer:
-- YYMMDD[sep]NNNN or YYYYMMDD[sep]NNNN, where sep is "-", "+", a space, a no-break space
-- or a narrow no-break space, or nothing; the date exists (day + 60 for
-- samordningsnummer) and the last ten digits pass Luhn. Mirrors isPersonnummer() in
-- src/lib/core/pnr.ts. Organisation numbers have month digits >= 20 and never match.
create or replace function private.contains_personnummer(p_text text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_match text[];
  v_date text;
  v_digits text;
  v_century int;
  v_yy int;
  v_mm int;
  v_dd int;
  v_years int[];
  v_year int;
  v_valid_date boolean;
  v_sum int;
  v_d int;
  i int;
begin
  if p_text is null or p_text !~ '[0-9]{6}' then
    return false;
  end if;
  for v_match in
    select m from regexp_matches(p_text, '(?<![0-9])([0-9]{6}|[0-9]{8})[-+ \u00a0\u202f]?([0-9]{4})(?![0-9])', 'g') as m
  loop
    v_date := v_match[1];
    if length(v_date) = 8 then
      v_century := substr(v_date, 1, 2)::int;
      if v_century not in (18, 19, 20) then
        continue;
      end if;
      v_date := substr(v_date, 3);
      v_years := array[v_century * 100 + substr(v_date, 1, 2)::int];
    else
      v_yy := substr(v_date, 1, 2)::int;
      v_years := array[1900 + v_yy, 2000 + v_yy];
    end if;
    v_mm := substr(v_date, 3, 2)::int;
    v_dd := substr(v_date, 5, 2)::int;
    if v_dd > 60 then
      v_dd := v_dd - 60;
    end if;
    if v_mm < 1 or v_mm > 12 or v_dd < 1 then
      continue;
    end if;
    v_valid_date := false;
    foreach v_year in array v_years loop
      if v_dd <= extract(day from (make_date(v_year, v_mm, 1) + interval '1 month - 1 day'))::int then
        v_valid_date := true;
      end if;
    end loop;
    if not v_valid_date then
      continue;
    end if;
    v_digits := v_date || v_match[2];
    v_sum := 0;
    for i in 1..10 loop
      v_d := substr(v_digits, i, 1)::int;
      if i % 2 = 1 then
        v_d := v_d * 2;
        if v_d > 9 then
          v_d := v_d - 9;
        end if;
      end if;
      v_sum := v_sum + v_d;
    end loop;
    if v_sum % 10 = 0 then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Trigger: reject rows whose listed text columns contain a personnummer. The error
-- never echoes the value (no personal data in logs). Trigger functions that call
-- private helpers are SECURITY DEFINER so callers need no grants on the helpers.
create or replace function private.reject_personnummer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if private.contains_personnummer(v_row ->> v_col) then
      raise exception 'Personnummer får inte sparas (%.%)', tg_table_name, v_col
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

-- Trigger: keep updated_at current.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Allowlist
-- ---------------------------------------------------------------------------

create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_users enable row level security;
revoke all on public.app_users from anon, authenticated;

-- True when the caller's JWT subject is allowlisted. SECURITY DEFINER so policies on
-- app_users itself do not recurse.
create or replace function private.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_users au where au.user_id = (select auth.uid()))
$$;

-- Raise unless the caller is allowlisted. First statement of every app RPC.
create or replace function private.assert_app_user()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.is_app_user() then
    raise exception 'Behörighet saknas' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

grant select on public.app_users to authenticated;
create policy "app users read the allowlist" on public.app_users
  for select to authenticated using ((select private.is_app_user()));

revoke execute on all functions in schema private from public;
grant execute on function private.is_app_user() to authenticated;
grant execute on function private.assert_app_user() to authenticated;
grant execute on function private.normalize_label(text) to authenticated;
grant execute on function private.dimension_code(text, text) to authenticated;
