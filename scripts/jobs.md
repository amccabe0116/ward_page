# Scheduled jobs (Claude scheduled tasks)

Both run on Sunday evenings (America/New_York). Prompts below are what each task fires with.

## 1. Publish announcements — Google Apps Script, Sundays 9–10 PM ET

Runs in Joseph's Google account, not in Claude: `scripts/announcements.gs`. It reads the
"Northpoint YSA Ward Weekly Announcements" email (attachments included, Trash included), writes
`announcements.json` + `img/ann-*` to the repo through the GitHub API, then labels and archives
the email. Setup steps are at the top of that file. Re-running it is safe (it skips an email it
already published). If it ever breaks, `scripts/publish_announcements.py` does the same job
from a raw `.eml`.

## 2. Sync attendance with LCR (needs Joseph's Mac + desktop app) — Sundays 9:30 PM ET

LCR's page blocks calls to Supabase (CSP), so the sync is two halves that you shuttle between:
`scripts/db-sync.js` (Supabase, runs in a blank tab) and `scripts/lcr-sync.js` (LCR, runs in the
report tab). Both are on the site: https://northpointysa.com/scripts/<name>.js

```
You maintain the North Point YSA attendance flow. Task: push today's site check-ins into LCR.
Config: SUPABASE_URL=<url>, ANON_KEY=<publishable key>, PASS=<admin passphrase>.

1. Open https://lcr.churchofjesuschrist.org/mlt/report/class-and-quorum-attendance?lang=eng in
   the built-in browser pane (preview_start). Wait ~5 s, then get_page_text. If it shows the
   Church "Sign In" page instead of "Class and Quorum Attendance", stop and tell Joseph the LCR
   session expired: sign in in the browser pane and say "sync attendance". Never type credentials.
2. Open a second blank tab (tabs_create) and navigate it to https://northpointysa.com/admin.html.
3. Fetch both scripts (curl in the cloud shell works — GitHub Pages is reachable).
4. In the site tab run db-sync with
   window.NP_DB = { supabaseUrl, anonKey, pass, action: 'pending' };  -> note `pending` and `week`.
   If `pending` is empty, report "nothing to push" and stop.
5. In the LCR tab run lcr-sync with
   window.NP_SYNC = { mode: 'push', week: <week>, pending: <pending array> };
6. In the site tab run db-sync with { action: 'mark', ids: <synced ids from step 5> }.
7. If `failed` is non-empty, retry step 5 once with just those. `noCell` means the person's
   record has left the ward (or arrived after the last roster refresh) — refresh the roster
   (below), rerun steps 4–6, and list anyone still without a cell by name.
8. Guests: NOT sent to LCR (Joseph's call, Sept 2026 — LCR's Visitors tab only takes men/women
   totals). Just list them in the report. If a guest's name matches a roster member, they
   probably typed their name before the roster refresh picked them up: add them on the Leaders
   page as that member instead and remove the guest row.
9. Report in one paragraph: week, pushed / already marked / no cell (with names from `pending`).

Members-without-callings report — also every run (feeds Leaders › Callings):
   LCR tab: navigate to https://lcr.churchofjesuschrist.org/mlt/report/create-a-report/custom-reports-details/186530a9-e9f3-46ab-9981-df0e4789315e
            wait for "Count: N" at the bottom, then run scripts/lcr-report.js
            (window.NP_REPORT = { key: 'lcr_callings', title: 'LCR: Members without Callings' })
   site tab: db-sync { action: 'sheet', key, title, sourceUrl, headers, rows } with that result.
   The leaders' Google Sheet (notes) refreshes separately via the Apps Script / "refresh the sheets".

Leaders › Overview feeds — also every run (two quick copies, no clicking):
   LCR tab: navigate to https://lcr.churchofjesuschrist.org/mlt/report/members-moved-in?lang=eng,
            set "Show for past" to 3 Months, wait for the table, run scripts/lcr-report.js
            (window.NP_REPORT = { key: 'lcr_moved_in', title: 'LCR: Members Moved In (past 3 months)' });
            keep only the columns Person UUID, Name, Age, Move In Date, Prior Unit (drop address/phone).
   LCR tab: navigate to https://lcr.churchofjesuschrist.org/report/sacrament-attendance?lang=eng,
            run scripts/lcr-sacrament.js (current year; in January also run it with year: <last year>
            and merge the two row lists before storing).
   site tab: db-sync { action: 'sheet', key, title, sourceUrl, headers, rows } for each.

Member list with phone numbers — also every run (feeds the SimpleTexting text-list sync):
   LCR tab: navigate to https://lcr.churchofjesuschrist.org/records/member-list?lang=eng (or the
            custom report "All members – contact info" under Create a Report if that page's table
            doesn't scrape), wait for it to load, run scripts/lcr-report.js
            (window.NP_REPORT = { key: 'lcr_members', title: 'LCR: Member list' });
            keep Person UUID, Name (or Preferred Name), Phone, E-mail, Age, Gender — drop addresses.
   site tab: db-sync { action: 'sheet', key: 'lcr_members', ... }.
   The Apps Script (`syncTextList`, every 6 hours or Settings → Sync now) then adds anyone with a
   mobile number to the SimpleTexting list.

Roster refresh — do it every run, it is cheap (LCR shows ~270 people):
   LCR tab: window.NP_SYNC = { mode: 'roster', week: <week>, from: 0, to: 140 } then { from: 140, to: 400 }
   site tab: collect both slices in a window variable, then ONE db-sync call
             { action: 'roster', classes, members: <all>, deactivateMissing: true }.
   (Sending slices with deactivateMissing:true would deactivate everyone not in that slice.)
```

First real run (2026-09-14, from Joseph's Mac): Sept 6 → 116 of 119 check-ins into LCR, Sept 13 →
105 of 105; 112 + 104 clicks took about 2 minutes each. Three Sept 6 rows stay "pending" forever
because those two records moved out of the ward before the sync (Makayla Blair, Trey Gaul). The
LCR sign-in lasted under an hour, so the run has to start right after Joseph signs in.
