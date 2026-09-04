-- North Point YSA — roll / attendance schema
-- Paste this whole file into the Supabase SQL editor of the *northpointysa* project and run it once.
-- Safe to re-run: everything is CREATE ... IF NOT EXISTS / CREATE OR REPLACE.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  id                 uuid primary key default gen_random_uuid(),
  lcr_uuid           uuid unique,            -- LCR person uuid (used when pushing attendance back)
  lcr_classes        jsonb not null default '[]'::jsonb, -- [{"orgName","classUuid","orgTypeId"}] from LCR
  name               text not null,          -- as LCR shows it: "Last, First Middle"
  display_name       text not null,          -- "First Last" for the roll
  sex                text check (sex in ('M','F')),
  org                text check (org in ('EQ','RS')),  -- Elders Quorum / Relief Society
  age                int,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists members_active_name_idx on public.members (active, display_name);

create table if not exists public.attendance (
  id             bigserial primary key,
  meeting_date   date not null,
  class          text not null check (class in ('sunday_school','priesthood_rs')),
  member_id      uuid not null references public.members(id) on delete cascade,
  created_at     timestamptz not null default now(),
  synced_to_lcr_at timestamptz,
  unique (meeting_date, class, member_id)
);
create index if not exists attendance_date_class_idx on public.attendance (meeting_date, class);

create table if not exists public.settings (
  key    text primary key,
  value  text not null
);

