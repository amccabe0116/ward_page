/*
 * Leaders › Overview — the quick-reference page leaders land on.
 *
 *   who's on the roll          admin_members (active, men / women)
 *   moved in, last 30 days     LCR "Members Moved In" report, copied in as sheet `lcr_moved_in`
 *                              (scripts/lcr-report.js — falls back to the Move In Date column of the
 *                              members-without-callings report while that copy doesn't exist)
 *   sacrament attendance       LCR "Sacrament Meeting Attendance", copied in as sheet `lcr_sacrament`
 *                              (scripts/lcr-sacrament.js)
 *   accepted, not sustained    the callings list (callings.js): Answer says yes, Sustained blank
 */
window.NPOverview = (function () {
  const { C, rpc, el } = NP;
  const $ = id => document.getElementById(id);
  let ctx = null, loaded = false, loading = null;

  const DAY = 864e5;
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // "13 Sep 2026", "9/13/2026", "2026-09-13" -> Date (local midnight) or null
  function parseDate(s) {
    s = String(s || '').trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/))) { const mo = MONTHS[m[2].toLowerCase()]; return mo == null ? null : new Date(+m[3], mo, +m[1]); }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) return new Date(+(m[3].length === 2 ? '20' + m[3] : m[3]), +m[1] - 1, +m[2]);
    return null;
  }
  const fmtShort = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtWhen = iso => new Date(iso).toLocaleString('en-US', { timeZone: C.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const firstLast = n => { const [last, rest] = String(n).split(','); return rest ? rest.trim().split(' ')[0] + ' ' + last.trim() : n; };
  function rowsOf(sheet) { if (!sheet) return []; const h = sheet.headers; return sheet.rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i] || '']))); }

  function tile(big, label, sub) { return el('div', { class: 'stat' }, [el('b', {}, big), el('span', {}, label), sub ? el('span', { class: 'stat-sub' }, sub) : null]); }

  function render(members, sheets, people) {
    const box = $('ov'); box.innerHTML = '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const active = members.filter(m => m.active);
    const women = active.filter(m => m.sex === 'F').length, men = active.filter(m => m.sex === 'M').length, known = women + men;
    const pct = n => known ? Math.round(100 * n / known) + '%' : '—';

    // --- moved in, last 30 days
    const cutoff = new Date(today.getTime() - 30 * DAY);
    let movedSrc = 'LCR Members Moved In', movedAsOf = null, moved = [];
    if (sheets.lcr_moved_in) {
      movedAsOf = sheets.lcr_moved_in.updated_at;
      moved = rowsOf(sheets.lcr_moved_in).map(r => ({ name: r.Name.replace(/^Warning/, ''), age: r.Age, date: parseDate(r['Move In Date']), from: r['Prior Unit'], uuid: r['Person UUID'] }));
    } else if (sheets.lcr_callings) {
      movedSrc = 'LCR members-without-callings report (run lcr-report.js on Members Moved In for the full list)'; movedAsOf = sheets.lcr_callings.updated_at;
      moved = rowsOf(sheets.lcr_callings).map(r => ({ name: r['Preferred Name'], age: r.Age, date: parseDate(r['Move In Date']), from: '', uuid: r['Person UUID'] }));
    }
    moved = moved.filter(p => p.date && p.date >= cutoff && p.date <= today).sort((a, b) => b.date - a.date);
    const byUuid = new Map(people.filter(p => p.lcr).map(p => [p.lcr['Person UUID'], p]));

    // --- sacrament attendance, last 5 Sundays with a number
    let sac = [], sacAsOf = null;
    if (sheets.lcr_sacrament) {
      sacAsOf = sheets.lcr_sacrament.updated_at;
      sac = rowsOf(sheets.lcr_sacrament).map(r => ({ date: parseDate(r.Sunday), n: parseInt(r.Attendance, 10) })).filter(r => r.date && r.date <= today && !isNaN(r.n)).sort((a, b) => a.date - b.date).slice(-5);
    }
    const sacAvg = sac.length ? Math.round(sac.reduce((a, r) => a + r.n, 0) / sac.length) : null;
    const sacMax = Math.max(1, ...sac.map(r => r.n));

    // --- accepted a calling, not sustained yet
    const isTicked = NPCallings.isTicked;
    const accepted = people.filter(p => !p.deleted && /accept|^\s*y(es)?\s*$/i.test(p.answer || '') && !isTicked(p.sustained));

    box.appendChild(el('div', { class: 'stats' }, [
      tile(String(active.length), 'members on the roll'),
      tile(pct(women), 'women', women + (women === 1 ? ' sister' : ' sisters')),
      tile(pct(men), 'men', men + (men === 1 ? ' brother' : ' brothers')),
      tile(String(moved.length), 'moved in, last 30 days'),
      tile(sacAvg == null ? '—' : String(sacAvg), 'avg. sacrament, last 5 weeks'),
      tile(String(accepted.length), 'accepted, not sustained'),
    ]));

    const grid = el('div', { class: 'ov-grid' });
    // sacrament
    grid.appendChild(el('section', { class: 'card ov-card' }, [
      el('h3', {}, 'Sacrament meeting attendance'),
      sac.length ? el('div', { class: 'ov-bars' }, sac.map(r => el('div', { class: 'ov-bar' }, [
        el('span', { class: 'ov-bar-label' }, fmtShort(r.date)),
        el('span', { class: 'ov-bar-track' }, el('span', { class: 'ov-bar-fill', style: `width:${Math.round(100 * r.n / sacMax)}%` })),
        el('b', {}, String(r.n)),
      ]))) : el('p', { class: 'muted' }, 'Not copied from LCR yet — open Sacrament Meeting Attendance in LCR and run scripts/lcr-sacrament.js (part of the Sunday sync).'),
      el('p', { class: 'muted small' }, sacAsOf ? 'From LCR · copied ' + fmtWhen(sacAsOf) : ''),
    ]));
    // moved in
    grid.appendChild(el('section', { class: 'card ov-card' }, [
      el('h3', {}, 'Moved in the last 30 days'),
      moved.length ? el('ul', { class: 'ov-list' }, moved.map(p => {
        const cp = byUuid.get(p.uuid);
        return el('li', {}, [
          el('div', {}, [el('b', {}, firstLast(p.name)), p.age ? el('span', { class: 'muted' }, ' · ' + p.age) : null, cp ? el('button', { class: 'chip tiny', type: 'button', onclick: () => ctx.openCallings(cp.sheetName) }, cp.forms && cp.forms.length ? 'form + callings slide' : 'callings slide') : null]),
          el('div', { class: 'muted small' }, fmtShort(p.date) + (p.from ? ' · from ' + p.from : '')),
        ]);
      })) : el('p', { class: 'muted' }, 'Nobody in the last 30 days.'),
      el('p', { class: 'muted small' }, movedAsOf ? movedSrc + ' · copied ' + fmtWhen(movedAsOf) : 'Run scripts/lcr-report.js on LCR’s Members Moved In report to fill this in.'),
    ]));
    // accepted, needs sustaining
    grid.appendChild(el('section', { class: 'card ov-card ov-wide' }, [
      el('h3', {}, 'Accepted a calling — still to be sustained'),
      accepted.length ? el('table', { class: 'grid ov-table' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, 'Name'), el('th', {}, 'Calling'), el('th', {}, 'Answer'), el('th', {}, 'Who texts'), el('th', {}, '')])),
        el('tbody', {}, accepted.map(p => el('tr', { class: 'cal-row', tabindex: 0, onclick: () => ctx.openCallings(p.sheetName) }, [
          el('td', {}, el('b', {}, p.name)), el('td', {}, p.proposed || p.assignment || ''), el('td', {}, p.answer), el('td', { class: 'muted' }, p.assignment && p.proposed ? p.assignment : ''), el('td', { class: 'muted small' }, 'open ›'),
        ]))),
      ]) : el('p', { class: 'muted' }, 'Nobody waiting — everyone who accepted has been sustained.'),
      el('p', { class: 'muted small' }, 'From the Members without Callings sheet: Answer says yes and the Sustained box is still empty. Tick Sustained on their slide once it’s done.'),
    ]));
    box.appendChild(grid);
  }

  async function load(force) {
    if (loaded && !force) return;
    if (loading) return loading;
    loading = (async () => {
      $('ov').innerHTML = '<p class="muted">Loading…</p>';
      try {
        await NPCallings.load(force);
        const d = NPCallings.data();
        render(ctx.getMembers(), d.sheets || {}, d.people || []);
        loaded = true;
      } catch (e) { $('ov').innerHTML = ''; $('ov').appendChild(el('p', { class: 'notice' }, 'Could not load the overview: ' + e.message)); }
      loading = null;
    })();
    return loading;
  }
  function init(c) { ctx = c; }
  return { init, load, refresh: () => load(true) };
})();
