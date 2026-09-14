/**
 * North Point YSA — publish the weekly announcements email to northpointysa.com
 *
 * Runs inside Google Apps Script under Joseph's Google account (script.google.com), so it can
 * read the "Northpoint YSA Ward Weekly Announcements" email — attachments included — and commit
 * announcements.json + the flyer files to the GitHub repo that serves the site.
 *
 * One-time setup (about 3 minutes):
 *   1. script.google.com → New project → name it "NPYSA announcements" → replace the editor
 *      contents with this file → Save.
 *   2. Project Settings (gear) → Script properties → Add properties:
 *        GITHUB_TOKEN  = the fine-grained GitHub token (Contents: read/write on the repo)
 *        SUPABASE_URL  = https://utkbhlyvmfbtjyfqeoze.supabase.co
 *        SUPABASE_KEY  = the publishable (anon) key from config.js
 *        ADMIN_PASS    = the Leaders passphrase (so the text lands in the editable copy too)
 *   3. Back in the editor, pick `publishAnnouncements` in the function dropdown → Run.
 *      Approve the Gmail + "connect to external service" permissions the first time.
 *      The execution log shows what it published.
 *   4. Triggers (clock icon) → Add trigger → publishAnnouncements · Time-driven ·
 *      Week timer · Every Sunday · 9pm to 10pm → Save.
 *
 * Leaders › Callings (the members-without-callings meeting tool) — same project:
 *   5. Function dropdown → `syncMemberSheets` → Run once (approve the Sheets permission). It
 *      copies the "Members without Callings" doc and the "New Member Form (Responses)" sheet
 *      into the site's database (needs SUPABASE_URL / SUPABASE_KEY / ADMIN_PASS from step 2).
 *   6. Triggers → Add trigger → syncMemberSheets · Time-driven · Hour timer · Every 6 hours.
 *      The same run also writes any edits leaders made on the site (Leaders › Callings → Edit)
 *      into the "Members without Callings" sheet — only the meeting columns (proposed calling,
 *      who texts, texted, answer, sustained, other notes); people not on the sheet get a new row.
 *      Needs supabase/edits.sql.
 *   7. "Refresh from Google Sheets" button + sending Warning / Magnet messages from the site:
 *      Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone → Deploy,
 *      copy the web-app URL into `sheetsRefreshUrl` in config.js. The endpoint only does
 *      anything when a signed-in leader's token (or the passphrase) is sent with the request.
 *   8. Texts: Script properties → SIMPLETEXTING_KEY = an API key from SimpleTexting
 *      (Settings → API), and SIMPLETEXTING_NUMBER = the ward texting number (digits only).
 *      Emails go from this Google account (GmailApp); the wording lives under Leaders › Settings.
 *
 * Each run: finds the newest announcements email from the last 8 days (Trash included, since
 * those get deleted regularly), turns the body into clean text, uploads every image/PDF
 * attachment as img/ann-<date>-N.<ext>, removes last week's files, writes announcements.json,
 * then labels the email "NPYSA/Announcements" and archives it (unless it is already in Trash).
 * It is idempotent: running it twice on the same email does nothing the second time.
 */

const REPO = 'Josephmt95/NorthPointYSA';
const BRANCH = 'main';
const SEARCH = 'from:noreply-lcr@mail.churchofjesuschrist.org subject:"Weekly Announcements" newer_than:8d in:anywhere';
const LABEL = 'NPYSA/Announcements';
const MIN_IMAGE_BYTES = 3000;   // skip tracking pixels / signature icons