-- ---------------------------------------------------------------------------
-- Row Level Security: the anon key can do nothing directly. All access goes
-- through the functions below (SECURITY DEFINER), which decide what is allowed.
-- ---------------------------------------------------------------------------
alter table public.members    enable row level security;
alter table public.attendance enable row level security;
alter table public.settings   enable row level security;
revoke all on public.members, public.attendance, public.settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._check_admin(p_pass text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select value into v_hash from settings where key = 'admin_passphrase_hash';
  if v_hash is null or p_pass is null or crypt(p_pass, v_hash) <> v_hash then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- Most recent Sunday (America/New_York), or today if today is Sunday.
create or replace function public.current_meeting_date() returns date
language sql stable as $$
  select (
    (now() at time zone 'America/New_York')::date
    - extract(dow from (now() at time zone 'America/New_York'))::int
  )::date
$$;

-- ---------------------------------------------------------------------------
-- Public (anon) functions used by the roll pages
-- ---------------------------------------------------------------------------

-- Active members for the roll. Only the fields the page needs.
create or replace function public.roll_members()
returns table (id uuid, display_name text, org text)
language sql stable security definer set search_path = public, extensions as $$
  select id, display_name, org
  from members
  where active
  order by lower(name)
$$;

-- Who is already checked in for a given meeting/class (ids only).
create or replace function public.checked_in(p_date date, p_class text)
returns setof uuid
language sql stable security definer set search_path = public, extensions as $$
  select member_id from attendance where meeting_date = p_date and class = p_class
$$;

-- Check in one or more members. Only allows dates within the last 8 days
-- (so a stale phone can't write to a random week). Duplicates are ignored.
create or replace function public.check_in(p_date date, p_class text, p_member_ids uuid[])
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_count int;
begin
  if p_class not in ('sunday_school','priesthood_rs') then
    raise exception 'bad class';
  end if;
  if p_date > (now() at time zone 'America/New_York')::date + 1
     or p_date < (now() at time zone 'America/New_York')::date - 8 then
    raise exception 'date out of range';
  end if;
  insert into attendance (meeting_date, class, member_id)
  select p_date, p_class, m.id
  from members m
  where m.id = any(p_member_ids) and m.active
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Undo a check-in (someone tapped the wrong name).
create or replace function public.check_out(p_date date, p_class text, p_member_id uuid)
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_count int;
begin
  delete from attendance
  where meeting_date = p_date and class = p_class and member_id = p_member_id
    and created_at > now() - interval '3 hours';   -- only recent mistakes
  get diagnostics v_count = row_count;
  return v_count;
end $$;

grant execute on function public.roll_members()                    to anon;
grant execute on function public.checked_in(date, text)            to anon;
grant execute on function public.check_in(date, text, uuid[])      to anon;
grant execute on function public.check_out(date, text, uuid)       to anon;
grant execute on function public.current_meeting_date()            to anon;

-- ---------------------------------------------------------------------------
-- Admin functions (passphrase-gated). Used by admin.html and the LCR sync.
-- ---------------------------------------------------------------------------

-- Set / change the admin passphrase. Run this once from the SQL editor:
--   select set_admin_passphrase('CHOOSE-A-PASSPHRASE');
-- (Only callable from the SQL editor / service role — not granted to anon.)
create or replace function public.set_admin_passphrase(p_pass text) returns void
language sql security definer set search_path = public, extensions as $$
  insert into settings (key, value)
  values ('admin_passphrase_hash', crypt(p_pass, gen_salt('bf')))
  on conflict (key) do update set value = excluded.value
$$;
revoke execute on function public.set_admin_passphrase(text) from anon, authenticated, public;

-- Attendance for one Sunday, with names, for both classes.
create or replace function public.admin_attendance(p_pass text, p_date date)
returns table (
  attendance_id bigint, class text, member_id uuid, display_name text, name text,
  org text, lcr_uuid uuid, lcr_classes jsonb, created_at timestamptz, synced_to_lcr_at timestamptz
)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query
    select a.id, a.class, m.id, m.display_name, m.name, m.org, m.lcr_uuid, m.lcr_classes,
           a.created_at, a.synced_to_lcr_at
    from attendance a join members m on m.id = a.member_id
    where a.meeting_date = p_date
    order by a.class, lower(m.display_name);
end $$;

-- Sundays that have any attendance, newest first (for the admin date picker).
create or replace function public.admin_meeting_dates(p_pass text)
returns table (meeting_date date, sunday_school int, priesthood_rs int)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query
    select a.meeting_date,
           count(*) filter (where a.class = 'sunday_school')::int,
           count(*) filter (where a.class = 'priesthood_rs')::int
    from attendance a
    group by a.meeting_date
    order by a.meeting_date desc
    limit 52;
end $$;

-- Full member list for the admin page.
create or replace function public.admin_members(p_pass text)
returns setof public.members
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query select * from members order by active desc, lower(name);
end $$;

-- Import / refresh members from LCR. p_members is a JSON array of objects:
--   { "lcr_uuid": "…", "name": "Last, First", "display_name": "First Last",
--     "sex": "M"|"F", "org": "EQ"|"RS", "age": 24,
--     "lcr_classes": [{"orgName":"Adult Sunday School","classUuid":"…","orgTypeId":1255}, …] }
-- Existing rows are matched on lcr_uuid (fallback: exact name).
-- If p_deactivate_missing is true, members not in the list are marked inactive.
create or replace function public.admin_upsert_members(p_pass text, p_members jsonb, p_deactivate_missing boolean default true)
returns table (inserted int, updated int, deactivated int)
language plpgsql security definer set search_path = public, extensions as $$
declare v_ins int := 0; v_upd int := 0; v_deact int := 0; r record;
begin
  perform _check_admin(p_pass);
  create temp table _incoming on commit drop as
    select (x->>'lcr_uuid')::uuid as lcr_uuid,
           coalesce(x->'lcr_classes', '[]'::jsonb) as lcr_classes,
           x->>'name' as name,
           coalesce(x->>'display_name', x->>'name') as display_name,
           x->>'sex' as sex,
           x->>'org' as org,
           (x->>'age')::int as age
    from jsonb_array_elements(p_members) x;

  for r in select * from _incoming loop
    update members m set
      lcr_classes = case when jsonb_array_length(r.lcr_classes) > 0 then r.lcr_classes else m.lcr_classes end,
      name = r.name, display_name = r.display_name,
      sex = coalesce(r.sex, m.sex), org = coalesce(r.org, m.org), age = coalesce(r.age, m.age),
      active = true, updated_at = now()
    where (r.lcr_uuid is not null and m.lcr_uuid = r.lcr_uuid)
       or (r.lcr_uuid is null and m.name = r.name);
    if found then
      v_upd := v_upd + 1;
    else
      insert into members (lcr_uuid, lcr_classes, name, display_name, sex, org, age)
      values (r.lcr_uuid, r.lcr_classes, r.name, r.display_name, r.sex, r.org, r.age);
      v_ins := v_ins + 1;
    end if;
  end loop;

  if p_deactivate_missing then
    update members m set active = false, updated_at = now()
    where m.active
      and not exists (
        select 1 from _incoming i
        where (i.lcr_uuid is not null and i.lcr_uuid = m.lcr_uuid)
           or (i.lcr_uuid is null and i.name = m.name));
    get diagnostics v_deact = row_count;
  end if;

  return query select v_ins, v_upd, v_deact;
end $$;

-- Mark attendance rows as pushed to LCR.
create or replace function public.admin_mark_synced(p_pass text, p_attendance_ids bigint[])
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v int;
begin
  perform _check_admin(p_pass);
  update attendance set synced_to_lcr_at = now() where id = any(p_attendance_ids);
  get diagnostics v = row_count;
  return v;
end $$;

-- Manually toggle a member active/inactive (moved out, etc.).
create or replace function public.admin_set_member_active(p_pass text, p_member_id uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  update members set active = p_active, updated_at = now() where id = p_member_id;
end $$;

-- Admin-side check-in/out (fixing the roll after the fact, any date).
create or replace function public.admin_set_attendance(p_pass text, p_date date, p_class text, p_member_id uuid, p_present boolean)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  if p_present then
    insert into attendance (meeting_date, class, member_id) values (p_date, p_class, p_member_id)
    on conflict do nothing;
  else
    delete from attendance where meeting_date = p_date and class = p_class and member_id = p_member_id;
  end if;
end $$;

grant execute on function public.admin_attendance(text, date)                         to anon;
grant execute on function public.admin_meeting_dates(text)                            to anon;
grant execute on function public.admin_members(text)                                  to anon;
grant execute on function public.admin_upsert_members(text, jsonb, boolean)           to anon;
grant execute on function public.admin_mark_synced(text, bigint[])                    to anon;
grant execute on function public.admin_set_member_active(text, uuid, boolean)         to anon;
grant execute on function public.admin_set_attendance(text, date, text, uuid, boolean) to anon;

-- ---------------------------------------------------------------------------
-- After running: set the admin passphrase (pick your own):
--   select set_admin_passphrase('replace-me');
-- ---------------------------------------------------------------------------
-- Guests / visitors who are not on the LCR roll: they type their name on the roll page.
-- Paste into the Supabase SQL editor and run once (safe to re-run).

create table if not exists public.attendance_guests (
  id             bigserial primary key,
  meeting_date   date not null,
  class          text not null check (class in ('sunday_school','priesthood_rs')),
  name           text not null,
  created_at     timestamptz not null default now(),
  synced_to_lcr_at timestamptz
);
create unique index if not exists attendance_guests_unique_idx
  on public.attendance_guests (meeting_date, class, lower(name));
alter table public.attendance_guests enable row level security;
revoke all on public.attendance_guests from anon, authenticated;

-- Public: a guest checks in by typing a name (2–60 chars, letters/spaces/'-. only).
create or replace function public.check_in_guest(p_date date, p_class text, p_name text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_name text;
begin
  if p_class not in ('sunday_school','priesthood_rs') then raise exception 'bad class'; end if;
  if to_regproc('public._window_open(text)') is not null then
    if not _window_open(p_class) then raise exception 'Check-in is closed right now' using errcode = 'P0001'; end if;
  end if;
  if p_date > (now() at time zone 'America/New_York')::date + 1
     or p_date < (now() at time zone 'America/New_York')::date - 8 then
    raise exception 'date out of range';
  end if;
  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if length(v_name) < 2 or length(v_name) > 60 or v_name !~ '^[[:alpha:]][[:alpha:] ''.-]*$' then
    raise exception 'Please enter a first and last name';
  end if;
  insert into attendance_guests (meeting_date, class, name) values (p_date, p_class, v_name)
  on conflict do nothing;
  return v_name;
end $$;

-- Public: guest names already checked in for a meeting/class.
create or replace function public.guests_checked_in(p_date date, p_class text)
returns setof text
language sql stable security definer set search_path = public, extensions as $$
  select name from attendance_guests where meeting_date = p_date and class = p_class order by lower(name)
$$;

grant execute on function public.check_in_guest(date, text, text) to anon;
grant execute on function public.guests_checked_in(date, text)   to anon;

-- Admin: guests for a Sunday.
create or replace function public.admin_guests(p_pass text, p_date date)
returns table (guest_id bigint, class text, name text, created_at timestamptz, synced_to_lcr_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query select g.id, g.class, g.name, g.created_at, g.synced_to_lcr_at
    from attendance_guests g where g.meeting_date = p_date order by g.class, lower(g.name);
end $$;

create or replace function public.admin_remove_guest(p_pass text, p_guest_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  delete from attendance_guests where id = p_guest_id;
end $$;

create or replace function public.admin_mark_guests_synced(p_pass text, p_guest_ids bigint[])
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v int;
begin
  perform _check_admin(p_pass);
  update attendance_guests set synced_to_lcr_at = now() where id = any(p_guest_ids);
  get diagnostics v = row_count;
  return v;
end $$;

grant execute on function public.admin_guests(text, date)                 to anon;
grant execute on function public.admin_remove_guest(text, bigint)         to anon;
grant execute on function public.admin_mark_guests_synced(text, bigint[]) to anon;

-- Sundays list should count guests too.
create or replace function public.admin_meeting_dates(p_pass text)
returns table (meeting_date date, sunday_school int, priesthood_rs int)
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query
    with x as (
      select a.meeting_date, a.class from attendance a
      union all
      select g.meeting_date, g.class from attendance_guests g
    )
    select x.meeting_date,
           count(*) filter (where x.class = 'sunday_school')::int,
           count(*) filter (where x.class = 'priesthood_rs')::int
    from x group by x.meeting_date order by x.meeting_date desc limit 52;
end $$;
-- Check-in time windows (America/New_York). Sunday School 12:50–2:30 PM, Priesthood/RS 1:20–2:30 PM.
-- Paste into the Supabase SQL editor and run once (safe to re-run).

insert into public.settings (key, value) values
  ('window_sunday_school', '12:50-14:30'),
  ('window_priesthood_rs', '13:20-14:30'),
  ('window_day', '0'),                 -- 0 = Sunday
  ('roll_enforce_window', 'true')      -- set to 'false' to allow check-in any time (testing)
on conflict (key) do nothing;

-- Public: the windows, so the site can grey the buttons out without a reload.
create or replace function public.roll_windows()
returns table (class text, start_time text, end_time text, day_of_week int, enforced boolean)
language sql stable security definer set search_path = public, extensions as $$
  select c.class,
         split_part(s.value, '-', 1), split_part(s.value, '-', 2),
         coalesce((select value from settings where key = 'window_day'), '0')::int,
         coalesce((select value from settings where key = 'roll_enforce_window'), 'true') = 'true'
  from (values ('sunday_school'), ('priesthood_rs')) as c(class)
  join settings s on s.key = 'window_' || c.class
$$;
grant execute on function public.roll_windows() to anon;

-- Is the window for p_class open right now (ET)? Always true when enforcement is off.
create or replace function public._window_open(p_class text) returns boolean
language plpgsql stable security definer set search_path = public, extensions as $$
declare v text; v_day int; v_now timestamp; v_t time;
begin
  if coalesce((select value from settings where key = 'roll_enforce_window'), 'true') <> 'true' then return true; end if;
  select value into v from settings where key = 'window_' || p_class;
  if v is null then return true; end if;
  v_day := coalesce((select value from settings where key = 'window_day'), '0')::int;
  v_now := now() at time zone 'America/New_York';
  v_t := v_now::time;
  return extract(dow from v_now)::int = v_day
     and v_t >= split_part(v, '-', 1)::time
     and v_t <  split_part(v, '-', 2)::time;
end $$;

create or replace function public.check_in(p_date date, p_class text, p_member_ids uuid[])
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_count int;
begin
  if p_class not in ('sunday_school','priesthood_rs') then raise exception 'bad class'; end if;
  if not _window_open(p_class) then raise exception 'Check-in is closed right now' using errcode = 'P0001'; end if;
  if p_date > (now() at time zone 'America/New_York')::date + 1
     or p_date < (now() at time zone 'America/New_York')::date - 8 then
    raise exception 'date out of range';
  end if;
  insert into attendance (meeting_date, class, member_id)
  select p_date, p_class, m.id from members m where m.id = any(p_member_ids) and m.active
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.check_in_guest(p_date date, p_class text, p_name text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_name text;
begin
  if p_class not in ('sunday_school','priesthood_rs') then raise exception 'bad class'; end if;
  if not _window_open(p_class) then raise exception 'Check-in is closed right now' using errcode = 'P0001'; end if;
  if p_date > (now() at time zone 'America/New_York')::date + 1
     or p_date < (now() at time zone 'America/New_York')::date - 8 then
    raise exception 'date out of range';
  end if;
  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if length(v_name) < 2 or length(v_name) > 60 or v_name !~ '^[[:alpha:]][[:alpha:] ''.-]*$' then
    raise exception 'Please enter a first and last name';
  end if;
  insert into attendance_guests (meeting_date, class, name) values (p_date, p_class, v_name)
  on conflict do nothing;
  return v_name;
end $$;

-- Admin: read / change settings from the Leaders page.
create or replace function public.admin_get_settings(p_pass text)
returns setof public.settings
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query select * from settings where key <> 'admin_passphrase_hash' order by key;
end $$;

create or replace function public.admin_set_setting(p_pass text, p_key text, p_value text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  if p_key = 'admin_passphrase_hash' then raise exception 'not allowed'; end if;
  if p_key like 'window_%' and p_key <> 'window_day' and p_value !~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}$' then
    raise exception 'window must look like 12:50-14:30';
  end if;
  insert into settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
end $$;

grant execute on function public.admin_get_settings(text)              to anon;
grant execute on function public.admin_set_setting(text, text, text)    to anon;
