// Shared helpers for the North Point YSA site.
(function () {
  const C = window.NP_CONFIG;

  // Call a Postgres function through Supabase's REST API.
  async function rpc(fn, args) {
    const res = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: C.supabaseAnonKey,
        Authorization: `Bearer ${C.supabaseAnonKey}`,
      },
      body: JSON.stringify(args || {}),
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = await res.json(); msg = j.message || j.hint || j.details || msg; } catch (e) {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // Today's date parts in the ward's time zone.
  function nowInTz() {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: C.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
    return { y: +parts.year, m: +parts.month, d: +parts.day, dow: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday) };
  }

  // Most recent Sunday (today if Sunday) as YYYY-MM-DD, in the ward's time zone.
  function currentMeetingDate() {
    const t = nowInTz();
    const dt = new Date(Date.UTC(t.y, t.m - 1, t.d));
    dt.setUTCDate(dt.getUTCDate() - t.dow);
    return dt.toISOString().slice(0, 10);
  }

  function fmtDate(iso, opts) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }, opts || {}));
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  let toastTimer;
  function toast(msg, ms) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', { class: 'toast' }); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Turn plain text into safe HTML with clickable links / emails / phone numbers.
  function linkify(text) {
    let h = escapeHtml(text);
    h = h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    h = h.replace(/\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/g, (m, e) => `<a href="mailto:${e}">${e}</a>`);
    h = h.replace(/(?<![\d-])(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})(?!\d)/g, (m, p) => `<a href="tel:${p.replace(/\D/g, '')}">${p}</a>`);
    return h;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const icons = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chevron: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  };

  window.NP = { C, rpc, currentMeetingDate, fmtDate, el, toast, escapeHtml, linkify, store, icons };
})();