function publishAnnouncements() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Add GITHUB_TOKEN under Project Settings → Script properties');

  // 1. newest matching message
  let latest = null;
  GmailApp.search(SEARCH, 0, 10).forEach(function (t) {
    t.getMessages().forEach(function (m) { if (!latest || m.getDate() > latest.getDate()) latest = m; });
  });
  if (!latest) { Logger.log('No announcements email in the last 8 days — nothing to do.'); return; }
  const msgId = latest.getId();
  Logger.log('Found: "%s" from %s', latest.getSubject(), latest.getDate());

  // 2. already published?
  const existing = ghGet_(token, 'announcements.json');
  if (existing && existing.content) {
    try {
      const prev = JSON.parse(Utilities.newBlob(Utilities.base64Decode(existing.content.replace(/\n/g, ''))).getDataAsString('UTF-8'));
      if (prev.message_id === msgId) { Logger.log('That email is already on the site — nothing to do.'); return; }
    } catch (e) { /* fall through and republish */ }
  }

  // 3. body → text
  const text = cleanText_(htmlToText_(latest.getBody() || '') || latest.getPlainBody() || '');

  // 4. attachments → repo files
  const stamp = Utilities.formatDate(latest.getDate(), 'America/New_York', 'yyyy-MM-dd');
  const images = [], files = [], keep = {};
  let n = 0;
  latest.getAttachments({ includeInlineImages: true, includeAttachments: true }).forEach(function (att) {
    const type = (att.getContentType() || '').toLowerCase();
    const bytes = att.getBytes();
    const isImage = type.indexOf('image/') === 0, isPdf = type === 'application/pdf';
    if (!isImage && !isPdf) return;
    if (isImage && bytes.length < MIN_IMAGE_BYTES) return;
    n += 1;
    const ext = isPdf ? 'pdf' : ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[type] || 'bin');
    const path = 'img/ann-' + stamp + '-' + n + '.' + ext;
    const name = (att.getName() || ('Attachment ' + n)).replace(/\.[A-Za-z0-9]+$/, '');
    ghPut_(token, path, Utilities.base64Encode(bytes), 'Announcements ' + stamp + ': ' + name);
    keep[path] = true;
    (isPdf ? files : images).push({ path: path, name: name });
  });

  // 5. drop last week's files
  const dir = ghGet_(token, 'img');
  if (Array.isArray(dir)) {
    dir.forEach(function (f) {
      if (f.type === 'file' && /^ann-/.test(f.name) && !keep['img/' + f.name]) ghDelete_(token, 'img/' + f.name, f.sha, 'Remove old flyer ' + f.name);
    });
  }

  // 6. announcements.json
  const data = {
    subject: latest.getSubject(),
    sent_at: latest.getDate().toISOString(),
    updated_at: new Date().toISOString(),
    message_id: msgId,
    text: text,
    images: images,
    files: files,
  };
  ghPut_(token, 'announcements.json', Utilities.base64Encode(JSON.stringify(data, null, 2), Utilities.Charset.UTF_8), 'Announcements for ' + stamp, existing && existing.sha);

  // 6b. the editable copy the site actually shows (Leaders → Announcements). Optional but recommended.
  const props = PropertiesService.getScriptProperties();
  const sbUrl = props.getProperty('SUPABASE_URL'), sbKey = props.getProperty('SUPABASE_KEY'), adminPass = props.getProperty('ADMIN_PASS');
  if (sbUrl && sbKey && adminPass) {
    const res = UrlFetchApp.fetch(sbUrl + '/rest/v1/rpc/admin_publish_announcements', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey },
      payload: JSON.stringify({ p_pass: adminPass, p_text: text, p_images: images, p_files: files, p_subject: data.subject, p_sent_at: data.sent_at, p_message_id: msgId, p_source: 'email' }),
    });
    if (res.getResponseCode() >= 300) Logger.log('Supabase publish failed: %s %s', res.getResponseCode(), res.getContentText().slice(0, 200));
    else Logger.log('Supabase announcements row: %s', res.getContentText());
  } else {
    Logger.log('SUPABASE_URL / SUPABASE_KEY / ADMIN_PASS not set — site will use announcements.json until leaders save a copy.');
  }

  // 7. tidy the inbox
  if (!latest.isInTrash()) {
    const label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
    const thread = latest.getThread();
    thread.addLabel(label);
    thread.moveToArchive();
  }
  Logger.log('Published %s chars of text, %s images, %s files for %s.', text.length, images.length, files.length, stamp);
}

// ---------- Leaders › Callings: mirror the two leadership sheets into the database ----------

// The sheets, by spreadsheet ID. `tab` is the sheet/tab name (null = first tab); `key` is what
// the site reads (supabase/sheets.sql → admin_sheets).
const MEMBER_SHEETS = [
  { key: 'callings',            id: '1PMS3f4ncGaeIhJJ9ZaVAbOgA0kUTBnMOWgpvhKgMbe8', tab: null,                 title: 'Members without callings' },
  { key: 'callings_committees', id: '1PMS3f4ncGaeIhJJ9ZaVAbOgA0kUTBnMOWgpvhKgMbe8', tab: 'Committee Requests', title: 'Committee requests' },
  { key: 'newmember',           id: '1OyPHy_STcN-Nbh_OiPVIiSIu16cq1gxvs1ffzgePLlA', tab: 'Form Responses 1',   title: 'New member form' },
];

