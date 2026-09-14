/*
 * Leaders › Callings — the "members without callings" meeting tool.
 *
 * Reads what is mirrored into the database (supabase/sheets.sql):
 *   lcr_callings – LCR's "Members without Callings" custom report: the base list (who is without
 *                  a calling right now, with age, city, phone, email, recommend, RM, move-in date)
 *   callings     – the leaders' "Members without Callings" Google Sheet: the NOTES (proposed
 *                  calling, who texts, answer, sustained, warnings…), attached to each LCR person
 *   newmember    – the "New Member Form" responses (how each person moved into the ward)
 * matches each person to the LCR roll (for attendance), and shows it two ways:
 *   • a list you can filter/search and click into
 *   • a meeting deck: one person per slide, ← → to move through everyone
 *
 * admin.html calls NPCallings.init({ getPass, getMembers }) once the leader is signed in.
 */
window.NPCallings = (function () {
  const { C, rpc, el, toast, fmtDate, escapeHtml } = NP;
  const $ = id => document.getElementById(id);

  let ctx = null;
  let sheets = {};           // key -> { headers, rows, updated_at, source_url, title }
  let people = [];           // built from the callings sheet, in sheet order
  let view = [];             // people after filter + search
  let attendance = new Map();// member_id -> Map(date -> Set(class))
  let sundays = [];          // last N Sundays, oldest → newest (YYYY-MM-DD)
  let filter = 'all', query = '', deckAt = -1, loaded = false, loading = null;

  // ---------- helpers ----------
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\(.*?\)/g, ' ').replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();
  const truthy = v => !!String(v || '').trim();
  const yes = v => /^\s*y(es)?\b/i.test(String(v || ''));
  function lev(a, b) {
    const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function parseDate(s) {
    if (!s) return null;
    const d = new Date(String(s).trim());
    return isNaN(d) ? null : d;
  }
  const fmtShort = d => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  function rowObj(sheet, row) { const o = {}; sheet.headers.forEach((h, i) => { if (h) o[h] = row[i] || ''; }); return o; }
  function col(o, re) { const k = Object.keys(o).find(h => re.test(h)); return k ? o[k] : ''; }

  function lastSundays(n) {
    const out = []; let d = NP.currentMeetingDate();
    for (let i = 0; i < n; i++) { out.unshift(d); const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 7); d = t.toISOString().slice(0, 10); }
    return out;
  }

  // ---------- matching people across the three sources ----------
  function buildIndexes(members) {
    // LCR: "Last, First Middle" -> keys "first|last"
    const byKey = new Map(), byLast = new Map();
    // active members first so they win over a same-name record that has left the ward
    for (const m of [...members].sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0))) {
      const [last, rest] = String(m.name).split(/,\s*/);
      const first = norm(rest).split(' ')[0], ln = norm(last);
      if (!first || !ln) continue;
      // multi-word last names ("Orozco Lopez", "Figueroa Duarte") are also findable by either word
      const lasts = new Set([ln, ...ln.split(' ').filter(w => w.length > 2)]);
      for (const l of lasts) {
        if (!byKey.has(first + '|' + l)) byKey.set(first + '|' + l, m);
        if (!byLast.has(l)) byLast.set(l, []);
        byLast.get(l).push({ first, m });
      }
    }
    function findMember(nameVariants) {
      for (const [first, last] of nameVariants) {
        const hit = byKey.get(first + '|' + last); if (hit) return hit;
      }
      for (const [first, last] of nameVariants) {
        const cands = byLast.get(last) || [];
        const close = cands.filter(c => c.first.startsWith(first.slice(0, 3)) || first.startsWith(c.first.slice(0, 3)) || lev(c.first, first) <= 2);
        if (close.length === 1) return close[0].m;
      }
      return null;
    }
    return { findMember };
  }
  // "First [Middle] Last Last" -> every [first, last] split worth trying
  function splits(fullName) {
    const t = norm(fullName).split(' ').filter(Boolean);
    if (t.length < 2) return t.length ? [[t[0], '']] : [];
    const out = [];
    for (let i = 1; i < t.length; i++) out.push([t[0], t.slice(i).join(' ')]);
    out.push([t[0], t[t.length - 1]]);
    return out;
  }

  function build() {
    const members = ctx.getMembers();
    const idx = buildIndexes(members);
    const cs = sheets.callings, ns = sheets.newmember;
    people = [];
    if (!cs) return;

    // new-member form responses grouped by name, newest first
    const forms = new Map();
    if (ns) {
      for (const row of ns.rows) {
        const o = rowObj(ns, row);
        const first = col(o, /^first name/i), last = col(o, /^last name/i), pref = col(o, /^preferred name/i);
        if (!truthy(first) && !truthy(last)) continue;
        const keys = new Set([norm(first).split(' ')[0] + '|' + norm(last)]);
        if (truthy(pref) && !/^(no|n\/a|none)\b/i.test(pref)) keys.add(norm(pref).split(' ')[0] + '|' + norm(last));
        const rec = { o, when: parseDate(col(o, /^timestamp/i)), member: idx.findMember([...keys].map(k => k.split('|'))) };
        for (const k of keys) { if (!forms.has(k)) forms.set(k, []); forms.get(k).push(rec); }
      }
      for (const list of forms.values()) list.sort((a, b) => (b.when || 0) - (a.when || 0));
    }

    // the leaders' sheet rows (notes), keyed so they can be attached to LCR people by name
    const sheetRows = [];
    let section = '';
    cs.rows.forEach((row, i) => {
      const o = rowObj(cs, row);
      const rawName = o.NAME || row[0] || '';
      if (!truthy(rawName)) return;
      const rest = row.slice(1).some(truthy);
      if (!rest && /^new additions/i.test(rawName)) { section = rawName.replace(/^new additions\s*(since)?\s*/i, 'New since '); return; }
      if (!rest && rawName === rawName.toUpperCase() && rawName.length > 12) { section = rawName; return; }
      sheetRows.push({ i, rawName, name: rawName.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim(), tag: (rawName.match(/\((.*?)\)/) || [])[1] || '', section, o, variants: splits(rawName), used: false });
    });
    const findSheetRow = (variants) => {
      for (const [f, l] of variants) { const hit = sheetRows.find(r => !r.used && r.variants.some(([f2, l2]) => f2 === f && l2 === l)); if (hit) return hit; }
      for (const [f, l] of variants) { const hits = sheetRows.filter(r => !r.used && r.variants.some(([f2, l2]) => l2 === l && (f2.startsWith(f.slice(0, 3)) || f.startsWith(f2.slice(0, 3)) || lev(f2, f) <= 2))); if (hits.length === 1) return hits[0]; }
      return null;
    };
    const findForm = (variants, member) => {
      for (const [f, l] of variants) { if (forms.has(f + '|' + l)) return forms.get(f + '|' + l); }
      if (member) { const [last, restName] = String(member.name).split(/,\s*/); return forms.get(norm(restName).split(' ')[0] + '|' + norm(last)) || null; }
      return null;
    };
    const mk = (name, sr, lcr, member, variants) => {
      const o = sr ? sr.o : {};
      const notes = o['Other Notes'] || '';
      const tag = sr ? sr.tag : '';
      return { name, tag, section: sr ? sr.section : '', o, lcr, member, forms: findForm(variants, member) || [], notes, onSheet: !!sr,
        flagged: /warning|warming|move|check|magnet|aged out|unresponsive|declin|hold/i.test(notes) || /moved|aged out|moving/i.test(tag),
        proposed: o['Proposed calling'] || '', assignment: o['text assignment / calling'] || '',
        texted: o['texted'] || '', answer: o['answer'] || '', sustained: o['sustained'] || '' };
    };

    const ls = sheets.lcr_callings;
    if (ls && ls.rows.length) {
      // LCR's report is the truth for WHO is without a calling; the sheet supplies the notes.
      const byUuid = new Map(members.map(m => [m.lcr_uuid, m]));
      for (const row of ls.rows) {
        const l = rowObj(ls, row);
        const lcrName = l['Preferred Name'] || ''; if (!truthy(lcrName)) continue;
        const [last, rest] = lcrName.split(/,\s*/);
        const name = ((rest || '').split(' ')[0] + ' ' + (last || '')).trim();
        const variants = [[norm(rest).split(' ')[0], norm(last)], ...norm(last).split(' ').filter(w => w.length > 2).map(w => [norm(rest).split(' ')[0], w])];
        const member = byUuid.get(l['Person UUID']) || idx.findMember(variants);
        const sr = findSheetRow(variants); if (sr) sr.used = true;
        people.push(mk(name, sr, l, member, variants));
      }
      // people still on the sheet but no longer on LCR's report (got a calling, or moved)
      for (const sr of sheetRows) {
        if (sr.used) continue;
        const member = idx.findMember(sr.variants);
        const p = mk(sr.name, sr, null, member, sr.variants); p.sheetOnly = true; people.push(p);
      }
    } else {
      for (const sr of sheetRows) { const member = idx.findMember(sr.variants); people.push(mk(sr.name, sr, null, member, sr.variants)); }
    }
  }

  function status(p) {
    if (truthy(p.sustained)) return { k: 'ok', t: 'Sustained' };
    if (/accept|^\s*y(es)?\s*$/i.test(p.answer)) return { k: 'ok', t: 'Accepted' };
    if (truthy(p.answer)) return { k: 'need', t: /declin|not at this time|moved|not in ward|undeliverable/i.test(p.answer) ? 'Declined' : 'Answered' };
    if (truthy(p.texted)) return { k: 'wait', t: 'Texted' };
    if (truthy(p.proposed) || truthy(p.assignment)) return { k: 'wait', t: 'Proposed' };
    if (p.flagged) return { k: 'flag', t: 'Flagged' };
    return { k: 'off', t: 'Nothing yet' };
  }
  const FILTERS = {
    all: { label: 'Everyone', test: p => !p.sheetOnly },
    none: { label: 'Nothing proposed', test: p => !p.sheetOnly && !truthy(p.proposed) && !truthy(p.assignment) && !p.flagged },
    waiting: { label: 'Proposed, waiting', test: p => !p.sheetOnly && (truthy(p.proposed) || truthy(p.assignment)) && !truthy(p.sustained) && !/accept/i.test(p.answer) },
    flagged: { label: 'Flagged', test: p => !p.sheetOnly && p.flagged },
    new: { label: 'New / not on sheet', test: p => !p.sheetOnly && (!!p.section || !p.onSheet) },
    sheetOnly: { label: 'On sheet, not in LCR report', test: p => !!p.sheetOnly },
  };

  function attFor(p) {
    const rows = p.member ? attendance.get(p.member.id) : null;
    return sundays.map(d => ({ d, ss: !!(rows && rows.get(d) && rows.get(d).has('sunday_school')), prs: !!(rows && rows.get(d) && rows.get(d).has('priesthood_rs')) }));
  }
  function attDots(p, n) {
    const a = attFor(p).slice(-n);
    return el('span', { class: 'att-dots', title: 'Last ' + n + ' Sundays' }, a.map(x => el('i', { class: 'dot' + (x.ss && x.prs ? ' both' : (x.ss || x.prs ? ' one' : '')), title: fmtDate(x.d, { weekday: undefined }) + (x.ss ? ' · SS' : '') + (x.prs ? ' · P/RS' : '') })));
  }

  // ---------- list view ----------
  function applyFilter() {
    const q = norm(query);
    view = people.filter(p => FILTERS[filter].test(p) && (!q || norm(p.name).includes(q)));
  }
  function renderList() {
    applyFilter();
    const box = $('cal-list'); box.innerHTML = '';
    const chips = $('cal-filters'); chips.innerHTML = '';
    for (const [k, f] of Object.entries(FILTERS)) {
      const n = people.filter(f.test).length;
      chips.appendChild(el('button', { class: 'chip' + (filter === k ? ' on' : ''), onclick: () => { filter = k; renderList(); } }, `${f.label} · ${n}`));
    }
    const cs = sheets.callings;
    const ls = sheets.lcr_callings, when = d => new Date(d).toLocaleString('en-US', { timeZone: C.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    $('cal-meta').textContent = ls ? `${people.filter(p => !p.sheetOnly).length} without a calling · LCR report ${when(ls.updated_at)} · sheet ${cs ? when(cs.updated_at) : '—'}` : (cs ? `${people.length} people · sheet updated ${when(cs.updated_at)}` : '');
    if (!view.length) { box.appendChild(el('p', { class: 'empty' }, people.length ? 'Nobody matches.' : 'No sheet data yet — run supabase/sheets.sql, then refresh the sheets.')); return; }
    const t = el('table', { class: 'grid cal-grid' }, el('thead', {}, el('tr', {}, [el('th', {}, 'Name'), el('th', {}, ''), el('th', {}, 'Calling'), el('th', {}, 'Status'), el('th', {}, 'Last 4'), el('th', {}, 'Form')])));
    const tb = el('tbody');
    view.forEach((p, vi) => {
      const st = status(p);
      const latest = p.forms[0];
      tb.appendChild(el('tr', { class: 'cal-row', tabindex: 0, onclick: () => openDeck(vi), onkeydown: e => { if (e.key === 'Enter') openDeck(vi); } }, [
        el('td', {}, [el('b', {}, p.name), p.section ? el('span', { class: 'pill new' }, 'new') : null, (!p.onSheet && p.lcr) ? el('span', { class: 'pill new' }, 'not on sheet') : null, p.tag ? el('span', { class: 'pill off' }, p.tag) : null]),
        el('td', { class: 'muted' }, p.lcr ? [p.lcr.Age, p.lcr['Address - City']].filter(truthy).join(' · ') : [p.o.AGE, p.o.LOCATION].filter(truthy).join(' · ')),
        el('td', {}, p.proposed ? [p.proposed, p.assignment ? el('span', { class: 'muted' }, ' · ' + p.assignment + ' to text') : null] : (p.notes ? el('span', { class: 'muted' }, p.notes) : '')),
        el('td', {}, el('span', { class: 'pill ' + st.k }, st.t)),
        el('td', {}, p.member && p.member.active ? attDots(p, 4) : el('span', { class: 'muted', title: p.member ? 'This record has left the ward since the sheet was made' : 'Not on the LCR roll any more' }, p.member ? 'moved out' : 'not in LCR')),
        el('td', { class: 'muted' }, latest ? (latest.when ? fmtShort(latest.when) : 'yes') : '—'),
      ]));
    });
    t.appendChild(tb); box.appendChild(t);
  }

  // ---------- meeting deck ----------
  const FORM_LABELS = [
    [/^timestamp/i, 'Filled out'], [/preferred name/i, 'Goes by'], [/birth ?date/i, 'Birthday'], [/phone/i, 'Phone'], [/email/i, 'Email'],
    [/live with your family/i, 'Lives with family'], [/have a car/i, 'Has a car'], [/current address/i, 'Address'], [/help getting to church/i, 'Needs a ride'],
    [/how long do you plan/i, 'Plans to be here'], [/apartment|roommates/i, 'Looking for housing'], [/currently hold a temple recommend/i, 'Temple recommend'],
    [/renew or get a temple/i, 'Wants a recommend'], [/priesthood/i, 'Priesthood'], [/serve a mission/i, 'Mission'], [/why you're here|why you’re here/i, 'Why here'],
    [/hobbies/i, 'Hobbies'], [/upload a current photo/i, 'Photo in LDS Tools'], [/sing or play/i, 'Music'], [/piano|organ/i, 'Piano / organ'], [/attach a current photo/i, 'Photo'],
  ];
  const SKIP_FORM = [/^first name/i, /^last name/i];
  function formLabel(h) { const m = FORM_LABELS.find(([re]) => re.test(h)); return m ? m[1] : h.replace(/\?.*$/, '').slice(0, 40); }
  function dl(pairs) {
    const d = el('dl', { class: 'facts' });
    for (const [k, v, opts] of pairs) {
      if (!truthy(v)) continue;
      const dd = el('dd', {});
      if (opts && opts.tel) dd.appendChild(el('a', { href: 'tel:' + String(v).replace(/\D/g, '') }, v));
      else if (opts && opts.mail) dd.appendChild(el('a', { href: 'mailto:' + v }, v));
      else if (opts && opts.link) dd.appendChild(el('a', { href: v, target: '_blank', rel: 'noopener' }, 'open'));
      else dd.textContent = v;
      if (opts && opts.big) dd.classList.add('big');
      d.appendChild(el('div', { class: 'fact' }, [el('dt', {}, k), dd]));
    }
    return d;
  }
  function slide(p) {
    const st = status(p);
    const o = p.o, L = p.lcr || {};
    const age = L.Age || o.AGE, city = L['Address - City'] ? L['Address - City'].replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()) : o.LOCATION;
    const head = el('div', { class: 'slide-head' }, [
      el('h1', {}, p.name),
      el('p', { class: 'slide-sub' }, [age ? age : null, city, truthy(L['Move In Date']) ? 'moved in ' + L['Move In Date'] : null, yes(L['Is Returned Missionary']) ? 'returned missionary' : null, yes(o.CAR) ? 'has a car' : (truthy(o.CAR) && /^n/i.test(o.CAR) ? 'no car' : null), truthy(o['LENGTH OF STAY']) ? 'here ' + o['LENGTH OF STAY'].replace(/^(for|until|till|thru|through)\s+/i, m => m.toLowerCase()) : null].filter(Boolean).join('  ·  ')),
      (truthy(L['Individual Phone']) || truthy(L['Individual E-mail'])) ? el('p', { class: 'slide-contact' }, [
        truthy(L['Individual Phone']) ? el('a', { href: 'tel:' + L['Individual Phone'].replace(/\D/g, '') }, L['Individual Phone']) : null,
        truthy(L['Individual Phone']) && truthy(L['Individual E-mail']) ? '  ·  ' : null,
        truthy(L['Individual E-mail']) ? el('a', { href: 'mailto:' + L['Individual E-mail'] }, L['Individual E-mail']) : null,
      ]) : null,
      el('div', { class: 'badges' }, [
        el('span', { class: 'pill ' + st.k }, st.t),
        p.section ? el('span', { class: 'pill new' }, p.section) : null,
        (!p.onSheet && p.lcr) ? el('span', { class: 'pill new' }, 'Not on the sheet yet') : null,
        p.sheetOnly ? el('span', { class: 'pill warn' }, 'Not on LCR\'s no-calling report any more') : null,
        truthy(o['RECENT CONVERT (under yr)']) ? el('span', { class: 'pill recommend' }, 'Recent convert ' + (o['RECENT CONVERT (under yr)'].replace(/^yes\s*-?\s*/i, '').trim())) : null,
        p.tag ? el('span', { class: 'pill off' }, p.tag) : null,
        p.member ? (p.member.active ? null : el('span', { class: 'pill warn' }, 'Records have moved out')) : el('span', { class: 'pill warn' }, 'Not in LCR any more'),
      ]),
    ]);
    const calling = el('section', { class: 'slide-card' }, [
      el('h3', {}, 'Calling'),
      truthy(p.notes) ? el('p', { class: 'note-line' }, p.notes) : null,
      dl([['Proposed', p.proposed, { big: true }], ['Who texts', p.assignment], ['Texted', p.texted], ['Answer', p.answer], ['Sustained', p.sustained]]),
      (!truthy(p.proposed) && !truthy(p.assignment) && !truthy(p.notes)) ? el('p', { class: 'muted' }, p.onSheet ? 'Nothing proposed yet.' : 'Not on the callings sheet yet — add a row for them.') : null,
    ]);
    const tr = truthy(L['Temple Recommend Status']) ? L['Temple Recommend Status'] + (truthy(L['Temple Recommend Type']) ? ' · ' + (/proxy/i.test(L['Temple Recommend Type']) ? 'limited-use' : L['Temple Recommend Type'].toLowerCase()) : '') : (p.lcr ? 'None' : '');
    const aboutPairs = [['Temple recommend', tr], ['Ministering brothers', L['Ministering Brothers']], ['Ministering sisters', L['Ministering Sisters']], ['Has children', yes(L['Has Children']) ? 'Yes' : ''],
      ['Why in Atlanta', o['PURPOSE IN ATL']], ['Mission', o.MISSION], ['Hobbies', o.HOBBIES], ['Music', o.MUSIC]];
    const about = el('section', { class: 'slide-card' }, [
      el('h3', {}, 'About'),
      dl(aboutPairs),
      aboutPairs.every(([, v]) => !truthy(v)) ? el('p', { class: 'muted' }, 'Nothing on the sheet yet.') : null,
    ]);
    const f = p.forms[0];
    let formCard;
    if (f) {
      const pairs = [];
      for (const [h, v] of Object.entries(f.o)) {
        if (!h || SKIP_FORM.some(re => re.test(h)) || !truthy(v)) continue;
        const label = formLabel(h);
        const opts = /phone/i.test(h) ? { tel: true } : /email/i.test(h) ? { mail: true } : /^https?:\/\//.test(v) ? { link: true } : null;
        pairs.push([label, /^timestamp/i.test(h) ? fmtShort(f.when) || v : v, opts]);
      }
      formCard = el('section', { class: 'slide-card form' }, [
        el('h3', {}, ['Move-in form', f.when ? el('span', { class: 'muted' }, ' · ' + fmtShort(f.when)) : null]),
        dl(pairs),
        p.forms.length > 1 ? el('p', { class: 'muted' }, `Also filled out ${p.forms.slice(1).map(x => fmtShort(x.when) || 'earlier').join(', ')}.`) : null,
      ]);
    } else {
      formCard = el('section', { class: 'slide-card form' }, [el('h3', {}, 'Move-in form'), el('p', { class: 'muted' }, 'No new-member form on file for this name.')]);
    }
    const a = attFor(p);
    const seen = a.filter(x => x.ss || x.prs);
    const attCard = el('section', { class: 'slide-card' }, [
      el('h3', {}, 'Attendance'),
      p.member && p.member.active ? el('div', { class: 'att-row' }, a.map(x => el('div', { class: 'att-cell' }, [
        el('i', { class: 'dot' + (x.ss && x.prs ? ' both' : (x.ss || x.prs ? ' one' : '')) }),
        el('span', { class: 'att-lbl' }, x.d.slice(5).replace('-', '/')),
        el('span', { class: 'att-cls' }, [x.ss ? 'SS' : '', x.ss && x.prs ? ' · ' : '', x.prs ? 'P/RS' : ''].join('')),
      ]))) : el('p', { class: 'muted' }, p.member ? 'Their membership record has left the ward, so the roll no longer lists them.' : 'Not on the LCR roll any more, so there are no check-ins to show.'),
      p.member && p.member.active ? el('p', { class: 'muted' }, seen.length ? `Checked in ${seen.length} of the last ${a.length} Sundays · last seen ${fmtDate(seen[seen.length - 1].d, { weekday: undefined })}` : `No check-ins in the last ${a.length} Sundays (site roll started Sept 6).`) : null,
    ]);
    return el('div', { class: 'slide' }, [head, el('div', { class: 'slide-grid' }, [el('div', { class: 'slide-col' }, [calling, about, attCard]), el('div', { class: 'slide-col' }, formCard)])]);
  }
  function renderDeck() {
    const p = view[deckAt]; if (!p) return;
    $('deck-pos').textContent = `${deckAt + 1} of ${view.length}`;
    $('deck-filter').textContent = FILTERS[filter].label + (query ? ` · “${query}”` : '');
    const s = $('deck-slide'); s.innerHTML = ''; s.appendChild(slide(p)); s.scrollTop = 0;
    $('deck-prev').disabled = deckAt === 0; $('deck-next').disabled = deckAt === view.length - 1;
    const jump = $('deck-jump'); jump.innerHTML = '';
    view.forEach((x, i) => jump.appendChild(el('option', { value: i, selected: i === deckAt ? 'selected' : null }, `${i + 1}. ${x.name}`)));
  }
  function openDeck(i) {
    deckAt = Math.max(0, Math.min(i, view.length - 1));
    if (!view.length) { toast('Nobody to show with this filter'); return; }
    $('deck').hidden = false; document.body.classList.add('deck-open'); renderDeck();
  }
  function closeDeck() { $('deck').hidden = true; document.body.classList.remove('deck-open'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
  function step(n) { const to = deckAt + n; if (to < 0 || to >= view.length) return; deckAt = to; renderDeck(); }

  // ---------- data ----------
  async function load(force) {
    if (loaded && !force) return;
    if (loading) return loading;
    loading = (async () => {
      const pass = ctx.getPass();
      sundays = lastSundays(8);
      let rows = [];
      try { rows = await rpc('admin_sheets', { p_pass: pass }); }
      catch (e) { $('cal-list').innerHTML = ''; $('cal-list').appendChild(el('p', { class: 'notice' }, 'Run supabase/sheets.sql in Supabase first (' + e.message + ').')); loading = null; return; }
      sheets = Object.fromEntries(rows.map(r => [r.key, r]));
      attendance = new Map();
      try {
        for (const r of await rpc('admin_attendance_recent', { p_pass: pass, p_weeks: 8 })) {
          if (!attendance.has(r.member_id)) attendance.set(r.member_id, new Map());
          const m = attendance.get(r.member_id); if (!m.has(r.meeting_date)) m.set(r.meeting_date, new Set()); m.get(r.meeting_date).add(r.class);
        }
      } catch (e) { /* attendance is a bonus */ }
      build(); renderList(); loaded = true; loading = null;
      const cs = sheets.callings; $('cal-open-sheet').href = cs && cs.source_url || '#'; $('cal-open-sheet').hidden = !(cs && cs.source_url);
      const ns = sheets.newmember; $('cal-open-form').href = ns && ns.source_url || '#'; $('cal-open-form').hidden = !(ns && ns.source_url);
    })();
    return loading;
  }
  async function refreshFromGoogle() {
    const url = C.sheetsRefreshUrl;
    if (!url) { toast('Ask Claude to refresh the sheets, or set up the Google script (see scripts/announcements.gs)', 4500); return; }
    const btn = $('cal-refresh'); btn.disabled = true; btn.textContent = 'Refreshing…';
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sheets', pass: ctx.getPass() }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'refresh failed');
      toast(`Sheets refreshed: ${j.callings} people, ${j.newmember} form responses`);
      await load(true);
    } catch (e) { toast('Refresh failed: ' + e.message, 4000); }
    finally { btn.disabled = false; btn.textContent = 'Refresh from Google Sheets'; }
  }

  function init(c) {
    ctx = c;
    $('cal-search').addEventListener('input', () => { query = $('cal-search').value.trim(); renderList(); });
    $('cal-start').addEventListener('click', () => { openDeck(0); });
    $('cal-refresh').addEventListener('click', refreshFromGoogle);
    $('deck-close').addEventListener('click', closeDeck);
    $('deck-prev').addEventListener('click', () => step(-1));
    $('deck-next').addEventListener('click', () => step(1));
    $('deck-jump').addEventListener('change', () => { deckAt = +$('deck-jump').value; renderDeck(); });
    $('deck-full').addEventListener('click', () => { const d = $('deck'); if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) d.requestFullscreen().catch(() => {}); });
    document.addEventListener('keydown', e => {
      if ($('deck').hidden) return;
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { deckAt = 0; renderDeck(); }
      else if (e.key === 'End') { deckAt = view.length - 1; renderDeck(); }
      else if (e.key === 'Escape') closeDeck();
    });
    // swipe on phones/tablets
    let x0 = null;
    $('deck-slide').addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    $('deck-slide').addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1); });
  }

  return { init, load, refresh: () => load(true) };
})();
