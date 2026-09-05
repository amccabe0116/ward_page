-- Private notes to ward leadership (housing / jobs) + hardened Leaders login.
-- Paste into the Supabase SQL editor and run once (safe to re-run).

-- ---------------------------------------------------------------------------
-- 1. Leaders login: short-lived session tokens + brute-force lockout
-- ---------------------------------------------------------------------------
create table if not exists public.admin_sessions (
  token       text primary key,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  label       text
);
alter table public.admin_sessions enable row level security;
revoke all on public.admin_sessions from anon, authenticated;

-- Accepts either an active session token or the passphrase itself (the sync scripts use the
-- passphrase). Wrong passphrase costs 1 s and is refused entirely while locked out.
create or replace function public._check_admin(p_pass text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_fail int; v_at timestamptz;
begin
  if p_pass is null or length(p_pass) < 4 then raise exception 'not authorized' using errcode = '42501'; end if;
  if exists (select 1 from admin_sessions where token = p_pass and expires_at > now()) then return; end if;
  select coalesce((select value from settings where key = 'admin_fail_count'), '0')::int,
         (select value from settings where key = 'admin_fail_at')::timestamptz
    into v_fail, v_at;
  if v_fail >= 10 and v_at is not null and v_at > now() - interval '15 minutes' then
    raise exception 'Too many failed attempts — try again in 15 minutes' using errcode = '42501';
  end if;
  select value into v_hash from settings where key = 'admin_passphrase_hash';
  if v_hash is null or crypt(p_pass, v_hash) <> v_hash then
    perform pg_sleep(1);
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- Login: returns {ok, token} or {ok:false, error}. Failures are counted here (this function never
-- raises, so the count commits) and the lockout applies to every admin function.
create or replace function public.admin_login(p_pass text, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_fail int; v_at timestamptz; v_token text;
begin
  delete from admin_sessions where expires_at < now();
  select coalesce((select value from settings where key = 'admin_fail_count'), '0')::int,
         (select value from settings where key = 'admin_fail_at')::timestamptz
    into v_fail, v_at;
  if v_at is not null and v_at < now() - interval '15 minutes' then v_fail := 0; end if;
  if v_fail >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many failed attempts — try again in 15 minutes');
  end if;
  select value into v_hash from settings where key = 'admin_passphrase_hash';
  if v_hash is null or p_pass is null or crypt(p_pass, v_hash) <> v_hash then
    insert into settings (key, value) values ('admin_fail_count', (v_fail + 1)::text)
      on conflict (key) do update set value = excluded.value;
    insert into settings (key, value) values ('admin_fail_at', now()::text)
      on conflict (key) do update set value = excluded.value;
    perform pg_sleep(1);
    return jsonb_build_object('ok', false, 'error', 'Wrong passphrase', 'attempts_left', 10 - (v_fail + 1));
  end if;
  insert into settings (key, value) values ('admin_fail_count', '0') on conflict (key) do update set value = '0';
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into admin_sessions (token, expires_at, label) values (v_token, now() + interval '12 hours', left(p_label, 80));
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_in_hours', 12);
end $$;

create or replace function public.admin_logout(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from admin_sessions where token = p_token
$$;

-- Passphrase hashing: stronger cost from now on (re-run set_admin_passphrase to upgrade).
create or replace function public.set_admin_passphrase(p_pass text) returns void
language sql security definer set search_path = public, extensions as $$
  insert into settings (key, value)
  values ('admin_passphrase_hash', crypt(p_pass, gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value
$$;
revoke execute on function public.set_admin_passphrase(text) from anon, authenticated, public;

grant execute on function public.admin_login(text, text) to anon;
grant execute on function public.admin_logout(text)      to anon;

-- Settings the Leaders page may read: hide the internal ones too.
create or replace function public.admin_get_settings(p_pass text)
returns setof public.settings
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query select * from settings where key not in ('admin_passphrase_hash','admin_fail_count','admin_fail_at') order by key;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Notes to leadership
-- ---------------------------------------------------------------------------
create table if not exists public.leader_notes (
  id          bigserial primary key,
  topic       text not null check (topic in ('housing','jobs')),
  kind        text not null check (kind in ('have','need')),
  message     text not null,
  name        text,
  contact     text,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  text
);
alter table public.leader_notes enable row level security;
revoke all on public.leader_notes from anon, authenticated;

-- Public: submit a note. Basic validation + a global cap of 30 notes/hour against spam.
create or replace function public.submit_note(p_topic text, p_kind text, p_message text, p_name text default null, p_contact text default null)
returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_msg text;
begin
  if p_topic not in ('housing','jobs') or p_kind not in ('have','need') then raise exception 'bad request'; end if;
  v_msg := btrim(coalesce(p_message, ''));
  if length(v_msg) < 5 then raise exception 'Please write a few words so leadership knows how to help'; end if;
  if length(v_msg) > 2000 then raise exception 'Please keep the note under 2000 characters'; end if;
  if length(coalesce(p_name, '')) > 80 or length(coalesce(p_contact, '')) > 120 then raise exception 'Name or contact is too long'; end if;
  if (select count(*) from leader_notes where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many notes right now — please try again in a little while';
  end if;
  insert into leader_notes (topic, kind, message, name, contact)
  values (p_topic, p_kind, v_msg, nullif(btrim(coalesce(p_name, '')), ''), nullif(btrim(coalesce(p_contact, '')), ''))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.submit_note(text, text, text, text, text) to anon;

create or replace function public.admin_notes(p_pass text, p_include_handled boolean default false)
returns setof public.leader_notes
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query select * from leader_notes n
    where p_include_handled or n.handled_at is null
    order by n.handled_at is not null, n.created_at desc;
end $$;

create or replace function public.admin_note_handled(p_pass text, p_id bigint, p_handled boolean, p_by text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  update leader_notes set handled_at = case when p_handled then now() end, handled_by = case when p_handled then left(p_by, 80) end where id = p_id;
end $$;

create or replace function public.admin_note_delete(p_pass text, p_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  delete from leader_notes where id = p_id;
end $$;

create or replace function public.admin_notes_count(p_pass text)
returns int
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return (select count(*) from leader_notes where handled_at is null)::int;
end $$;

grant execute on function public.admin_notes(text, boolean)                     to anon;
grant execute on function public.admin_note_handled(text, bigint, boolean, text) to anon;
grant execute on function public.admin_note_delete(text, bigint)                to anon;
grant execute on function public.admin_notes_count(text)                        to anon;
