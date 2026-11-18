// Analytics consent (DPDP Act 2023 / GDPR style): nothing is tracked until the
// shopper says yes. The choice is kept in this browser and, when signed in, on the account.
import { storage } from './util.js';

const db = storage('knotily.consent.v1', null);
const listeners = new Set();

export const getConsent = () => {
  const c = db.read();
  return c && typeof c.analytics === 'boolean' ? c.analytics : null;
};

export function setConsent(analytics) {
  db.write({ analytics: !!analytics, at: new Date().toISOString(), v: 1 });
  listeners.forEach((fn) => fn(!!analytics));
}

export function onConsent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
