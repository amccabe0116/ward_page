-- ---------------------------------------------------------------------------
-- Missionary meals: members pick a day to take the missionaries out to eat. Two companionships
-- serve the ward — the North Sisters and the South Sisters — and each is fed inside its own area.
-- A brother taking the sisters out brings a sister along. (An Elders row exists, switched off, in
-- case elders are ever assigned to the ward.)
-- Run after schema.sql (safe to re-run).
--
--   missionary_meals   one row per meal: companionship + date, who, their phone, the sister coming
--                      along (when a brother feeds the sisters), notes. One booked meal per
--                      companionship per day.
--   settings           meals_enabled (the switch), meals_days_ahead (how far out people can book,
--                      default 42), and per companionship (elders / north / south):
--                      meals_<key>_on, meals_<key>_label, meals_<key>_area, meals_<key>_phone
--                      (the phone is only ever shown to someone who has just booked a meal)
--
-- Public: meals_public() (what's open) and meals_signup(...). Everything else needs the Leaders session.
-- ---------------------------------------------------------------------------
create table if not exists public.missionary_meals (
  id             bigserial primary key,
  companionship  text not null check (companionship in ('elders', 'north', 'south')),
  meal_date      date not null,
  name           text not null,
  gender         text not null check (gender in ('M', 'F')),
  phone          text not null,
  companion      text,                      -- the sister coming along when a brother feeds the sisters
  notes          text,
  status         text not null default 'booked' check (status in ('booked', 'done', 'cancelled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists missionary_meals_one_per_day on public.missionary_meals (companionship, meal_date) where status = 'booked';
alter table public.missionary_meals enable row level security;
revoke all on public.missionary_meals from anon, authenticated;

insert into public.settings (key, value) values
  ('meals_enabled', 'true'),
  ('meals_days_ahead', '42'),
  ('meals_elders_on', 'false'), ('meals_elders_label', 'Elders'), ('meals_elders_area', 'anywhere in the ward'), ('meals_elders_phone', ''),
  ('meals_north_on', 'true'),  ('meals_north_label', 'North Sisters'), ('meals_north_area', 'the north half of the ward'), ('meals_north_phone', ''),
  ('meals_south_on', 'true'),  ('meals_south_label', 'South Sisters'), ('meals_south_area', 'the south half of the ward'), ('meals_south_phone', '')
on conflict (key) do nothing;
-- no elders serve the ward (Sept 2026) — off even if an earlier run switched the row on
update public.settings set value = 'false' where key = 'meals_elders_on';

-- ---------------------------------------------------------------------------
-- Public
-- ---------------------------------------------------------------------------
-- The switch, how far out, the companionships (label + area, never the phone), and the booked
-- days ahead with the volunteer as "First L.".
create or replace function public.meals_public()
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with s as (select key, value from settings where key like 'meals\_%')
  select jsonb_build_object(
    'enabled', coalesce((select value from s where key = 'meals_enabled'), 'true') = 'true',
    'days_ahead', coalesce((select value from s where key = 'meals_days_ahead'), '42')::int,
    'companionships', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', k, 'label', coalesce((select value from s where key = 'meals_' || k || '_label'), initcap(k)),
        'area', coalesce((select value from s where key = 'meals_' || k || '_area'), ''),
        'sisters', k <> 'elders') order by ord), '[]'::jsonb)
      from (values ('elders', 1), ('north', 2), ('south', 3)) as c(k, ord)
      where coalesce((select value from s where key = 'meals_' || k || '_on'), 'true') = 'true'),
    'booked', (select coalesce(jsonb_agg(jsonb_build_object('companionship', m.companionship, 'date', m.meal_date,
        'who', regexp_replace(btrim(m.name), '^(\S+)\s+(\S).*$', '\1 \2.')) order by m.meal_date), '[]'::jsonb)
      from missionary_meals m where m.status = 'booked' and m.meal_date >= (now() at time zone 'America/New_York')::date)
  );
