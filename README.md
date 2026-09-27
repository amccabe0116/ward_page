# northpointysa.com

Sunday roll + weekly announcements for the North Point YSA Ward.

```
index.html          landing: two class buttons + What's happening (posts in date order) + the weekly email
post.html           share an announcement: anyone can submit a post (with a flyer) for leaders to approve
calendar.html       subscribe to the ward calendar (calendar.ics) — Apple / Google / Outlook / any URL
e.html              one post on its own page (?id=…); e/<id>.html = the script's copy with Open Graph tags (the link in texts)
404.html            GitHub Pages' not-found page — renders the post for an e/<id> link whose page isn't published yet
calendar.ics        every approved event, written by the Apps Script (syncCalendar); cal/<id>.ics = one event each
posts.js            posts shared code: the card, the home-page list, the add/edit form, flyer resize + upload
roll.html           ?class=sunday_school | priesthood_rs — tap your name, check in
contact.html        ?topic=housing | jobs — private note to ward leadership (have / need)
bishop.html         request a meeting with the Bishop (name, phone, email, temple-recommend checkbox)
blind-date.html     blind dates: sign up, get paired with someone of the other gender close in age (was dinner.html)
cleaning.html       building cleaning: the Saturdays, who's helping, put a name down (yours or someone you asked)
meals.html          feed the missionaries: Elders / North Sisters / South Sisters, one meal per companionship per day
terms.html          Text-list Terms of Service (required by SimpleTexting) — not linked from the site
privacy.html        Text-list Privacy Policy (required by SimpleTexting) — not linked from the site
keys.html           "The keys": a mini game — crawl the baby past the Primary presidency to the bishop (ward-wide high scores)
admin.html          Leaders page: 12-hour login, overview, attendance by Sunday, inbox, announcements, callings meeting, members, settings
overview.js         Leaders › Overview: roll size, men/women, moved in last 30 days, sacrament attendance, to be sustained / set apart, recent converts
callings.js         Leaders › Callings: the members-without-callings list + one-person-per-slide meeting deck
pipeline.js         callings in progress for any member (proposed → contacted → accepted → sustained → set apart): the Members column + editor
config.js           Supabase URL / anon key (public by design)
announcements.json  written by the Sunday-night announcements job
img/                flyers attached to the announcements email
supabase/schema.sql database (tables, RLS, RPC functions) — paste into the SQL editor once
scripts/lcr-sync.js runs inside a signed-in LCR tab: roster → Supabase, check-ins → LCR
scripts/lcr-report.js             runs inside a signed-in LCR tab: a report table (members without callings, members moved in) → site
scripts/lcr-sacrament.js          runs inside a signed-in LCR tab: the sacrament meeting headcounts → site
scripts/lcr-converts.js           runs inside a signed-in LCR tab: Covenant Path Progress › New Members (converts, two years) → site
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
supabase/addrow.sql               Add to sheet: lets the site pre-fill the callings sheet's intake columns
supabase/posts.sql                posts (events / notices with flyers), public submission, approval, the "flyers" storage bucket
supabase/repeat.sql               repeating posts (weekly / every 2 weeks / monthly), cancelling one date
supabase/bishop.sql               Bishop meeting requests texted to the executive secretary (claim-once + the number setting)
supabase/dinner.sql               blind dates: sign-ups, pairs, the on/off switch (dinner_enabled) — names kept from the tool's first version
supabase/cleaning.sql             building cleaning: cleaning_dates (each also a post) + cleaning_signups
supabase/meals.sql                missionary meals: missionary_meals, the switch and per-companionship settings
supabase/pipeline.sql             callings in progress for any member (calling_pipeline): proposed → contacted → accepted → sustained → set apart
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
3. **Sunday night — LCR.** A second task (bound to Joseph's Mac) runs the weekly sync
   (`scripts/jobs.md` §2) in Claude's browser pane: it refreshes the roster from LCR's Class and
   Quorum Attendance report (the only thing that marks a member active or inactive — the Members
   tab has no switch), clicks the attendance buttons for everyone who checked in on the site,
   then copies the LCR reports the Leaders page reads (members without callings, members moved
   in, sacrament headcounts, recent converts, members with callings — the last one also retires
   tracked callings that LCR now has). Rows show as *synced* on the admin page once
   LCR has them. Guests stay on the site only — LCR's Visitors tab takes men/women totals, and
   the ward chose not to send those.
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
   shows as *Ready to move out* so their records can be moved. The same Flag can be set straight
   from **Leaders › Members** (a Flag column on every row, with *Send message* jumping to the
   person's slide): someone who isn't on the callings list gets a row of their own (shown under
   *Has a calling?* / *Not in LCR* until LCR lists them), and any change clears *Flag sent*. The
   Warning / Magnet / Ready-to-move-out views include everyone flagged, calling or not.

5. **Leaders › Overview** is the landing page: active members and men/women split from the
   roster, who moved in during the last 30 days (LCR's *Members Moved In* report, copied in as
   sheet `lcr_moved_in`), the last five sacrament meeting headcounts (LCR's *Sacrament Meeting
   Attendance*, sheet `lcr_sacrament` via `scripts/lcr-sacrament.js`), two callings lists —
   *accepted, still to be sustained* and *sustained, still to be set apart* — and **recent
   converts** (LCR's *Covenant Path Progress › New Members*, sheet `lcr_converts` via
   `scripts/lcr-converts.js`: how long a member, the last six Sundays as dots, LCR's count of
   sacrament meetings missed, friends identified; chips filter 3 months / 6 months / 1 year /
   2 years, remembered per device). The LCR copies are part of the Sunday sync (`scripts/jobs.md`).

   The callings lists come from two places. **Callings in progress** (`pipeline.js`,
   `supabase/pipeline.sql`, table `calling_pipeline`) tracks a calling for *any* member in the
   order it happens — proposed calling (with who contacts noted) → contacted → accepted (yes /
   no) → sustained → set apart; recording a later step fills in the earlier ones, set apart closes the
   row (done), declined or *Withdraw* closes it as dropped. Leaders › Members has a *Calling in
   progress* column showing the open row's calling, current step and who contacts; tapping it
   opens the editor (dates default to today), *+ propose* starts one. Chips above the list filter
   by stage — proposed, waiting on an answer, accepted, sustained, declined, set apart in the
   last 90 days — with counts. *Who contacts* is shown alongside as
   information; it isn't a step. *Copy list* copies whoever is showing as one line per person
   (name — calling — who contacts) for a text or meeting notes. A tracked calling that has reached
   *set apart* is retired by the Sunday sync once LCR has it: `db-sync.js` action `callings` takes
   LCR's *Members with Callings* report (copied in as sheet `lcr_with_callings`) and deletes each
   done row whose person now has a calling in LCR sustained on or after the tracked date, reporting
   the ones LCR still doesn't show. Someone on the *Members
   without Callings* sheet with a proposal there but no row here shows the sheet's state (marked
   *· sheet*); tapping *Track* copies it over. The Overview merges both: tracked rows first, then
   sheet people (Answer says yes / Sustained ticked) not tracked yet. *Sustained ✓* and *Set
   apart ✓* on those rows record the step (for a sheet person it starts the tracked row and, for
   sustaining, ticks the sheet's box too); a name opens the member's editor, or the callings slide
   for sheet people.

6. **Add to sheet.** People on LCR's report with no row on the sheet get an *Add to sheet*
   button on their slide (and an *Add all* chip on the New / not on sheet filter). The row is
   pre-filled from LCR (location, age) and their newest move-in form (car, length of stay,
   mission, purpose, hobbies, music), stored as a site edit, and written to the Google Sheet right
   away. Needs `supabase/addrow.sql` (it widens the columns `admin_callings_edit` accepts).
   The *new* tag means LCR's move-in date is within the last 30 days (`NEW_DAYS` in callings.js);
   it expires on its own. Someone who is on LCR's report but deliberately has no row gets *Leave off the sheet* instead
   (an optional reason goes in their Other Notes): it uses the same `deleted` mark as Remove, so
   they drop out of New / not on sheet, *Add all* skips them, and *Back on the list* under the
   Removed / left off filter undoes it. For people with no sheet row the site's own edits are
   always shown (there is no sheet copy to defer to).

7. **Announcements as posts.** The home page's *What's happening* section lists posts — each
   an event (date, time, place, details, link, flyer) or an undated notice — soonest first, grouped
   by month, dropping off after the day passes (notices stay 30 days). A *Show* row of chips picks
   how far ahead the list goes (1 month / 2 months / 6 months / All — 2 months by default,
   remembered on that phone); what's past the cutoff is counted under the list with a *Show
   everything* link, so next spring's general conference doesn't crowd out this week's FHE. The
   weekly email does the same on its own: events more than 45 days out are one line each under
   *Save the date*. *Share something* opens
   `post.html`, where anyone can write a post and attach a flyer; the image is shrunk in the
   browser (longest side 1600 px, JPEG) and uploaded to the public Supabase storage bucket
   `flyers` (3 MB cap, images only, upload-only for the public key), then `submit_post` stores
   it as *pending* (rate-limited, honeypot field). Leaders › Announcements shows *Waiting for
   approval* with Approve / Edit / Reject, the live list with Edit / Take down / Delete, and a
   *New post* form that publishes straight away; the tab badge counts pending posts. The weekly
   posts are also the source of the weekly email now: *Email version* on that tab builds it from
   the live posts — a fixed contact-us block on top (text list, WhatsApp, Facebook, the housing
   and employment specialists, notes to leadership, meeting the Bishop; editable, saved as
   settings `posts_email_header` / `posts_email_footer`), then *Coming up* and *Announcements*,
   then an invitation to post at `post.html` — with *Copy formatted* (HTML: headings, bold, links
   and lists survive a paste into LCR's *Send a Message* editor; images don't) and *Copy plain
   text*. Under *Flyers to attach*, the live posts' flyers are listed as a checklist (all ticked):
   *Download selected (.zip)* fetches them and builds one .zip in the browser (a store-only ZIP
   writer in `posts.js`, files named `01-<title>.jpg` in date order) so they can be unzipped and
   dragged onto LCR's Attachments box in one go; *One by one instead* downloads them
   separately. Dated posts also carry **Add to calendar** links, on the home page and in the
   email: a Google Calendar template link (pre-filled event, no file involved) and `cal/<id>.ics`
   for Apple / Outlook — Eastern times converted to UTC in `posts.js` (`calendarLinks`). The .ics
   files, and the subscribable `calendar.ics` behind `calendar.html`, are written into the repo by
   `syncCalendar` in `scripts/announcements.gs`: at the end of every 6-hour sheet sync and the moment
   a leader approves, edits, takes down or deletes a dated post (web app action `calendar`, also the
   *Rebuild calendar files* chip on the Email version panel). Only changed files are committed; an
   event's own file goes a week after the event, the ward calendar keeps two months of past events.
   **Repeating posts** (`supabase/repeat.sql`): a post can repeat every week, every 2 weeks or
   monthly on the same weekday (1st Tuesday…), optionally until a date; its `event_date` is the
   first occurrence. The site works out the upcoming dates itself (`occurrences()` in posts.js) and
   shows only the next few (*Show the next* 1–4, default 2): the first as a full card, the rest as
   compact one-liners slotted into the date order — same in the email. Leaders can cancel a single
   date from the card (*Upcoming — tap a date to cancel it*, `admin_post_skip` → `skip_dates`): the
   site and email show it as cancelled, and the calendar files carry the series as one event with an
   `RRULE` plus an `EXDATE` per cancelled date, so subscribers see the whole run and the gaps.
   **Text a reminder** on a live post's card (Leaders › Announcements) sends one SimpleTexting
   campaign to the ward list (Script property `SIMPLETEXTING_LIST`, "North Point Ward -
   Notifications") through the Apps Script (web app action `remind`): the wording is shown first
   — title, day, time, place and the post's short link `e.html?id=…` (the flyer and details on
   their own page) — with the list's live contact count, and nothing goes out until *Send to N
   people* plus the confirm. *Text a test to <your mobile>* sends the same wording to one phone
   first (the single-number path, web app action `notify`; the number is remembered on that device). The script stamps `reminded_at` (`admin_post_reminded`, in
   `supabase/repeat.sql`) so the card says when it was texted. The link is `e/<id>` — a copy of
   `e.html` the script publishes per live post with the post's Open Graph tags (title, when,
   flyer as `og:image`), which is what Messages / WhatsApp read to show a preview under a link
   (they don't run scripts, so `e.html?id=` alone previews plain); the box falls back to
   `e.html?id=` and says so if that page isn't published yet. Every card on the site has a
   **Share** button (bottom right) that shares the same `e/<id>` link — the phone's share sheet
   where there is one, otherwise the link is copied; `404.html` renders the post for an `e/<id>`
   that isn't published yet, so a shared link never lands on a blank page. *Attach the flyer as a picture*
   sends it as MMS instead (more credits per text). *Text a test to <your mobile>* sends the
   same thing to one phone first.
   The old email import keeps running, but the home page
   only shows that block when there are no posts. Flyers from the September 2026 email were
   copied into `img/posts/` (stable names; `img/ann-*` is wiped weekly). Everything is in
   `supabase/posts.sql` and `posts.js`.

8. **Text list.** `syncTextList` in `scripts/announcements.gs` reads the New Member Form
   responses and adds only the people who ticked *agree* on the form's "Automated Messages –
   Terms and conditions" question (and gave a phone number) to the SimpleTexting list
   (`SIMPLETEXTING_LIST`, default "North Point Ward - Notifications"); the form timestamp is kept
   in the contact's comment as the consent record. It skips anyone who replied STOP, never
   removes anyone, and a later "Opt out" answer from the same number cancels an earlier "agree".
   Runs after each sheet sync and from Leaders › Settings → Sync now. The consent wording on the
   form links to `terms.html` and `privacy.html` (texting-only, not linked from the site).

9. **Bishop meeting requests → a text.** `bishop.html` stores the request (`submit_meeting_request`)
   and then pokes the Apps Script web app with just the request id (action `bishop`, no secret —
   the page is public). The script, holding the Leaders passphrase, asks the database to *claim*
   the request (`admin_meeting_request_claim`, `supabase/bishop.sql`): that succeeds once, and
   only for a real request from the last two days, so a repeated or made-up poke can never send a
   second text. It then texts the number in the site setting `bishop_notify_phone` (Leaders ›
   Settings › Bishop meeting requests; blank = off) with the name, phone, email, temple-recommend
   and note. A failed text releases the claim, and `syncMemberSheets` sweeps every 6 hours for any
   recent request that was never texted.

10. **Blind dates** (`supabase/dinner.sql` — the tables, functions and settings keep the `dinner_`
    names from the tool's first version, "dinner with the missionaries"). People sign up on
    `blind-date.html` (name, man/woman, age, mobile, best nights, notes); a leader pairs each with a
    random person of the other gender within the age gap (Leaders › Blind dates — *Pair* proposes
    one, *Try another* / a pick list override it, *Pair everyone I can* does the whole pool); *Send
    both the intro text* texts each of them the other's first name and number (setting
    `dinner_intro_sms`, single-number path through the Apps Script); then the pair is marked
    scheduled (with the date) and done, or cancelled (both back in the pool). The **switch** at the
    top of the tab is the setting `dinner_enabled`: off, `blind-date.html` says sign-ups are closed,
    `dinner_signup()` refuses, and the home-page card disappears — pairs in motion are untouched. A
    number that signs up again while waiting/paired updates its row rather than adding one;
    `times_paired` and "waiting a while" (3 weeks) help spread the turns; the tab badge counts
    people waiting. An intro text still written for the missionary dinners is swapped for the
    blind-date wording the first time the tab loads.

11. **Building cleaning** (`supabase/cleaning.sql`). Leaders › Service → *Add a Saturday* (date, time,
    helpers wanted) makes a **post** first — so the Saturday is in the home-page lineup, the weekly
    email, the ward calendar and can get a text reminder like any event — then the `cleaning_dates`
    row pointing at it; *Remove Saturday* deletes both. `cleaning.html` shows a month grid with the
    cleaning Saturdays marked, one card per date (time, helpers wanted, who's on as "First L.",
    add-to-calendar) and a sheet that takes any name — the person's own or someone they called and
    asked, with *Signing someone else up? Your name* recorded as `added_by`; a duplicate name on the
    same date is refused. Leaders see full names, phones and who added whom, add names themselves,
    and remove sign-ups. Defaults (time, helpers, location) are settings `cleaning_*`. The home
    page's *Sign up* section shows the card whenever a Saturday is coming, with the next date and
    how many more helpers it wants.

12. **Feed the missionaries** (`supabase/meals.sql`). `meals.html`: pick a companionship — the
    Elders, the North Sisters, the South Sisters — then an open day on a calendar of the next
    `meals_days_ahead` days (42 by default); a taken day shows who has it. One booked meal per
    companionship per day. The rules are on the page and enforced by `meals_signup()`: a brother
    taking either set of sisters out names the sister coming along, and each set of sisters is fed
    in its own area (the area text is a setting, shown on the page and in the confirmation). The
    companionship's phone number is shown only to someone who has just booked, with a ready-made
    text. Leaders › Service has the switch (`meals_enabled`), per-companionship on/off, label, area
    and number, the list of upcoming meals (Done / Cancel / Delete — cancelling frees the day) and a
    form for phone sign-ups. The home-page card shows while the switch is on.

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
