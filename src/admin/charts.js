// Minimal SVG charts for the owner dashboard (no libraries).
// Specs follow the house data-viz rules: one hue per single-series chart, thin marks,
// 4px rounded data-ends from a single baseline, 2px lines, recessive hairline grid,
// one y-axis, hover tooltip on every mark, and a table view for every chart.
import { esc } from '../lib/util.js';

const W = 640;
// text inside data-tip is read back via dataset (which un-escapes once) and shown as HTML,
// so it is escaped twice
const tx = (s) => esc(esc(s));
let tip = null;

function tooltip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'viz-tip';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

// Attach hover/focus tooltips to [data-tip] elements inside root.
export function bindTips(root) {
  if (root.__tips) return;
  root.__tips = true;
  const t = tooltip();
  const show = (el, x, y) => {
    t.innerHTML = el.dataset.tip;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    t.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
    t.style.top = `${Math.max(8, y - r.height - 12)}px`;
  };
  root.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return (t.hidden = true);
    if (el.dataset.hoverGroup) root.querySelectorAll(`[data-hover-group="${el.dataset.hoverGroup}"]`).forEach((g) => g.classList.add('is-hover'));
    show(el, e.clientX, e.clientY);
  });
  root.addEventListener('pointerout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el?.dataset.hoverGroup) root.querySelectorAll('.is-hover').forEach((g) => g.classList.remove('is-hover'));
    t.hidden = true;
  });
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  root.addEventListener('focusout', () => (t.hidden = true));
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const compact = (n) => (n >= 1e7 ? `${+(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${+(n / 1e5).toFixed(1)}L` : n >= 1e4 ? `${+(n / 1e3).toFixed(0)}K` : n < 10 ? String(+n.toFixed(1)) : Math.round(n).toLocaleString('en-IN'));

function tableHTML(rows, cols) {
  return `<details class="viz-table"><summary>Show as table</summary><table><thead><tr>${cols.map((c) => `<th scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c, i) => (i ? `<td>${esc(c.fmt ? c.fmt(r[c.key]) : r[c.key])}</td>` : `<th scope="row">${esc(c.fmt ? c.fmt(r[c.key]) : r[c.key])}</th>`)).join('')}</tr>`).join('')}</tbody></table></details>`;
}

function grid(max, h, top, left, right, fmt) {
  const ticks = [0, 0.5, 1].map((k) => k * max);
  return ticks
    .map((v) => {
      const y = top + h - (v / max) * h;
      return `<line class="viz-grid" x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" /><text class="viz-axis" x="${left - 8}" y="${y + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
    })
    .join('');
}

// Time series: line (counts) or columns (amounts). data: [{label, value, tip}]
export function timeChart(data, { kind = 'line', title, fmt = compact, tipFmt = (v) => v, height = 200, empty = 'No data in this range yet.' } = {}) {
  if (!data.length || data.every((d) => !d.value)) return `<figure class="viz"><figcaption>${esc(title)}</figcaption><p class="viz-empty">${esc(empty)}</p></figure>`;
  const top = 12, bottom = 26, left = 52, right = 12;
  const h = height - top - bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const step = (W - left - right) / data.length;
  const x = (i) => left + step * (i + 0.5);
  const y = (v) => top + h - (v / max) * h;
  const every = Math.ceil(data.length / 7);
  const xlabels = data.map((d, i) => (i % every === 0 || i === data.length - 1 ? `<text class="viz-axis" x="${x(i)}" y="${height - 6}" text-anchor="middle">${esc(d.label)}</text>` : '')).join('');
  let marks = '';
  if (kind === 'line') {
    const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
    const area = `${x(0)},${top + h} ${pts} ${x(data.length - 1)},${top + h}`;
    marks = `<polygon class="viz-area" points="${area}" /><polyline class="viz-line" points="${pts}" />`;
    const last = data.length - 1;
    marks += `<circle class="viz-dot" cx="${x(last)}" cy="${y(data[last].value)}" r="4" /><text class="viz-label" x="${x(last) - 6}" y="${y(data[last].value) - 10}" text-anchor="end">${esc(tipFmt(data[last].value))}</text>`;
    // invisible hover columns
    marks += data.map((d, i) => `<rect class="viz-hit" x="${x(i) - step / 2}" y="${top}" width="${step}" height="${h}" tabindex="0" data-tip="<b>${tx(d.label)}</b><br>${tx(tipFmt(d.value))}" />`).join('');
  } else {
    const bw = Math.min(24, step - 2);
    marks = data
      .map((d, i) => {
        const bh = Math.max(d.value ? 2 : 0, (d.value / max) * h);
        const bx = x(i) - bw / 2, by = top + h - bh;
        const r = Math.min(4, bh, bw / 2);
        const path = bh ? `M${bx},${top + h} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bw - r} Q${bx + bw},${by} ${bx + bw},${by + r} V${top + h} Z` : '';
        return `<g tabindex="0" data-tip="<b>${tx(d.label)}</b><br>${tx(tipFmt(d.value))}"><rect class="viz-hit" x="${x(i) - step / 2}" y="${top}" width="${step}" height="${h}" />${path ? `<path class="viz-bar" d="${path}" />` : ''}</g>`;
      })
      .join('');
  }
  return `<figure class="viz"><figcaption>${esc(title)}</figcaption>
    <svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}">${grid(max, h, top, left, right, fmt)}<line class="viz-base" x1="${left}" x2="${W - right}" y1="${top + h}" y2="${top + h}" />${marks}${xlabels}</svg>
    ${tableHTML(data, [{ key: 'label', label: 'Day' }, { key: 'value', label: title, fmt: tipFmt }])}</figure>`;
}

// Horizontal bars with the value at the tip. data: [{label, value, note}]
export function barList(data, { title, tipFmt = (v) => Number(v).toLocaleString('en-IN'), empty = 'No data in this range yet.', note } = {}) {
  if (!data.length || data.every((d) => !d.value)) return `<figure class="viz"><figcaption>${esc(title)}</figcaption><p class="viz-empty">${esc(empty)}</p></figure>`;
  const max = Math.max(...data.map((d) => d.value)) || 1;
  return `<figure class="viz"><figcaption>${esc(title)}</figcaption>
    <ul class="viz-bars" role="list">${data
      .map((d) => `<li tabindex="0" data-tip="<b>${tx(d.label)}</b><br>${tx(tipFmt(d.value))}${d.note ? ` · ${tx(d.note)}` : ''}">
        <span class="vb-label">${esc(d.label)}</span>
        <span class="vb-track">${d.value ? `<span class="vb-bar" style="width:${Math.max(0.5, (d.value / max) * 100).toFixed(1)}%"></span>` : ''}</span>
        <span class="vb-value">${esc(tipFmt(d.value))}${d.note ? ` <small>${esc(d.note)}</small>` : ''}</span></li>`)
      .join('')}</ul>
    ${note ? `<p class="viz-note">${esc(note)}</p>` : ''}
    ${tableHTML(data, [{ key: 'label', label: title }, { key: 'value', label: 'Value', fmt: tipFmt }, ...(data.some((d) => d.note) ? [{ key: 'note', label: 'Note' }] : [])])}</figure>`;
}
