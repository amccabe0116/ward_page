-- ---------------------------------------------------------------------------
-- Building cleaning: the Saturdays the ward cleans the building, and who has signed up to help.
-- Run after posts.sql (safe to re-run).
--
--   cleaning_dates     one row per cleaning Saturday. Each one is ALSO a post (post_id) so it
--                      shows in the home-page lineup, the weekly email, the ward calendar and can
--                      get a text reminder like any other event — the Leaders page makes the post
--                      when a date is added and removes it with the date.
--   cleaning_signups   who is helping on which date. Anyone can add a name — their own, or someone
--                      they called and asked (added_by says who put them on).
--   settings           cleaning_time (default 09:00), cleaning_spots (how many helpers a date wants,
--                      default 6), cleaning_location (the building's address for the post)
--
-- Public: cleaning_public() (upcoming dates, names as "First L.") and cleaning_signup(...).
-- Everything else needs the Leaders session.
-- ---------------------------------------------------------------------------
create table if not exists public.cleaning_dates (
  id          bigserial primary key,
  clean_date  date not null unique,
  start_time  time,
  spots       int not null default 6 check (spots between 1 and 40),
  post_id     bigint references public.posts (id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now()
);
create table if not exists public.cleaning_signups (
  id           bigserial primary key,
  cleaning_id  bigint not null references public.cleaning_dates (id) on delete cascade,
  name         text not null,
  phone        text,
  added_by     text,                       -- blank = signed themselves up
  created_at   timestamptz not null default now()
);
create index if not exists cleaning_signups_date on public.cleaning_signups (cleaning_id);
alter table public.cleaning_dates   enable row level security;
alter table public.cleaning_signups enable row level security;
revoke all on public.cleaning_dates   from anon, authenticated;
revoke all on public.cleaning_signups from anon, authenticated;

insert into public.settings (key, value) values
  ('cleaning_time', '09:00'),
  ('cleaning_spots', '6'),
  ('cleaning_location', 'Roswell Stake Center, 500 Norcross Street')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Public
-- ---------------------------------------------------------------------------
-- Upcoming dates (today onward, plus the last two weeks so a just-finished one still shows as
-- done), each with its helpers shown as "First L.".
create or replace function public.cleaning_public()
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'date', d.clean_date, 'time', d.start_time, 'spots', d.spots, 'notes', d.notes, 'post_id', d.post_id,
    'helpers', (select coalesce(jsonb_agg(
        regexp_replace(btrim(s.name), '^(\S+)\s+(\S).*$', '\1 \2.') order by s.created_at), '[]'::jsonb)
      from cleaning_signups s where s.cleaning_id = d.id)
  ) order by d.clean_date), '[]'::jsonb)
  from cleaning_dates d
  where d.clean_date >= (now() at time zone 'America/New_York')::date - 14;
$$;
grant execute on function public.cleaning_public() to anon;

-- Put a name on a date. p_added_by = who is signing them up, when it isn't the person themselves.
create or replace function public.cleaning_signup(p_cleaning_id bigint, p_name text, p_phone text default null, p_added_by text default null, p_website text default '')
returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_name text; v_by text; d record;
begin
  if coalesce(p_website, '') <> '' then return 0; end if;   -- honeypot: pretend it worked
  select * into d from cleaning_dates where id = p_cleaning_id;
  if d is null then raise exception 'That cleaning date is gone'; end if;
  if d.clean_date < (now() at time zone 'America/New_York')::date then raise exception 'That Saturday has already passed'; end if;
  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_by := nullif(regexp_replace(btrim(coalesce(p_added_by, '')), '\s+', ' ', 'g'), '');
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Please enter a name'; end if;
  if length(coalesce(p_phone, '')) > 40 or length(coalesce(v_by, '')) > 80 then raise exception 'Please keep it shorter'; end if;
  if (select count(*) from cleaning_signups where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many sign-ups right now — please try again in a little while';
  end if;
  if exists (select 1 from cleaning_signups where cleaning_id = p_cleaning_id and lower(name) = lower(v_name)) then
    raise exception '% is already on the list for that Saturday', v_name;
  end if;
  insert into cleaning_signups (cleaning_id, name, phone, added_by)
  values (p_cleaning_id, v_name, nullif(btrim(coalesce(p_phone, '')), ''), v_by)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.cleaning_signup(bigint, text, text, text, text) to anon;

-- ---------------------------------------------------------------------------
-- Leaders
-- ---------------------------------------------------------------------------
create or replace function public.admin_cleaning(p_pass text, p_include_past boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'date', d.clean_date, 'time', d.start_time, 'spots', d.spots, 'notes', d.notes, 'post_id', d.post_id, 'created_at', d.created_at,
    'signups', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone, 'added_by', s.added_by, 'created_at', s.created_at) order by s.created_at), '[]'::jsonb)
      from cleaning_signups s where s.cleaning_id = d.id)
  ) order by d.clean_date), '[]'::jsonb)
  from cleaning_dates d
  where p_include_past or d.clean_date >= (now() at time zone 'America/New_York')::date - 14);
end $$;

-- Add (or update) a cleaning Saturday. The Leaders page makes the matching post first and passes its id.
create or replace function public.admin_cleaning_save(p_pass text, p_id bigint, p_date date, p_time time default null, p_spots int default null, p_post_id bigint default null, p_notes text default null)
returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint;
begin
  perform _check_admin(p_pass);
  if p_date is null then raise exception 'Which Saturday?'; end if;
  if p_id is null then
    insert into cleaning_dates (clean_date, start_time, spots, post_id, notes)
    values (p_date, p_time, coalesce(p_spots, 6), p_post_id, nullif(btrim(coalesce(p_notes, '')), ''))
    on conflict (clean_date) do update set start_time = coalesce(excluded.start_time, cleaning_dates.start_time), spots = coalesce(p_spots, cleaning_dates.spots),
      post_id = coalesce(excluded.post_id, cleaning_dates.post_id), notes = coalesce(excluded.notes, cleaning_dates.notes)
    returning id into v_id;
  else
    update cleaning_dates set clean_date = p_date, start_time = p_time, spots = coalesce(p_spots, spots), post_id = coalesce(p_post_id, post_id), notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'not found'; end if;
  end if;
  return v_id;
end $$;

-- Remove a date (its sign-ups go with it). Returns the post id so the page can take the post down too.
create or replace function public.admin_cleaning_delete(p_pass text, p_id bigint)
returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_post bigint;
begin
  perform _check_admin(p_pass);
  delete from cleaning_dates where id = p_id returning post_id into v_post;
  return v_post;
end $$;

create or replace function public.admin_cleaning_signup_delete(p_pass text, p_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  delete from cleaning_signups where id = p_id;
end $$;

grant execute on function public.admin_cleaning(text, boolean)                                    to anon;
grant execute on function public.admin_cleaning_save(text, bigint, date, time, int, bigint, text) to anon;
grant execute on function public.admin_cleaning_delete(text, bigint)                              to anon;
grant execute on function public.admin_cleaning_signup_delete(text, bigint)                       to anon;
