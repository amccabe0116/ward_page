# northpointysa.com

Sunday roll + weekly announcements for the North Point YSA Ward.

```
index.html          landing: two class buttons + this week's announcements
roll.html           ?class=sunday_school | priesthood_rs — tap your name, check in
contact.html        ?topic=housing | jobs — private note to ward leadership (have / need)
bishop.html         request a meeting with the Bishop (name, phone, email, temple-recommend checkbox)
admin.html          Leaders page: 12-hour login, attendance by Sunday, inbox, announcements, callings meeting, members, settings
callings.js         Leaders › Callings: the members-without-callings list + one-person-per-slide meeting deck
config.js           Supabase URL / anon key (public by design)
announcements.json  written by the Sunday-night announcements job
img/                flyers attached to the announcements email
supabase/schema.sql database (tables, RLS, RPC functions) — paste into the SQL editor once
scripts/lcr-sync.js runs inside a signed-in LCR tab: roster → Supabase, check-ins → LCR
scripts/announcements.gs          Google Apps Script: announcements email → repo, every Sunday night
scripts/publish_announcements.py  same thing from a raw .eml, for manual use
supabase/guests.sql               guests/visitors table + functions (part of schema.sql too)
supabase/windows.sql              check-in time windows + settings (part of schema.sql too)
supabase/notes.sql                notes to leadership + hardened Leaders login (part of schema.sql too)
supabase/inbox.sql                editable announcements + Bishop meeting requests (part of schema.sql too)
supabase/sheets.sql               mirrors the two leadership Google Sheets (callings doc, new-member form)
scripts/sheets_to_json.py         manual fallback: two .xlsx exports → the JSON the sheets functions store
```

## How it fits together

1. **QR code → northpointysa.com.** People pick Sunday School or Priesthood / Relief Society,
   find their name, tap Check in. Check-ins go to Supabase through `check_in()`; the anon key
   can only call the roll functions (see the grants in `schema.sql`).
2. **Sunday night — announcements.** A Google Apps Script in Joseph's account
   (`scripts/announcements.gs`) reads the "Northpoint YSA Ward Weekly Announcements" email
   (sent from LCR), commits the flyers to `img/` and a fallback `announcements.json`, publishes
   the text into the `announcements` table, and archives the email under `NPYSA/Announcements`.
   Leaders can edit the current week on the Leaders page; the home page reads the database
   first and falls back to the JSON.
3. **Sunday night — LCR.** A second task (bound to Joseph's Mac) opens LCR's Class and Quorum
   Attendance report in Claude's browser pane and runs `lcr-sync.js`, which refreshes the roster
   from the page and clicks the attendance buttons for everyone who checked in on the site.
   Rows show as *synced* on the admin page once LCR has them. Guests stay on the site only —
   LCR's Visitors tab takes men/women totals, and the ward chose not to send those.
4. **Leaders › Callings.** The "Members without Callings" Google Sheet and the "New Member
   Form" responses are copied into the database (`sheets` table) by `syncMemberSheets` in
   `scripts/announcements.gs` every 6 hours (or on demand with the Refresh button once the
   script is deployed as a web app — `sheetsRefreshUrl` in `config.js`). `callings.js` matches
   each person on the callings sheet to their form response and to the LCR roll, and shows the
   list plus a meeting deck (one person per slide, ← → to move) for handing out assignments.
   Read-only: edits still happen in the Google Sheet.

## Security model

- The public key in `config.js` can only call the functions granted to `anon` — roll lookups,
  check-ins, note submission. Every table has RLS on and no anon policies, so nothing is readable
  directly.
- Everything under **Leaders** goes through `_check_admin()`: a 12-hour session token from
  `admin_login()` (bcrypt cost 10 passphrase check; 10 failures lock the page for 15 minutes; a
  wrong passphrase costs a full second), or the passphrase itself for the sync scripts.
- Notes to leadership (`leader_notes`) are only ever returned by the admin functions. Pick a long
  passphrase and keep HTTPS enforced on GitHub Pages.

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
