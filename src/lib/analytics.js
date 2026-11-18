// Journey tracking for the owner's dashboard: every page, product, colour, size,
// bag, checkout and payment step, tied together by a session id (per visit) and an
// anonymous visitor id (per browser), and linked to the account when the shopper
// signs in. Only runs after the shopper accepts analytics (see consent.js).
import { api } from './api.js';
import { getConsent, onConsent } from './consent.js';
import { detectDevice, deviceHints } from './device.js';

const SID_KEY = 'knotily.sid';
const AID_KEY = 'knotily.aid';
const UTM_KEY = 'knotily.utm';
const IDLE_MS = 30 * 60 * 1000;
let queue = [];
let timer = 0;

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

export function sessionId() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SID_KEY) || 'null');
    const now = Date.now();
    const s = raw && now - raw.last < IDLE_MS ? raw : { id: rid(), last: now };
    s.last = now;
    sessionStorage.setItem(SID_KEY, JSON.stringify(s));
    return s.id;
  } catch {
    return (sessionId.mem ||= rid());
  }
}

// Visitor id exists only after consent.
export function anonId() {
  if (getConsent() !== true) return null;
  try {
    let id = localStorage.getItem(AID_KEY);
    if (!id) localStorage.setItem(AID_KEY, (id = rid()));
    return id;
  } catch {
    return null;
  }
}

function landing() {
  try {
    const saved = sessionStorage.getItem(UTM_KEY);
    if (saved) return JSON.parse(saved);
    const q = new URLSearchParams(location.search);
    const ref = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : null;
    const l = { utm_source: q.get('utm_source'), utm_medium: q.get('utm_medium'), utm_campaign: q.get('utm_campaign'), referrer: ref };
    sessionStorage.setItem(UTM_KEY, JSON.stringify(l));
    return l;
  } catch {
    return {};
  }
}

export function track(name, { product_id, variant_id, ...props } = {}) {
  const consent = getConsent();
  if (consent === false) return;
  const d = detectDevice();
  const l = landing();
  queue.push({
    name, ts: new Date().toISOString(), session_id: sessionId(), path: location.pathname + location.search.slice(0, 120),
    product_id, variant_id, props, device_type: d.device_type, os: d.os,
    referrer: l.referrer, utm_source: l.utm_source, utm_medium: l.utm_medium, utm_campaign: l.utm_campaign,
  });
  if (queue.length > 60) queue = queue.slice(-60);
  if (consent === true) schedule();
}

function schedule() {
  if (!timer) timer = setTimeout(() => flush(), 4000);
}

export function flush() {
  clearTimeout(timer);
  timer = 0;
  if (getConsent() !== true || !queue.length) return;
  const aid = anonId();
  const batch = queue.splice(0, 50).map((e) => ({ ...e, anon_id: aid }));
  // keepalive: the batch still arrives if the shopper navigates away or closes the tab
  api('/api/events', { method: 'POST', keepalive: true, body: { consent: true, events: batch, hints: deviceHints() } }).catch(() => {});
  if (queue.length) schedule();
}

export function startAnalytics() {
  landing();
  onConsent((yes) => (yes ? flush() : (queue = [])));
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  addEventListener('pagehide', () => flush());
  // scroll depth per page (25/50/75/100)
  let marks = new Set();
  addEventListener('knotily:navigate', () => (marks = new Set()));
  addEventListener('scroll', () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    if (h < 200) return;
    const pct = Math.floor(((scrollY / h) * 100) / 25) * 25;
    if (pct >= 25 && !marks.has(pct)) {
      marks.add(pct);
      track('scroll_depth', { depth: pct });
    }
  }, { passive: true });
}
