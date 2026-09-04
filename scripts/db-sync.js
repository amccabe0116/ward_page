/*
 * North Point YSA — Supabase half of the sync. Run in ANY tab that is not LCR
 * (a blank tab, or https://northpointysa.com/admin.html). Pair with scripts/lcr-sync.js.
 *
 * Configure with window.NP_DB before running:
 *   { supabaseUrl, anonKey, pass, action, ... }
 * Actions:
 *   'pending' { week }             -> { ok, week, pending:[{id,u,cu,name,class}], counts }
 *                                     (site check-ins not yet in LCR, with the LCR class to mark)
 *   'mark'    { ids:[…] }          -> { ok, marked }
 *   'roster'  { classes, members, deactivateMissing } -> { ok, inserted, updated, deactivated }
 *                                     (classes/members exactly as lcr-sync.js 'roster' returned;
 *                                      pass deactivateMissing:false when sending a partial slice)
 *   'status'  {}                   -> { ok, dates:[…] }   (recent Sundays with counts)
 */
(async function npDbSync(userCfg) {
  const cfg = Object.assign({
    supabaseUrl: '', anonKey: '', pass: '', action: 'status', week: null, ids: [], classes: [], members: [],
    deactivateMissing: true,
    ssOrgTypeIds: [1255, 1256, 1257], prsOrgTypeIds: [70, 71, 74],
  }, userCfg || window.NP_DB || {});
  const out = { ok: false, action: cfg.action, errors: [] };
  if (!cfg.supabaseUrl || !cfg.anonKey || !cfg.pass) { out.errors.push('Missing supabaseUrl / anonKey / pass'); return out; }

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
  function displayName(lcrName) {
    const [last, rest] = String(lcrName).split(/,\s*/); const given = (rest || '').split(' ')[0];
    return (given ? `${given} ${last}` : last).trim();
  }

  try {
    if (cfg.action === 'status') {
      out.dates = await rpc('admin_meeting_dates', { p_pass: cfg.pass });
    }
    if (cfg.action === 'pending') {
      const week = cfg.week || lastSunday(); out.week = week;
      const rows = await rpc('admin_attendance', { p_pass: cfg.pass, p_date: week });
      out.counts = { total: rows.length, synced: rows.filter(r => r.synced_to_lcr_at).length };
      out.pending = []; out.unmappable = [];
      for (const r of rows) {
        if (r.synced_to_lcr_at) continue;
        const wanted = r.class === 'sunday_school' ? cfg.ssOrgTypeIds : cfg.prsOrgTypeIds;
        const target = (r.lcr_classes || []).find(c => wanted.includes(c.orgTypeId));
        if (!target || !r.lcr_uuid) { out.unmappable.push({ id: r.attendance_id, name: r.name, class: r.class }); continue; }
        out.pending.push({ id: r.attendance_id, u: r.lcr_uuid, cu: target.classUuid, name: r.name, class: r.class });
      }
    }
    if (cfg.action === 'mark') {
      out.marked = cfg.ids.length ? await rpc('admin_mark_synced', { p_pass: cfg.pass, p_attendance_ids: cfg.ids }) : 0;
    }
    if (cfg.action === 'roster') {
      const members = (cfg.members || []).map(m => {
        const lcr_classes = (m.c || []).map(i => cfg.classes[i]).filter(Boolean);
        const org = lcr_classes.some(c => c.orgTypeId === 70 || c.orgTypeId === 71) ? 'EQ' : (lcr_classes.some(c => c.orgTypeId === 74) ? 'RS' : null);
        return { lcr_uuid: m.u, name: m.n, display_name: displayName(m.n), sex: m.g || null, org, lcr_classes };
      });
      if (!members.length) throw new Error('no members given');
      const res = (await rpc('admin_upsert_members', { p_pass: cfg.pass, p_members: members, p_deactivate_missing: !!cfg.deactivateMissing }))[0];
      Object.assign(out, res, { sent: members.length });
    }
    out.ok = true;
  } catch (e) { out.errors.push(String(e && e.message || e)); }
  window.__npDbResult = out;
  return out;
})();
