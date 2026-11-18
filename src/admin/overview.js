// Analytics overview: headline numbers, trends, funnel, devices, sources, products.
import { get } from '../lib/api.js';
import { timeChart, barList, bindTips } from './charts.js';
import { inr, num, pct, esc } from './ui.js';

const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];
const DEVICE = { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop', unknown: 'Unknown' };
const OS = { ios: 'iOS', ipados: 'iPadOS', android: 'Android', windows: 'Windows', macos: 'macOS', chromeos: 'ChromeOS', linux: 'Linux', other: 'Other', unknown: 'Unknown' };

const tile = (label, value, sub = '') => `<div class="kpi"><p class="kpi-label">${esc(label)}</p><p class="kpi-value">${value}</p>${sub ? `<p class="kpi-sub">${sub}</p>` : ''}</div>`;

export async function render(host, { query }) {
  const days = RANGES.some(([d]) => d === query.days) ? query.days : '30';
  const from = new Date(Date.now() - Number(days) * 864e5).toISOString();
  const s = await get(`/api/admin/summary?from=${encodeURIComponent(from)}`);
  const k = s.kpis;
  const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  const devices = Object.entries(s.devices.reduce((m, d) => ((m[d.device] = (m[d.device] || 0) + d.sessions), m), {})).map(([dv, n]) => ({ label: DEVICE[dv] || dv, value: n }));
  const os = Object.entries(s.devices.reduce((m, d) => ((m[d.os] = (m[d.os] || 0) + d.sessions), m), {})).sort((a, b) => b[1] - a[1]).map(([o, n]) => ({ label: OS[o] || o, value: n }));
  const funnelTop = s.funnel?.[0]?.sessions || 0;
  const funnel = (s.funnel || []).map((f, i, a) => ({ label: f.step, value: f.sessions, note: i && a[i - 1].sessions ? `${pct(f.sessions, a[i - 1].sessions)} of previous` : '' }));
  const sizes = Object.entries(s.colors_sizes.reduce((m, r) => ((m[r.size] = (m[r.size] || 0) + r.units), m), {})).sort((a, b) => b[1] - a[1]).map(([sz, u]) => ({ label: sz, value: u }));
  const colors = Object.entries(s.colors_sizes.reduce((m, r) => ((m[r.color] = (m[r.color] || 0) + r.units), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, u]) => ({ label: c, value: u }));

  host.innerHTML = `
    <div class="adm-bar">
      <h1 class="adm-title">Overview</h1>
      <label class="adm-select">Period
        <select data-range>${RANGES.map(([d, l]) => `<option value="${d}" ${d === days ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
    </div>
    <p class="adm-hint">Visitor numbers only include people who accepted analytics. Orders and revenue include everyone.</p>

    <section class="kpis" aria-label="Headline numbers">
      ${tile('Revenue', inr(k.revenue_paise), `${num(k.orders)} paid orders · ${num(k.units)} pieces`)}
      ${tile('Visitors', num(k.visitors), `${num(k.sessions)} visits`)}
      ${tile('Conversion', pct(s.funnel?.[4]?.sessions || 0, funnelTop), 'visits that paid')}
      ${tile('Average order', k.orders ? inr(k.revenue_paise / k.orders) : '—')}
      ${tile('New accounts', num(k.signups))}
      ${tile('Waiting for restock', num(k.reminders_active), 'active reminders')}
    </section>

    <div class="viz-grid2">
      ${timeChart(s.daily.map((d) => ({ label: day(d.day), value: d.visitors })), { title: 'Visitors per day', kind: 'line', tipFmt: (v) => `${num(v)} visitor${v === 1 ? '' : 's'}` })}
      ${timeChart(s.daily.map((d) => ({ label: day(d.day), value: d.revenue_paise / 100 })), { title: 'Revenue per day (₹)', kind: 'bar', tipFmt: (v) => '₹' + Math.round(v).toLocaleString('en-IN') })}
    </div>

    <div class="viz-grid2">
      ${barList(funnel, { title: 'Shopping funnel (visits)', tipFmt: num })}
      ${barList(devices, { title: 'Devices (visits)', tipFmt: num, note: os.length ? 'Operating systems: ' + os.map((o) => `${o.label} ${num(o.value)}`).join(' · ') : '' })}
    </div>

    <section class="adm-card">
      <h2>Products</h2>
      <div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th scope="col">Product</th><th scope="col" class="r">Views</th><th scope="col" class="r">Added to bag</th><th scope="col" class="r">Sold</th><th scope="col" class="r">Revenue</th><th scope="col" class="r">Waiting</th></tr></thead>
        <tbody>${s.top_products.map((p) => `<tr><th scope="row">${esc(p.name)}</th><td class="r">${num(p.views)}</td><td class="r">${num(p.adds)}</td><td class="r">${num(p.units)}</td><td class="r">${inr(p.revenue_paise)}</td><td class="r">${p.waiting ? `<b>${num(p.waiting)}</b>` : '0'}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>

    <div class="viz-grid2">
      ${barList(sizes, { title: 'Pieces sold by size', tipFmt: num })}
      ${barList(colors, { title: 'Pieces sold by colour', tipFmt: num })}
    </div>
    <div class="viz-grid2">
      ${barList(s.referrers.map((r) => ({ label: r.source, value: r.sessions })), { title: 'Where visitors came from', tipFmt: num })}
      ${barList(s.states.map((r) => ({ label: r.state, value: r.orders })), { title: 'Orders by state', tipFmt: num })}
    </div>

    <div class="viz-grid2">
      <section class="adm-card">
        <h2>Running low</h2>
        ${s.low_stock.length ? `<ul class="adm-list">${s.low_stock.slice(0, 15).map((l) => `<li><span>${esc(l.product)} · ${esc(l.color)} · ${esc(l.size)}</span><b class="${l.available <= 0 ? 'neg' : ''}">${l.available <= 0 ? 'Sold out' : `${l.available} left`}</b></li>`).join('')}</ul><a class="adm-link" href="/admin/inventory?filter=low">Restock in Inventory →</a>` : '<p class="adm-muted">Nothing is running low.</p>'}
      </section>
      <section class="adm-card">
        <h2>Every action recorded</h2>
        ${s.events.length ? `<ul class="adm-list">${s.events.map((e) => `<li><span>${esc(e.name.replace(/_/g, ' '))}</span><b>${num(e.count)}</b></li>`).join('')}</ul>` : '<p class="adm-muted">No activity yet.</p>'}
        <a class="adm-link" href="/admin/export">Download the raw events →</a>
      </section>
    </div>`;

  host.querySelector('[data-range]').addEventListener('change', (e) => {
    history.replaceState({}, '', `/admin?days=${e.target.value}`);
    render(host, { query: { days: e.target.value } });
  });
  bindTips(host);
}