$$;
grant execute on function public.meals_public() to anon;

-- Book a day. Returns the meal id and that companionship's phone number (to set up time and place).
create or replace function public.meals_signup(p_companionship text, p_date date, p_name text, p_gender text, p_phone text,
  p_companion text default null, p_notes text default null, p_website text default '')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_name text; v_phone text; v_digits text; v_companion text; v_today date; v_ahead int; v_label text;
begin
  if coalesce(p_website, '') <> '' then return jsonb_build_object('id', 0); end if;   -- honeypot: pretend it worked
  if coalesce((select value from settings where key = 'meals_enabled'), 'true') <> 'true' then raise exception 'Meal sign-ups are closed right now'; end if;
  if p_companionship not in ('elders', 'north', 'south') then raise exception 'Pick which missionaries'; end if;
  if coalesce((select value from settings where key = 'meals_' || p_companionship || '_on'), 'true') <> 'true' then raise exception 'Those missionaries aren''t taking meals right now'; end if;
  v_label := coalesce((select value from settings where key = 'meals_' || p_companionship || '_label'), initcap(p_companionship));
  v_today := (now() at time zone 'America/New_York')::date;
  v_ahead := coalesce((select value from settings where key = 'meals_days_ahead'), '42')::int;
  if p_date is null or p_date < v_today then raise exception 'Pick a day that hasn''t passed'; end if;
  if p_date > v_today + v_ahead then raise exception 'You can book up to % days ahead', v_ahead; end if;
  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone := btrim(coalesce(p_phone, ''));
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  v_companion := nullif(regexp_replace(btrim(coalesce(p_companion, '')), '\s+', ' ', 'g'), '');
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Please enter your name'; end if;
  if p_gender not in ('M', 'F') then raise exception 'Brother or sister?'; end if;
  if length(v_digits) < 10 or length(v_phone) > 40 then raise exception 'Please enter a mobile number the missionaries can text'; end if;
  if p_gender = 'M' and p_companionship <> 'elders' and v_companion is null then
    raise exception 'A brother taking the % out needs a sister along — please add her name', v_label;
  end if;
  if length(coalesce(v_companion, '')) > 80 or length(coalesce(p_notes, '')) > 600 then raise exception 'Please keep it shorter'; end if;
  if (select count(*) from missionary_meals where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many sign-ups right now — please try again in a little while';
  end if;
  if exists (select 1 from missionary_meals where companionship = p_companionship and meal_date = p_date and status = 'booked') then
    raise exception 'Someone already has the % that day — pick another day', v_label;
  end if;
  insert into missionary_meals (companionship, meal_date, name, gender, phone, companion, notes)
  values (p_companionship, p_date, v_name, p_gender, v_phone, v_companion, nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'label', v_label, 'phone', coalesce((select value from settings where key = 'meals_' || p_companionship || '_phone'), ''));
end $$;
grant execute on function public.meals_signup(text, date, text, text, text, text, text, text) to anon;

-- ---------------------------------------------------------------------------
-- Leaders
-- ---------------------------------------------------------------------------
create or replace function public.admin_meals(p_pass text, p_include_past boolean default false)
returns setof public.missionary_meals
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query select * from missionary_meals m
    where p_include_past or m.meal_date >= (now() at time zone 'America/New_York')::date - 7
    order by m.meal_date, m.companionship;
end $$;

create or replace function public.admin_meal_status(p_pass text, p_id bigint, p_status text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  if p_status not in ('booked', 'done', 'cancelled') then raise exception 'bad status'; end if;
  update missionary_meals set status = p_status, updated_at = now() where id = p_id;
  if not found then raise exception 'not found'; end if;
end $$;

create or replace function public.admin_meal_delete(p_pass text, p_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  delete from missionary_meals where id = p_id;
end $$;

grant execute on function public.admin_meals(text, boolean)             to anon;
grant execute on function public.admin_meal_status(text, bigint, text)  to anon;
grant execute on function public.admin_meal_delete(text, bigint)        to anon;
