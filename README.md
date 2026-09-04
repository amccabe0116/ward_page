# northpointysa.com

Sunday roll + weekly announcements for the North Point YSA Ward.

```
index.html          landing: two class buttons + this week's announcements
roll.html           ?class=sunday_school | priesthood_rs — tap your name, check in
admin.html          passphrase-gated: attendance by Sunday, member list, LCR sync notes
config.js           Supabase URL / anon key (public by design)
announcements.json  written by the Sunday-night announcements job
img/                flyers attached to the announcements email
supabase/schema.sql database (tables, RLS, RPC functions) — paste into the SQL editor once
scripts/lcr-sync.js runs inside a signed-in LCR tab: roster → Supabase, check-ins → LCR
scripts/announcements.gs          Google Apps Script: announcements email → repo, every Sunday night
scripts/publish_announcements.py  same thing from a raw .eml, for manual use
supabase/guests.sql               guests/visitors table + functions (part of schema.sql too)
```

## How it fits together

1. **QR code → northpointysa.com.** People pick Sunday School or Priesthood / Relief Society,
   find their name, tap Check in. Check-ins go to Supabase through `check_in()`; the anon key
   can only call the roll functions (see the grants in `schema.sql`).
2. **Sunday night — announcements.** A Google Apps Script in Joseph's account
   (`scripts/announcements.gs`) reads the "Northpoint YSA Ward Weekly Announcements" email
   (sent from LCR), commits `announcements.json` + the flyers to `img/`, and archives the email
   under the `NPYSA/Announcements` label. GitHub Pages redeploys in about a minute.
3. **Sunday night — LCR.** A second task (bound to Joseph's Mac) opens LCR's Class and Quorum
   Attendance report in Claude's browser pane and runs `lcr-sync.js`, which refreshes the roster
   from the page and clicks the attendance buttons for everyone who checked in on the site.
   Rows show as *synced* on the admin page once LCR has them.

## Setup (one time)

- Supabase: new project → SQL editor → run `supabase/schema.sql` → `select set_admin_passphrase('…');`
- `config.js`: fill in `supabaseUrl` and `supabaseAnonKey`.
- GitHub Pages: Settings → Pages → deploy from `main` / root; custom domain `northpointysa.com`.
- GoDaddy DNS: `A @` → 185.199.108.153 / 185.199.109.153 / 185.199.110.153 / 185.199.111.153,
  `CNAME www` → `josephmt95.github.io`. Remove the old forwarding on `role`/`roll` or point
  those at the site too.

## Local preview

`python3 -m http.server 8000` and open http://localhost:8000 — the roll pages need a real
Supabase project (or a mocked `/rest/v1/rpc/*`).
