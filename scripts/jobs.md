# Scheduled jobs (Claude scheduled tasks)

Both run on Sunday evenings (America/New_York). Prompts below are what each task fires with.

## 1. Publish announcements (cloud, no device needed) — Sundays 9:00 PM ET

```
You maintain northpointysa.com (GitHub repo Josephmt95/northpointysa, GitHub Pages).
Task: publish this week's ward announcements to the site.

1. Gmail: search `subject:"Northpoint YSA Ward Weekly Announcements" newer_than:4d -in:trash`.
   If nothing is found, also try `from:noreply-lcr@mail.churchofjesuschrist.org newer_than:4d`.
   If still nothing, stop and report "no announcements email this week".
2. Take the newest message. Fetch it with get_message in RAW format (this includes the flyer
   images). Save the raw payload to a file, e.g. /tmp/ann.raw (write the raw string exactly as
   returned).
3. Clone or pull the repo (git, main branch). Run:
   python3 scripts/publish_announcements.py --raw /tmp/ann.raw --out . \
     --message-id <gmail message id> --subject "<subject>" --sent-at "<message date ISO>"
   If RAW is unavailable, fall back to PLAIN_TEXT: save the body to /tmp/ann.txt and run
   --text /tmp/ann.txt instead.
4. Sanity-check announcements.json: the text should start with "All," (or similar) and must not
   contain the "You received this email because…" footer. Fix by hand only if the script missed
   something obvious.
5. git add announcements.json img && git commit -m "Announcements for <date>" && git push.
6. Gmail: apply the label "NPYSA/Announcements" to the message (create it if missing) and remove
   it from the inbox (archive). Do not delete it.
7. Report in one paragraph: the date published, number of images, and anything odd.
```

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
7. If `noCell` or `failed` are non-empty, retry step 5 once with just those; then report.
8. Report in one paragraph: week, pushed / already marked / failed (with names from `pending`).

Monthly (first Sunday) also refresh the roster:
   LCR tab: window.NP_SYNC = { mode: 'roster', week: <week>, from: 0, to: 140 } then { from: 140, to: 400 }
   site tab: db-sync { action: 'roster', classes, members: <slice>, deactivateMissing: false } for
   each slice, then one final { action: 'roster', classes, members: <all>, deactivateMissing: true }
   only if you can send all members in one call; otherwise skip deactivation and say so.
```