function syncMemberSheets() {
  const props = PropertiesService.getScriptProperties();
  const sbUrl = props.getProperty('SUPABASE_URL'), sbKey = props.getProperty('SUPABASE_KEY'), adminPass = props.getProperty('ADMIN_PASS');
  if (!sbUrl || !sbKey || !adminPass) throw new Error('Set SUPABASE_URL, SUPABASE_KEY and ADMIN_PASS under Project Settings → Script properties');
  const result = {};
  // 0. edits made on the Leaders page go into the callings sheet first, so the copy below has them
  try { result.written = writePendingEdits_(sbUrl, sbKey, adminPass); } catch (e) { Logger.log('Writing edits failed: %s', e && e.message); result.writeError = String(e && e.message); }

  MEMBER_SHEETS.forEach(function (s) { result[s.key] = pullSheet_(s, sbUrl, sbKey, adminPass); });
  return result;
}

// One Google Sheet tab → the `sheets` table (display values = exactly what leaders see: dates as
// text, no formulas). Returns the row count, or -1 when the tab is missing.
function pullSheet_(s, sbUrl, sbKey, adminPass) {
  const ss = SpreadsheetApp.openById(s.id);
  const sheet = s.tab ? ss.getSheetByName(s.tab) : ss.getSheets()[0];
  if (!sheet) { Logger.log('Tab "%s" not found in %s — skipped', s.tab, ss.getName()); return -1; }
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return 0;
  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i].slice(0, headers.length).map(function (v) { return String(v == null ? '' : v).trim(); });
    while (r.length < headers.length) r.push('');
    if (r.some(function (v) { return v; })) rows.push(r);
  }
  const url = 'https://docs.google.com/spreadsheets/d/' + s.id + '/edit#gid=' + sheet.getSheetId();
  const res = UrlFetchApp.fetch(sbUrl + '/rest/v1/rpc/admin_replace_sheet', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey },
    payload: JSON.stringify({ p_pass: adminPass, p_key: s.key, p_title: s.title, p_source_url: url, p_headers: headers, p_rows: rows, p_by: 'apps-script' }),
  });
  if (res.getResponseCode() >= 300) throw new Error(s.key + ': Supabase said ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  Logger.log('%s: %s rows, %s columns', s.key, rows.length, headers.length);
  return rows.length;
}

