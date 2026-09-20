-- ---------------------------------------------------------------------------
-- Dinner with the missionaries ("get to know you"): people sign up, leaders pair each one with a
-- random person of the other gender close in age, the two plan a meal out with the missionaries.
-- Run once after schema.sql (safe to re-run).
--
--   dinner_signups   one row per sign-up (waiting → paired → done, or withdrawn)
--   dinner_pairs     a match: proposed → notified (intro texts sent) → scheduled → done, or cancelled
--   settings         dinner_enabled ('true'/'false' — the switch), dinner_age_gap (years, default 3),
--                    dinner_missionary_contact (goes into the intro text), dinner_intro_sms (wording)
--
-- Public key: dinner_status() (is it on?) and dinner_signup(...) (refused while off). Everything
-- else needs the Leaders session. Pairing itself happens on the Leaders page; the database only
-- checks that a pair is one man + one woman who are both waiting.
-- ---------------------------------------------------------------------------
create table if not exists public.dinner_signups (
  id            bigserial primary key,
  name          text not null,
  gender        text not null check (gender in ('M', 'F')),
  age           int  not null check (age between 18 and 45),
  phone         text not null,
  email         text,
  availability  text,                       -- "weeknights after 7, most Saturdays"
  notes         text,                       -- anything the missionaries / their match should know
  status        text not null default 'waiting' check (status in ('waiting', 'paired', 'done', 'withdrawn')),
  times_paired  int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.dinner_pairs (
  id            bigserial primary key,
  a_id          bigint not null references public.dinner_signups (id) on delete cascade,
  b_id          bigint not null references public.dinner_signups (id) on delete cascade,
  status        text not null default 'proposed' check (status in ('proposed', 'notified', 'scheduled', 'done', 'cancelled')),
  meal_date     date,
  notes         text,
  notified_at   timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (a_id <> b_id)
);
create index if not exists dinner_pairs_status on public.dinner_pairs (status);
alter table public.dinner_signups enable row level security;
alter table public.dinner_pairs   enable row level security;
revoke all on public.dinner_signups from anon, authenticated;
revoke all on public.dinner_pairs   from anon, authenticated;

insert into public.settings (key, value) values
  ('dinner_enabled', 'false'),
  ('dinner_age_gap', '3'),
  ('dinner_missionary_contact', ''),
  ('dinner_intro_sms', 'Hi {first}! You''re taking the missionaries to dinner with {other} — text them at {other_phone} to pick a night that works for you both, then set it up with the missionaries ({missionaries}). Thanks for signing up! — North Point YSA')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Public
-- ---------------------------------------------------------------------------
create or replace function public.dinner_status()
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('enabled', coalesce((select value from settings where key = 'dinner_enabled'), 'false') = 'true');
$$;
grant execute on function public.dinner_status() to anon;

create or replace function public.dinner_signup(p_name text, p_gender text, p_age int, p_phone text, p_email text default null,
  p_availability text default null, p_notes text default null, p_website text default '')
returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_name text; v_phone text; v_digits text; v_email text;
begin
  if coalesce(p_website, '') <> '' then return 0; end if;   -- honeypot: pretend it worked
  if coalesce((select value from settings where key = 'dinner_enabled'), 'false') <> 'true' then raise exception 'Sign-ups are closed right now'; end if;
  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone := btrim(coalesce(p_phone, ''));
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  v_email := lower(btrim(coalesce(p_email, '')));
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Please enter your name'; end if;
  if p_gender not in ('M', 'F') then raise exception 'Please pick man or woman'; end if;
  if p_age is null or p_age < 18 or p_age > 45 then raise exception 'Please enter your age (18–45)'; end if;
  if length(v_digits) < 10 or length(v_phone) > 40 then raise exception 'Please enter a mobile number your match can text'; end if;
  if v_email <> '' and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120) then raise exception 'Please enter a valid email address (or leave it blank)'; end if;
  if length(coalesce(p_availability, '')) > 300 or length(coalesce(p_notes, '')) > 600 then raise exception 'Please keep the notes shorter'; end if;
  if (select count(*) from dinner_signups where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many sign-ups right now — please try again in a little while';
  end if;
  -- the same number signing up again while still waiting or paired: update the details, keep the place
  select id into v_id from dinner_signups where regexp_replace(phone, '\D', '', 'g') = v_digits and status in ('waiting', 'paired') order by created_at desc limit 1;
  if v_id is not null then
    update dinner_signups set name = v_name, gender = p_gender, age = p_age, phone = v_phone, email = nullif(v_email, ''),
      availability = nullif(btrim(coalesce(p_availability, '')), ''), notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
    where id = v_id;
    return v_id;
  end if;
  insert into dinner_signups (name, gender, age, phone, email, availability, notes)
  values (v_name, p_gender, p_age, v_phone, nullif(v_email, ''), nullif(btrim(coalesce(p_availability, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.dinner_signup(text, text, int, text, text, text, text, text) to anon;

-- ---------------------------------------------------------------------------
-- Leaders
-- ---------------------------------------------------------------------------
create or replace function public.admin_dinner_signups(p_pass text, p_include_done boolean default false)
returns setof public.dinner_signups
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query select * from dinner_signups s
    where p_include_done or s.status in ('waiting', 'paired') or s.updated_at > now() - interval '60 days'
    order by (s.status = 'waiting') desc, s.created_at asc;
end $$;

create or replace function public.admin_dinner_pairs(p_pass text, p_include_closed boolean default false)
returns setof public.dinner_pairs
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return query select * from dinner_pairs p
    where p_include_closed or p.status in ('proposed', 'notified', 'scheduled') or p.updated_at > now() - interval '60 days'
    order by (p.status in ('proposed', 'notified', 'scheduled')) desc, p.created_at desc;
end $$;

-- Make a pair. Both must be waiting, one man + one woman.
create or replace function public.admin_dinner_pair(p_pass text, p_a bigint, p_b bigint, p_by text default null)
returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; a record; b record;
begin
  perform _check_admin(p_pass);
  select * into a from dinner_signups where id = p_a for update; select * into b from dinner_signups where id = p_b for update;
  if a is null or b is null then raise exception 'sign-up not found'; end if;
  if a.status <> 'waiting' or b.status <> 'waiting' then raise exception 'Both people need to be waiting (not already paired)'; end if;
  if a.gender = b.gender then raise exception 'A pair is one man and one woman'; end if;
  insert into dinner_pairs (a_id, b_id, created_by) values (p_a, p_b, left(p_by, 80)) returning id into v_id;
  update dinner_signups set status = 'paired', times_paired = times_paired + 1, updated_at = now() where id in (p_a, p_b);
  return v_id;
end $$;

-- Move a pair along. notified = intro texts went out; scheduled (+ date); done; cancelled (both
-- people go back to waiting).
create or replace function public.admin_dinner_pair_status(p_pass text, p_id bigint, p_status text, p_meal_date date default null, p_notes text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p record;
begin
  perform _check_admin(p_pass);
  if p_status not in ('proposed', 'notified', 'scheduled', 'done', 'cancelled') then raise exception 'bad status'; end if;
  select * into p from dinner_pairs where id = p_id for update;
  if p is null then raise exception 'pair not found'; end if;
  update dinner_pairs set status = p_status,
    meal_date = coalesce(p_meal_date, meal_date),
    notes = coalesce(p_notes, notes),
    notified_at = case when p_status = 'notified' and notified_at is null then now() else notified_at end,
    updated_at = now()
  where id = p_id;
  if p_status = 'cancelled' then
    update dinner_signups set status = 'waiting', times_paired = greatest(0, times_paired - 1), updated_at = now() where id in (p.a_id, p.b_id) and status = 'paired';
  elsif p_status = 'done' then
    update dinner_signups set status = 'done', updated_at = now() where id in (p.a_id, p.b_id) and status = 'paired';
  end if;
end $$;

-- A person: waiting (back in the pool), withdrawn (out), or delete for good.
create or replace function public.admin_dinner_signup_status(p_pass text, p_id bigint, p_status text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  if p_status not in ('waiting', 'withdrawn', 'done') then raise exception 'bad status'; end if;
  if exists (select 1 from dinner_pairs p where (p.a_id = p_id or p.b_id = p_id) and p.status in ('proposed', 'notified', 'scheduled')) then
    raise exception 'They are in an open pair — cancel or finish that first';
  end if;
  update dinner_signups set status = p_status, updated_at = now() where id = p_id;
end $$;

create or replace function public.admin_dinner_signup_delete(p_pass text, p_id bigint)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  delete from dinner_signups where id = p_id;
end $$;

create or replace function public.admin_dinner_waiting_count(p_pass text)
returns int
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_admin(p_pass);
  return (select count(*) from dinner_signups where status = 'waiting')::int;
end $$;

grant execute on function public.admin_dinner_signups(text, boolean)                     to anon;
grant execute on function public.admin_dinner_pairs(text, boolean)                       to anon;
grant execute on function public.admin_dinner_pair(text, bigint, bigint, text)           to anon;
grant execute on function public.admin_dinner_pair_status(text, bigint, text, date, text) to anon;
grant execute on function public.admin_dinner_signup_status(text, bigint, text)          to anon;
grant execute on function public.admin_dinner_signup_delete(text, bigint)                to anon;
grant execute on function public.admin_dinner_waiting_count(text)                        to anon;
