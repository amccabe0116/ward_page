# Scheduled jobs (Claude scheduled tasks)

Both run on Sunday evenings (America/New_York). Prompts below are what each task fires with.

## 1. Publish announcements — Google Apps Script, Sundays 9–10 PM ET

Runs in Joseph's Google account, not in Claude: `scripts/announcements.gs`. It reads the
"Northpoint YSA Ward Weekly Announcements" email (attachments included, Trash included), writes
`announcements.json` + `img/ann-*` to the repo through the GitHub API, then labels and archives
the email. Setup steps are at the top of that file. Re-running it is safe (it skips an email it
already published). If it ever breaks, `scripts/publish_announcements.py` does the same job
from a raw `.eml`.

## 1b. The weekly email now comes from the posts

Leaders › Announcements → Email version builds it from the live posts. Send it from LCR's
Send a Message (https://lcr.churchofjesuschrist.org/mlt/messaging?lang=eng): its editor keeps
h1/h2/bold/links/lists from a formatted paste and drops images, so tick the flyers, Download
selected (.zip), unzip and drop the set into Attachments (jpg/png/pdf/docx/xlsx only — no .ics,
25 MB each). The Apps Script import of that email keeps running but the home page hides the
imported text whenever there are posts.

Calendars: every dated post in the email has "Add to calendar: Google · Apple / Outlook" links
(a calendar.google.com template link, and cal/<id>.ics on the site), and the header invites people
to subscribe once at calendar.html (calendar.ics — Apple hourly, Google about daily). The .ics files
are committed by `syncCalendar` in announcements.gs — on every 6-hour sheet sync and straight
from the Leaders page when a dated post is approved / edited / taken down / deleted (web app
action `calendar`; "Rebuild calendar files" on the Email version panel does it by hand). An email
can't put an event into someone's calendar on its own (only registered senders like airlines get
that from Gmail), so links + the subscription are the whole story.

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

(The SimpleTexting text list is NOT fed from LCR: the Apps Script's `syncTextList` adds only the
 people who ticked "agree" on the New Member Form's texting question, every 6 hours or from
 Settings → Sync now. Nothing to do here for it.)

Roster refresh — do it every run, it is cheap (LCR shows ~270 people):
   LCR tab: window.NP_SYNC = { mode: 'roster', week: <week>, from: 0, to: 140 } then { from: 140, to: 400 }
   site tab: collect both slices in a window variable, then ONE db-sync call
             { action: 'roster', classes, members: <all>, deactivateMissing: true }.
   (Sending slices with deactivateMissing:true would deactivate everyone not in that slice.)
```

Notes from the 2026-09-17 run: LCR rendered the custom report's column headers as untranslated
keys ("record.preferred.name"); lcr-report.js now maps those back to the labels the site expects.
The attendance report listed 243 members vs 273 on the site — all 30 were on LCR's Members Moved
Out report (mostly processed that day), so deactivateMissing:true was right; check that report
(https://lcr.churchofjesuschrist.org/mlt/report/members-moved-out?lang=eng) before deactivating
a large batch. The Members Moved In page needs ~15 s to render its table; after switching
"Show for past" to 3 Months wait for the row count to change.

First real run (2026-09-14, from Joseph's Mac): Sept 6 → 116 of 119 check-ins into LCR, Sept 13 →
105 of 105; 112 + 104 clicks took about 2 minutes each. Three Sept 6 rows stay "pending" forever
because those two records moved out of the ward before the sync (Makayla Blair, Trey Gaul). The
LCR sign-in lasted under an hour, so the run has to start right after Joseph signs in.
