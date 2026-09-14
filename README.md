# northpointysa.com

Sunday roll + weekly announcements for the North Point YSA Ward.

```
index.html          landing: two class buttons + this week's announcements
roll.html           ?class=sunday_school | priesthood_rs — tap your name, check in
contact.html        ?topic=housing | jobs — private note to ward leadership (have / need)
bishop.html         request a meeting with the Bishop (name, phone, email, temple-recommend checkbox)
keys.html           "The keys": a mini game — crawl the baby past the Primary presidency to the bishop (ward-wide high scores)
admin.html          Leaders page: 12-hour login, overview, attendance by Sunday, inbox, announcements, callings meeting, members, settings
overview.js         Leaders › Overview: roll size, men/women, moved in last 30 days, sacrament attendance, accepted-not-sustained
callings.js         Leaders › Callings: the members-without-callings list + one-person-per-slide meeting deck
config.js           Supabase URL / anon key (public by design)
announcements.json  written by the Sunday-night announcements job
img/                flyers attached to the announcements email
supabase/schema.sql database (tables, RLS, RPC functions) — paste into the SQL editor once
scripts/lcr-sync.js runs inside a signed-in LCR tab: roster → Supabase, check-ins → LCR
scripts/lcr-report.js             runs inside a signed-in LCR tab: a report table (members without callings, members moved in) → site
scripts/lcr-sacrament.js          runs inside a signed-in LCR tab: the sacrament meeting headcounts → site
scripts/announcements.gs          Google Apps Script: announcements email → repo, every Sunday night
scripts/publish_announcements.py  same thing from a raw .eml, for manual use
supabase/guests.sql               guests/visitors table + functions (part of schema.sql too)
supabase/windows.sql              check-in time windows + settings (part of schema.sql too)
supabase/notes.sql                notes to leadership + hardened Leaders login (part of schema.sql too)
supabase/inbox.sql                editable announcements + Bishop meeting requests (part of schema.sql too)
supabase/sheets.sql               mirrors the two leadership Google Sheets (callings doc, new-member form)
supabase/edits.sql                site-side edits to the callings sheet, written back by the Apps Script
supabase/flags.sql                Flag column (Warning/Magnet), row deletion, message templates
supabase/keys.sql                 high-score board for the mini game (keys_submit / keys_top / admin_keys_delete)
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
4. **Leaders › Callings.** Three sources meet here: LCR's *Members without Callings* custom
   report (the base list — copied in by `scripts/lcr-report.js` from a signed-in LCR tab, with
   the Sunday sync), the leaders' "Members without Callings" Google Sheet (the notes: proposed
   calling, who texts, answer, sustained, warnings), and the "New Member Form" responses. The
   two Google Sheets are copied into the database (`sheets` table) by `syncMemberSheets` in
   `scripts/announcements.gs` every 6 hours (or on demand with the Refresh button once the
   script is deployed as a web app — `sheetsRefreshUrl` in `config.js`). `callings.js` attaches
   each person's sheet notes, form response and roll check-ins to the LCR row, and shows the
   list plus a meeting deck (one person per slide, ← → to move) for handing out assignments.
   The meeting columns (proposed calling, who texts, texted, answer, sustained, other notes)
   are editable on the slide: edits save to `callings_edits` (`supabase/edits.sql`), show on
   the site at once, and are pushed into the Google Sheet in the background right after Save /
   Send (web app action `save`, one person; a *Save to sheet* button appears on the slide if that
   push failed), or on `syncMemberSheets`' next run (adding a row for anyone not on the sheet
   yet, deleting rows marked for deletion). Only the edited columns are
   written, a blank never overwrites a filled cell, and a field someone emptied on the site is
   stored as `null` so that clear does go through. Everything else is still edited in the sheet. *Remove* on a slide deletes the
   person's sheet row and keeps them hidden (`callings_edits.deleted`) until LCR stops listing
   them; the *Removed* filter undoes it. **Flag** is its own sheet column (Warning = may be sent
   back to their home ward if they don't attend; Magnet = being sent back, no new-member
   meeting) — `supabase/flags.sql`. It is the only source of a flag: Other Notes is plain text and
   is never read for meaning. *Send the warning / magnet message* on a slide texts (SimpleTexting) and emails
   the person through the Apps Script web app with the wording under Leaders › Settings, and
   records the date in the "Flag sent" column (ticking that box in Edit records today's date
   too). After `flag_due_days_warning` / `_magnet` days (Settings; 21 / 7 by default) the person
   shows as *Ready to move out* so their records can be moved.

5. **Leaders › Overview** is the landing page: active members and men/women split from the
   roster, who moved in during the last 30 days (LCR's *Members Moved In* report, copied in as
   sheet `lcr_moved_in`), the last five sacrament meeting headcounts (LCR's *Sacrament Meeting
   Attendance*, sheet `lcr_sacrament` via `scripts/lcr-sacrament.js`), and everyone on the
   callings sheet who accepted but hasn't been sustained. The two LCR copies are part of the
   Sunday sync (`scripts/jobs.md`).

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
