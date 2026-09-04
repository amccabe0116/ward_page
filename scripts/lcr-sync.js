/*
 * North Point YSA — LCR sync
 *
 * Runs INSIDE a signed-in LCR tab on
 *   https://lcr.churchofjesuschrist.org/mlt/report/class-and-quorum-attendance?lang=eng
 * (Claude's browser pane runs it via javascript_exec; you can also paste it in DevTools.)
 *
 * What it does:
 *   roster : reads every member + class assignment out of the report page and upserts
 *            them into Supabase (admin_upsert_members).
 *   push   : reads the site's check-ins for one Sunday (admin_attendance) and clicks the
 *            matching attendance buttons in LCR that are not already marked, then marks
 *            those rows synced (admin_mark_synced).
 *
 * Configure by setting window.NP_SYNC before running, e.g.
 *   window.NP_SYNC = { supabaseUrl: 'https://xxx.supabase.co', anonKey: '…', pass: '…',
 *                      week: '2026-09-06', mode: 'both' };   // mode: 'roster' | 'push' | 'both'
 * Returns a summary object (also logged to the console with the [np-sync] prefix).
 */
(async function npSync(userCfg) {
  const cfg = Object.assign({
    supabaseUrl: '', anonKey: '', pass: '',
    week: null,                 // YYYY-MM-DD (a Sunday). Default: most recent Sunday, America/New_York
    mode: 'both',
    ssOrgTypeIds: [1255, 1256, 1257],   // Sunday School classes
    prsOrgTypeIds: [70, 71, 74],        // Elders Quorum, Priests Quorum, Relief Society
    clickDelayMs: 600,
    dryRun: false,
  }, userCfg || window.NP_SYNC || {});

  const out = { ok: false, week: null, roster: null, push: null, errors: [], log: [] };
  const say = (...a) => { const s = a.join(' '); out.log.push(s); console.log('[np-sync]', ...a); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  if (!/lcr\.churchofjesuschrist\.org$/.test(location.hostname) || !location.pathname.includes('class-and-quorum-attendance')) {
    out.errors.push('Not on the LCR Class and Quorum Attendance page'); return out;
  }
  if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.pass) { out.errors.push('Missing supabaseUrl / anonKey / pass'); return out; }

  // ---- helpers -------------------------------------------------------------
  async function rpc(fn, args) {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` },
      body: JSON.stringify(args || {}),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${fn}: ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  }

  function lastSunday() {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)); d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }

  function props(btn) {
    const k = Object.keys(btn).find(x => x.startsWith('__reactFiber$'));
    let f = k && btn[k];
    for (let i = 0; i < 8 && f; i++) { const p = f.memoizedProps; if (p && p.memberId && p.weekDate) return p; f = f.return; }
    return null;
  }

  // All attendance cells currently rendered: [{btn, p}]
  function cells() {
    const res = [];
    for (const b of document.querySelectorAll('button[aria-label]')) {
      const p = props(b); if (p && p.classUuid) res.push({ btn: b, p });
    }
    return res;
  }

  function setSelect(sel, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, value); sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findSelect(predicate) { return [...document.querySelectorAll('select')].find(s => [...s.options].some(predicate)); }

  async function waitFor(test, ms, step) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 15000)) { const v = test(); if (v) return v; await sleep(step || 250); }
    return null;
  }

  // Make sure the page shows the whole unit for the month that contains `week`.
  async function showMonth(week) {
    const ym = week.slice(0, 7);
    const orgSel = findSelect(o => o.value === 'ALL' && /All Classes/i.test(o.textContent));
    if (orgSel && orgSel.value !== 'ALL') { setSelect(orgSel, 'ALL'); await sleep(800); }
    const monthSel = findSelect(o => /^\d{4}-\d{2}$/.test(o.value));
    if (!monthSel) throw new Error('month selector not found');
    if (monthSel.value !== ym) {
      if (![...monthSel.options].some(o => o.value === ym)) throw new Error(`month ${ym} not available in LCR yet`);
      say('switching month to', ym); setSelect(monthSel, ym);
    }
    const weekSel = findSelect(o => o.value === 'ALL' && /^All$/i.test(o.textContent.trim()));
    if (weekSel && weekSel.value !== 'ALL') { setSelect(weekSel, 'ALL'); }
    const ok = await waitFor(() => cells().some(c => c.p.weekDate === week) ? true : null, 20000);
    if (!ok) throw new Error(`LCR shows no editable cells for ${week} (not open for editing?)`);
  }

  function displayName(lcrName) {
    const [last, rest] = lcrName.split(/,\s*/); const given = (rest || '').split(' ')[0];
    return (given ? `${given} ${last}` : last).trim();
  }

  // ---- go ------------------------------------------------------------------
  try {
    const week = cfg.week || lastSunday(); out.week = week;
    say('week', week, 'mode', cfg.mode, cfg.dryRun ? '(dry run)' : '');
    await showMonth(week);
    const all = cells().filter(c => c.p.weekDate === week);
    say('cells for week:', all.length);

    // ---- roster --------------------------------------------------------------
    const roster = new Map();
    for (const { btn, p } of all) {
      const tr = btn.closest('tr');
      const gender = tr ? ((tr.querySelector('td:nth-child(2)') || {}).textContent || '').replace(/Gender/i, '').trim() : '';
      const r = roster.get(p.memberId) || roster.set(p.memberId, { lcr_uuid: p.memberId, name: p.memberName, display_name: displayName(p.memberName), sex: gender === 'M' || gender === 'F' ? gender : null, org: null, lcr_classes: [] }).get(p.memberId);
      if (!r.lcr_classes.some(c => c.classUuid === p.classUuid)) r.lcr_classes.push({ orgName: p.orgName, classUuid: p.classUuid, orgTypeId: p.orgTypeId });
    }
    for (const r of roster.values()) {
      r.org = r.lcr_classes.some(c => c.orgTypeId === 70 || c.orgTypeId === 71) ? 'EQ' : (r.lcr_classes.some(c => c.orgTypeId === 74) ? 'RS' : null);
    }
    const members = [...roster.values()];
    if (cfg.mode === 'roster' || cfg.mode === 'both') {
      if (!members.length) throw new Error('no members found on the page');
      if (cfg.dryRun) { out.roster = { members: members.length, dryRun: true }; }
      else {
        const res = (await rpc('admin_upsert_members', { p_pass: cfg.pass, p_members: members, p_deactivate_missing: true }))[0];
        out.roster = Object.assign({ members: members.length }, res);
        say('roster:', JSON.stringify(out.roster));
      }
    }

    // ---- push ----------------------------------------------------------------
    if (cfg.mode === 'push' || cfg.mode === 'both') {
      const rows = await rpc('admin_attendance', { p_pass: cfg.pass, p_date: week });
      const pending = rows.filter(r => !r.synced_to_lcr_at);
      say('site check-ins:', rows.length, 'pending:', pending.length);
      const byKey = new Map(all.map(c => [c.p.memberId + '|' + c.p.classUuid, c]));
      const result = { total: rows.length, pending: pending.length, clicked: 0, alreadyMarked: 0, noCell: [], failed: [], synced: 0 };
      const doneIds = [];
      for (const r of pending) {
        const wanted = r.class === 'sunday_school' ? cfg.ssOrgTypeIds : cfg.prsOrgTypeIds;
        const target = (r.lcr_classes || []).find(c => wanted.includes(c.orgTypeId));
        const cell = target && r.lcr_uuid && byKey.get(r.lcr_uuid + '|' + target.classUuid);
        if (!cell) { result.noCell.push(r.name + ' (' + r.class + ')'); continue; }
        const pressed = () => cell.btn.getAttribute('aria-pressed') === 'true';
        if (pressed()) { result.alreadyMarked++; doneIds.push(r.attendance_id); continue; }
        if (cfg.dryRun) { result.clicked++; continue; }
        cell.btn.click(); result.clicked++;
        const ok = await waitFor(() => pressed() ? true : null, 8000, 200);
        if (ok) doneIds.push(r.attendance_id); else result.failed.push(r.name + ' (' + r.class + ')');
        await sleep(cfg.clickDelayMs);
      }
      if (doneIds.length && !cfg.dryRun) result.synced = await rpc('admin_mark_synced', { p_pass: cfg.pass, p_attendance_ids: doneIds });
      out.push = result;
      say('push:', JSON.stringify(result));
    }
    out.ok = true;
  } catch (e) {
    out.errors.push(String(e && e.message || e)); say('ERROR', String(e && e.message || e));
  }
  window.__npSyncResult = out;
  return out;
})();
