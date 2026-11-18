import { config } from '../config.js';

const money = new Intl.NumberFormat(config.locale, {
  style: 'currency',
  currency: config.currency,
  maximumFractionDigits: 0,
});

export const formatPrice = (n) => money.format(n);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function setMeta({ title, description }) {
  document.title = title ? `${title} — Knot’ily` : "Knot’ily — made to be undone";
  if (description) {
    const m = document.querySelector('meta[name="description"]');
    if (m) m.setAttribute('content', description);
  }
}

export function uid(prefix = 'KN') {
  const t = Date.now().toString(36).toUpperCase().slice(-5);
  const r = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `${prefix}-${t}${r}`;
}

export function storage(key, fallback) {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    write(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage full or blocked (private mode) — keep working in memory */
      }
    },
  };
}

export const variantLabel = (color, size) => (size === 'One size' ? color : `${color}, size ${size}`);
