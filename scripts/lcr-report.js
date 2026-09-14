/*
 * North Point YSA — copy an LCR custom report (e.g. "Members without Callings") into the site.
 *
 * Run INSIDE the signed-in LCR tab showing the report (Reports → Create a Report → the report),
 * after it has fully loaded ("Count: N" at the bottom). No network access here (LCR's CSP), so
 * it only reads the table; hand the result to scripts/db-sync.js in a site tab:
 *
 *   LCR tab:   window.NP_REPORT = { key: 'lcr_callings', title: 'LCR: Members without Callings' };
 *              <this file>                      -> { ok, key, title, headers, rows, count }
 *   site tab:  window.NP_DB = { supabaseUrl, anonKey, pass, action: 'sheet', key, title, sourceUrl, headers, rows };
 *              scripts/db-sync.js               -> { ok, stored }
 *
 * Rows come out as strings in column order, with the person's LCR uuid prepended as column
 * "Person UUID" (from the member-card button in the name cell) so the site can match exactly.
 */
(function npLcrReport(userCfg) {
  const cfg = Object.assign({ key: 'lcr_callings', title: document.title }, userCfg || window.NP_REPORT || {});
  const out = { ok: false, key: cfg.key, title: cfg.title, sourceUrl: location.href, errors: [] };
  const t = document.querySelector('table');
  if (!t || !t.tHead || !t.tBodies.length) { out.errors.push('No report table on this page — open the report in LCR and wait for it to load'); return out; }
  const headers = [...t.tHead.rows[0].cells].map(c => { const s = c.querySelector('span'); return (s ? s.textContent : c.textContent).trim(); });
  const rows = [];
  for (const tr of t.tBodies[0].rows) {
    const btn = tr.querySelector('[data-member-card-person-uuid]');
    const vals = [...tr.cells].map(c => {
      // in card view LCR clones the column header into each cell; strip it
      const h = c.querySelector('.eden-table-card-view__cloned-column-header');
      const label = h ? h.textContent.trim() : '';
      let v = c.textContent.trim();
      if (label && v.startsWith(label)) v = v.slice(label.length).trim();
      return v.replace(/\s+/g, ' ');
    });
    if (vals.some(v => v)) rows.push([btn ? btn.getAttribute('data-member-card-person-uuid') : '', ...vals]);
  }
  const m = document.body.innerText.match(/Count:\s*(\d+)/);
  out.headers = ['Person UUID', ...headers]; out.rows = rows; out.count = m ? +m[1] : rows.length;
  if (m && +m[1] !== rows.length) out.errors.push(`page says ${m[1]} rows but ${rows.length} were read — scroll/wait and run again`);
  out.ok = !out.errors.length;
  window.__npReport = out;
  return out;
})();
