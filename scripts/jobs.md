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

```
You maintain the North Point YSA attendance flow. Task: push today's site check-ins into LCR and
refresh the roster.

1. Open https://lcr.churchofjesuschrist.org/mlt/report/class-and-quorum-attendance?lang=eng in
   the built-in browser pane (preview_start). Wait ~5 s, then get_page_text. If it shows the
   Church "Sign In" page instead of "Class and Quorum Attendance", stop and tell Joseph: the LCR
   session expired — sign in in the browser pane and say "sync attendance". Do not enter
   credentials yourself.
2. Fetch https://northpointysa.com/scripts/lcr-sync.js (WebFetch or curl in the cloud shell) and
   run it in that tab with javascript_exec, prefixed by:
   window.NP_SYNC = { supabaseUrl: "<SUPABASE_URL>", anonKey: "<ANON_KEY>", pass: "<ADMIN_PASSPHRASE>", mode: "both" };
   then `const r = await (<the script's IIFE>); r`.
   (mode "both" = refresh roster from the page + click the attendance buttons for pending
   check-ins for the most recent Sunday.)
3. Read the returned summary. If `push.noCell` or `push.failed` is non-empty, retry once. If
   `errors` mentions a month not yet available or no editable cells, report that and stop.
4. Report in one paragraph: week, roster inserted/updated/deactivated, check-ins clicked /
   already marked / failed.
```