// Edits saved on the Leaders page (supabase/edits.sql) → the "Members without Callings" sheet.
// Finds each person's row by NAME (exact, then ignoring anything in parentheses / accents),
// appends a new row when they are not on the sheet yet, writes only the edited columns, then
// tells the database those edits are in. A blank edit never overwrites something already in the
// sheet (only an explicit clear from the site — stored as null — empties a cell). Pass onlyNames
// to write just those people (the "Save to sheet" button on a slide). Returns how many were written.
function writePendingEdits_(sbUrl, sbKey, adminPass, onlyNames) {
  const res = UrlFetchApp.fetch(sbUrl + '/rest/v1/rpc/admin_callings_pending', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey }, payload: JSON.stringify({ p_pass: adminPass }),
  });
  if (res.getResponseCode() === 404) return 0;  // edits.sql not run yet
  if (res.getResponseCode() >= 300) throw new Error('admin_callings_pending ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 120));
  let pending = JSON.parse(res.getContentText() || '[]');
  if (onlyNames) { const want = onlyNames.map(function (n) { return String(n).trim().toLowerCase(); }); pending = pending.filter(function (e) { return want.indexOf(String(e.name).trim().toLowerCase()) >= 0; }); }
  if (!pending.length) return 0;
  const asOf = new Date().toISOString();

  const cfg = MEMBER_SHEETS.filter(function (s) { return s.key === 'callings'; })[0];
  const ss = SpreadsheetApp.openById(cfg.id);
  const sheet = cfg.tab ? ss.getSheetByName(cfg.tab) : ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h || '').trim(); });
  // columns the site can write; "Flag" and "Flag sent" are added to the sheet the first time they are needed
  const col = function (name) {
    let i = headers.indexOf(name);
    if (i < 0) {
      if (name !== 'Flag' && name !== 'Flag sent') throw new Error('column "' + name + '" not found on the sheet');
      i = headers.length; headers.push(name); sheet.getRange(1, i + 1).setValue(name).setFontWeight('bold');
    }
    return i + 1;
  };
  const nameCol = col('NAME');
  const norm = function (s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim(); };
  const rowOf = function (name) {
    const exact = String(name).trim().toLowerCase(), loose = norm(name);
    for (let r = 1; r < data.length; r++) if (String(data[r][nameCol - 1] || '').trim().toLowerCase() === exact) return r + 1;
    for (let r = 1; r < data.length; r++) if (norm(data[r][nameCol - 1]) === loose && loose) return r + 1;
    return 0;
  };
  const done = [];
  // deletions last, bottom-up, so row numbers stay valid
  const toDelete = [];
  pending.forEach(function (e) {
    if (e.deleted) { const r = rowOf(e.name); if (r) toDelete.push(r); else Logger.log('delete: %s not on the sheet (already gone)', e.name); done.push(e.name); return; }
    let row = rowOf(e.name);
    if (!row) { row = sheet.getLastRow() + 1; sheet.getRange(row, nameCol).setValue(e.name); data.push([]); }
    Object.keys(e.edits || {}).forEach(function (k) {
      const v = e.edits[k], c = col(k), current = String((data[row - 1] || [])[c - 1] == null ? '' : (data[row - 1] || [])[c - 1]).trim();
      if (v === null) { sheet.getRange(row, c).clearContent(); return; }          // cleared on purpose on the site
      if (String(v).trim() === '' && current) { Logger.log('%s / %s: blank edit kept "%s"', e.name, k, current); return; }
      sheet.getRange(row, c).setValue(v);
    });
    done.push(e.name);
    Logger.log('sheet row %s ← %s: %s', row, e.name, JSON.stringify(e.edits));
  });
  toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { Logger.log('deleting sheet row %s (%s)', r, data[r - 1][nameCol - 1]); sheet.deleteRow(r); });
  SpreadsheetApp.flush();
  const mark = UrlFetchApp.fetch(sbUrl + '/rest/v1/rpc/admin_callings_mark_synced', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey }, payload: JSON.stringify({ p_pass: adminPass, p_names: done, p_as_of: asOf }),
  });
  if (mark.getResponseCode() >= 300) throw new Error('admin_callings_mark_synced ' + mark.getResponseCode());
  return done.length;
}

// Web app entry point for the Leaders page (see setup step 7). Body is JSON with the Leaders
// passphrase or session token as "pass" and an "action":
//   sheets → write every pending edit to the callings sheet, then re-copy all sheets  {"ok":true,"written":2,"callings":130,…}
//   save   → one person's pending edits ("name") to the sheet, re-copy the callings sheet
//   notify → send a Warning / Magnet text + email (sendFlagMessage_)
function doPost(e) {
  const out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!isLeader_(body.pass)) return out({ ok: false, error: 'not authorized' });
    if (body.action === 'notify') return out(sendFlagMessage_(body));
    if (body.action === 'save') {  // one person's edits → the sheet now (the "Save to sheet" button on a slide)
      const props = PropertiesService.getScriptProperties();
      const sbUrl = props.getProperty('SUPABASE_URL'), sbKey = props.getProperty('SUPABASE_KEY'), adminPass = props.getProperty('ADMIN_PASS');
      const written = writePendingEdits_(sbUrl, sbKey, adminPass, [String(body.name || '')]);
      const cfg = MEMBER_SHEETS.filter(function (s) { return s.key === 'callings'; })[0];
      const rows = pullSheet_(cfg, sbUrl, sbKey, adminPass);
      return out({ ok: true, written: written, callings: rows });
    }
    if (body.action !== 'sheets') return out({ ok: false, error: 'unknown action' });
    const r = syncMemberSheets(); r.ok = true;
    return out(r);
  } catch (err) { return out({ ok: false, error: String(err && err.message || err) }); }
}
function doGet() { return ContentService.createTextOutput('ok'); }

