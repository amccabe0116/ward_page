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
