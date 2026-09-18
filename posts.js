/*
 * Announcements as posts — shared by the home page (index.html: the list), the public
 * submission page (post.html) and Leaders › Announcements (admin.html: approve / edit / add).
 *
 *   NPPosts.card(post)                    -> <article class="post"> for one post
 *   NPPosts.renderPublic(box, posts)      -> the home-page list: dated events soonest first, then notices
 *   NPPosts.form(initial, opts)           -> { el, values(), validate(), busy() } the add/edit form
 *   NPPosts.compressImage(file)           -> Promise<Blob>  (JPEG, longest side 1600px)
 *   NPPosts.uploadFlyer(blob)             -> Promise<url>   (Supabase storage bucket "flyers")
 *
 * Database side: supabase/posts.sql.
 */
window.NPPosts = (function () {
  const { C, el, linkify, icons } = NP;
  const TZ = C.timeZone || 'America/New_York';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const pin = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const clock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const link = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>';
  const image = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>';

  // ---- dates & times ----
  function dateParts(iso) {           // 'YYYY-MM-DD' -> { dow, day, mon, long } (no time-zone shift)
    if (!iso) return null;
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return { y, m, d, dow: DAYS[dt.getUTCDay()], mon: MONTHS[m - 1], long: `${DAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}` };
  }
  function todayIso() {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function fmtTime(t) {               // '19:00:00' | '19:00' -> '7:00 PM'
    if (!t) return '';
    const [h, m] = String(t).split(':').map(Number);
    const hh = ((h + 11) % 12) + 1;
    return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  function timeRange(p) {
    if (!p.start_time) return '';
    const a = fmtTime(p.start_time), b = p.end_time ? fmtTime(p.end_time) : '';
    if (!b) return a;
    // "7 – 9 PM" when both share the same meridiem
    const same = a.slice(-2) === b.slice(-2);
    return same ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
  }
  function relativeDay(iso) {         // 'Today' / 'Tomorrow' / '' for the date chip
    const t = todayIso(); if (iso === t) return 'Today';
    const [y, m, d] = t.split('-').map(Number); const tm = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    return iso === tm ? 'Tomorrow' : '';
  }

  // ---- one post ----
  function card(p, opts) {
    opts = opts || {};
    const dp = dateParts(p.event_date);
    const when = dp ? [relativeDay(p.event_date) || dp.dow, `${dp.mon} ${dp.d}`, timeRange(p)].filter(Boolean).join(' · ') : '';
    const details = String(p.details || '').trim();
    const body = el('div', { class: 'post-body' }, [
      dp ? el('div', { class: 'post-when' + (relativeDay(p.event_date) ? ' soon' : '') }, [el('span', { class: 'ic', html: clock }), when]) : null,
      el('h3', { class: 'post-title' }, p.title),
      p.location ? el('div', { class: 'post-where' }, [el('span', { class: 'ic', html: pin }), p.location]) : null,
      details ? el('div', { class: 'post-details', html: linkify(details) }) : null,
      p.link ? el('a', { class: 'post-link', href: p.link, target: '_blank', rel: 'noopener' }, [el('span', { class: 'ic', html: link }), linkLabel(p.link)]) : null,
      opts.footer || null,
    ]);
    const art = el('article', { class: 'post' + (p.flyer_url ? ' has-flyer' : ''), 'data-id': p.id }, [
      p.flyer_url ? el('a', { class: 'post-flyer', href: p.flyer_url, target: '_blank', rel: 'noopener', title: 'Open the flyer' }, el('img', { src: p.flyer_url, alt: p.title + ' flyer', loading: 'lazy' })) : null,
      body,
    ]);
    // long details start folded
    if (details.length > 260 || details.split('\n').length > 5) {
      const d = body.querySelector('.post-details'); d.classList.add('folded');
      const more = el('button', { class: 'post-more', type: 'button', onclick: () => { d.classList.toggle('folded'); more.textContent = d.classList.contains('folded') ? 'Read more' : 'Show less'; } }, 'Read more');
      d.after(more);
    }
    return art;
  }
  function linkLabel(url) {
    try { const u = new URL(url); const h = u.hostname.replace(/^www\./, ''); return /forms\.gle|docs\.google\.com\/forms|signup|rsvp/i.test(url) ? 'Sign up' : /eventbrite|meetup/i.test(h) ? 'Tickets & details' : 'More info · ' + h; }
    catch (e) { return 'More info'; }
  }

  // ---- the home page list ----
  function renderPublic(box, posts) {
    box.innerHTML = '';
    const dated = posts.filter(p => p.event_date), undated = posts.filter(p => !p.event_date);
    if (!posts.length) { box.appendChild(el('p', { class: 'empty' }, 'Nothing posted yet — check back soon, or add something below.')); return; }
    if (dated.length) {
      const list = el('div', { class: 'post-list' });
      let lastMonth = '';
      for (const p of dated) {
        const dp = dateParts(p.event_date); const key = `${dp.y}-${dp.m}`;
        if (key !== lastMonth) { list.appendChild(el('h4', { class: 'post-month' }, `${MONTHS[dp.m - 1]} ${dp.y}`.replace(/^(\w+) (\d+)$/, (s, mo, y) => y === String(new Date().getFullYear()) ? mo : s))); lastMonth = key; }
        list.appendChild(card(p));
      }
      box.appendChild(list);
    }
    if (undated.length) {
      box.appendChild(el('h4', { class: 'post-month' }, 'Announcements'));
      const list = el('div', { class: 'post-list' }); undated.forEach(p => list.appendChild(card(p))); box.appendChild(list);
    }
  }

  // ---- images ----
  // Shrink a photo/flyer in the browser: longest side 1600px, JPEG. Keeps uploads small and strips
  // EXIF. Falls back to the original file if the browser can't decode it.
  async function compressImage(file, maxPx, quality) {
    maxPx = maxPx || 1600; quality = quality || 0.86;
    if (!/^image\//.test(file.type)) throw new Error('Please choose an image (JPEG, PNG or HEIC from your camera roll).');
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      // Safari < 17 / HEIC: go through an <img>
      bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('That image could not be read — try a JPEG or PNG.')); im.src = URL.createObjectURL(file); });
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const scale = Math.min(1, maxPx / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(bmp, 0, 0, cw, ch);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not process that image');
    return blob;
  }
  async function uploadFlyer(blob) {
    const name = 'uploads/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '.jpg';
    const r = await fetch(`${C.supabaseUrl}/storage/v1/object/flyers/${name}`, {
      method: 'POST', body: blob,
      headers: { apikey: C.supabaseAnonKey, Authorization: `Bearer ${C.supabaseAnonKey}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'cache-control': '31536000' },
    });
    if (!r.ok) { let m = `${r.status}`; try { const j = await r.json(); m = j.message || j.error || m; } catch (e) {} throw new Error(/bucket|not found|row-level|policy/i.test(m) ? 'Flyer uploads are not set up yet (run supabase/posts.sql) — ' + m : 'Upload failed: ' + m); }
    return `${C.supabaseUrl}/storage/v1/object/public/flyers/${name}`;
  }

  // ---- the add / edit form (public submission and leaders share it) ----
  // initial: a post row (or {}); opts.askWho: show name + contact fields (public form);
  // opts.submitLabel; values() returns the RPC-ready fields; validate() returns an error string or ''.
  function form(initial, opts) {
    initial = initial || {}; opts = opts || {};
    const $f = {};
    const field = (key, label, input, hint) => el('div', { class: 'field' }, [el('label', { for: 'pf-' + key }, [label, hint ? el('span', { class: 'opt' }, ' ' + hint) : null]), input]);
    const inp = (key, attrs) => { const n = el('input', Object.assign({ id: 'pf-' + key }, attrs)); $f[key] = n; return n; };
    const ta = (key, attrs) => { const n = el('textarea', Object.assign({ id: 'pf-' + key }, attrs)); $f[key] = n; return n; };
    const t5 = t => t ? String(t).slice(0, 5) : '';

    // flyer picker with preview
    let flyerUrl = initial.flyer_url || '', flyerBlob = null, flyerBusy = false;
    const preview = el('img', { class: 'flyer-preview', alt: '', hidden: flyerUrl ? null : '', src: flyerUrl || '' });
    const flyerMsg = el('span', { class: 'muted small' }, flyerUrl ? 'Flyer attached.' : 'Optional — a photo or image of the flyer. Portrait works best.');
    const fileIn = el('input', { type: 'file', accept: 'image/*', id: 'pf-flyer-file', style: 'display:none' });
    const pickBtn = el('button', { class: 'btn small secondary', type: 'button', onclick: () => fileIn.click() }, [el('span', { class: 'ic', html: image }), flyerUrl ? 'Change flyer' : 'Add a flyer']);
    const removeBtn = el('button', { class: 'btn small secondary', type: 'button', hidden: flyerUrl ? null : '', onclick: () => { flyerUrl = ''; flyerBlob = null; preview.hidden = true; preview.src = ''; removeBtn.hidden = true; pickBtn.lastChild.textContent = 'Add a flyer'; flyerMsg.textContent = 'Flyer removed.'; } }, 'Remove');
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0]; if (!f) return;
      flyerBusy = true; flyerMsg.textContent = 'Preparing the image…';
      try {
        flyerBlob = await compressImage(f);
        preview.src = URL.createObjectURL(flyerBlob); preview.hidden = false; removeBtn.hidden = false; pickBtn.lastChild.textContent = 'Change flyer';
        flyerUrl = '';   // uploaded on submit
        flyerMsg.textContent = `Ready (${Math.round(flyerBlob.size / 1024)} KB) — it uploads when you ${opts.submitLabel ? opts.submitLabel.toLowerCase() : 'submit'}.`;
      } catch (e) { flyerBlob = null; flyerMsg.textContent = e.message; }
      flyerBusy = false; fileIn.value = '';
    });

    const root = el('div', { class: 'post-form' }, [
      field('title', 'Title', inp('title', { type: 'text', maxlength: 120, placeholder: 'FHE at the park', value: initial.title || '', autocomplete: 'off' })),
      field('date', 'Date', inp('date', { type: 'date', value: initial.event_date ? String(initial.event_date).slice(0, 10) : '' }), '(leave blank for a general notice)'),
      el('div', { class: 'inline wrap2' }, [
        field('start', 'Starts', inp('start', { type: 'time', value: t5(initial.start_time) }), '(optional)'),
        field('end', 'Ends', inp('end', { type: 'time', value: t5(initial.end_time) }), '(optional)'),
      ]),
      field('location', 'Where', inp('location', { type: 'text', maxlength: 200, placeholder: 'Roswell building · 500 Norcross St', value: initial.location || '' }), '(optional)'),
      field('details', 'Details', ta('details', { rows: 5, maxlength: 3000, placeholder: 'What, who it’s for, what to bring…' }), '(optional)'),
      field('link', 'Link', inp('link', { type: 'url', maxlength: 500, placeholder: 'https://… sign-up form or more info', value: initial.link || '', inputmode: 'url' }), '(optional)'),
      el('div', { class: 'field' }, [
        el('label', {}, 'Flyer'),
        el('div', { class: 'flyer-box' }, [preview, el('div', { class: 'flyer-controls' }, [el('div', { class: 'inline' }, [pickBtn, removeBtn]), flyerMsg]), fileIn]),
      ]),
      opts.askWho ? el('div', { class: 'inline wrap2' }, [
        field('name', 'Your name', inp('name', { type: 'text', maxlength: 80, autocomplete: 'name', value: initial.submitted_name || '' })),
        field('contact', 'Your email or phone', inp('contact', { type: 'text', maxlength: 120, autocomplete: 'email', placeholder: 'So a leader can reach you with questions', value: initial.submitted_contact || '' })),
      ]) : null,
      // honeypot — hidden from people, filled by bots
      opts.askWho ? el('div', { style: 'position:absolute;left:-9999px;top:-9999px', 'aria-hidden': 'true' }, inp('website', { type: 'text', tabindex: -1, autocomplete: 'off', placeholder: 'Leave this empty' })) : null,
    ]);
    $f.details.value = initial.details || '';

    function values() {
      const v = k => ($f[k] ? $f[k].value : '').trim();
      return {
        title: v('title'), details: $f.details.value.trim(), event_date: v('date') || null, start_time: v('start') || null, end_time: v('end') || null,
        location: v('location'), link: v('link'), flyer_url: flyerUrl, name: v('name'), contact: v('contact'), website: v('website'),
      };
    }
    function validate() {
      const x = values();
      if (x.title.length < 3) return 'Please give it a title.';
      if (x.link && !/^https?:\/\//i.test(x.link)) return 'The link needs to start with http:// or https://';
      if (x.start_time && x.end_time && x.end_time < x.start_time) return 'The end time is before the start time.';
      if (opts.askWho && x.name.length < 2) return 'Please add your name.';
      if (opts.askWho && x.contact.length < 5) return 'Please add an email or phone number so a leader can reach you.';
      if (flyerBusy) return 'The flyer is still being prepared — one moment.';
      return '';
    }
    // upload the picked flyer (if any) and return the values with flyer_url filled in
    async function finalize() {
      if (flyerBlob) { flyerMsg.textContent = 'Uploading the flyer…'; flyerUrl = await uploadFlyer(flyerBlob); flyerBlob = null; flyerMsg.textContent = 'Flyer uploaded.'; }
      return values();
    }
    return { el: root, values, validate, finalize, focus: () => $f.title.focus(), fields: $f };
  }

  return { card, renderPublic, form, compressImage, uploadFlyer, fmtTime, timeRange, dateParts, todayIso };
})();