// Warning / Magnet message from a person's slide: a text through SimpleTexting (script
// property SIMPLETEXTING_KEY = an API key from SimpleTexting → Settings → API; optional
// SIMPLETEXTING_NUMBER = the ward's texting number, digits only) and/or an email from this
// Google account. The page sends the already-filled-in wording, so it is exactly what the leader
// saw in the confirmation box. Returns { ok, sms: 'sent'|'skipped'|'failed', email: … }.
function sendFlagMessage_(b) {
  const props = PropertiesService.getScriptProperties();
  const res = { ok: true, sms: 'skipped', email: 'skipped' };
  const phone = String(b.phone || '').replace(/\D/g, '');
  if (phone && b.sms) {
    const key = props.getProperty('SIMPLETEXTING_KEY');
    if (!key) { res.sms = 'failed'; res.error = 'SIMPLETEXTING_KEY is not set in Script properties'; }
    else {
      const payload = { contactPhone: phone.length === 10 ? '1' + phone : phone, mode: 'AUTO', text: b.sms };
      const from = props.getProperty('SIMPLETEXTING_NUMBER'); if (from) payload.accountPhone = from.replace(/\D/g, '');
      const r = UrlFetchApp.fetch('https://api-app2.simpletexting.com/v2/api/messages', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + key }, payload: JSON.stringify(payload),
      });
      if (r.getResponseCode() < 300) res.sms = 'sent';
      else { res.sms = 'failed'; res.error = 'SimpleTexting ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200); }
      Logger.log('SimpleTexting → %s: %s %s', phone, r.getResponseCode(), r.getContentText().slice(0, 200));
    }
  }
  if (b.email && b.body) {
    try {
      const opts = { name: b.fromName || 'North Point YSA Ward' };
      if (b.replyTo) opts.replyTo = b.replyTo;
      GmailApp.sendEmail(b.email, b.subject || 'North Point YSA', b.body, opts);
      res.email = 'sent';
    } catch (e) { res.email = 'failed'; res.error = (res.error ? res.error + '; ' : '') + 'email: ' + (e && e.message); }
  }
  res.ok = res.sms !== 'failed' && res.email !== 'failed' && (res.sms === 'sent' || res.email === 'sent');
  if (!res.ok && !res.error) res.error = 'nothing to send (no phone/text or email/body)';
  return res;
}

// The Leaders page sends its 12-hour session token, not the passphrase, so ask the database
// whether it is valid (any admin function will do). The passphrase itself is accepted too.
function isLeader_(pass) {
  if (!pass) return false;
  const props = PropertiesService.getScriptProperties();
  if (pass === props.getProperty('ADMIN_PASS')) return true;
  const sbUrl = props.getProperty('SUPABASE_URL'), sbKey = props.getProperty('SUPABASE_KEY');
  if (!sbUrl || !sbKey) return false;
  const res = UrlFetchApp.fetch(sbUrl + '/rest/v1/rpc/admin_notes_count', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: sbKey, Authorization: 'Bearer ' + sbKey }, payload: JSON.stringify({ p_pass: pass }),
  });
  return res.getResponseCode() < 300;
}

// ---------- helpers ----------

function htmlToText_(h) {
  h = h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n');
  h = h.replace(/<li[^>]*>/gi, '• ');
  h = h.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, function (m, href, inner) {
    const label = inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    href = href.replace(/&amp;/g, '&');
    if (/^mailto:/i.test(href)) return label;
    return label && href.indexOf(label) === -1 ? label + ' ' + href : href;
  });
  h = h.replace(/<[^>]+>/g, '');
  h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  h = h.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return h.trim();
}

function cleanText_(t) {
  t = t.replace(/\n-{5,}\s*\nYou received this email because[\s\S]*$/, '');
  t = t.replace(/\nYou received this email because[\s\S]*$/, '');
  t = t.replace(/^(The Church of Jesus Christ of Latter-day Saints\s*\n+)?(North ?Point YSA Ward\s*\n+)?/i, '');
  return t.trim();
}

function ghFetch_(token, method, path, payload) {
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/contents/' + path + (method === 'get' ? '?ref=' + BRANCH : ''), {
    method: method,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    contentType: 'application/json',
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 404 && method === 'get') return null;
  if (code >= 300) throw new Error('GitHub ' + method + ' ' + path + ' → ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}
function ghGet_(token, path) { return ghFetch_(token, 'get', path); }
function ghPut_(token, path, base64, message, sha) {
  if (!sha) { const cur = ghGet_(token, path); if (cur && cur.sha) sha = cur.sha; }
  const body = { message: message, content: base64, branch: BRANCH };
  if (sha) body.sha = sha;
  return ghFetch_(token, 'put', path, body);
}
function ghDelete_(token, path, sha, message) { return ghFetch_(token, 'delete', path, { message: message, sha: sha, branch: BRANCH }); }
