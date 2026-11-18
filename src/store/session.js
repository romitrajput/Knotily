// Who is signed in. The session itself lives in httpOnly cookies the browser can't read;
// `kn_in` is a harmless readable hint so signed-out visitors skip the /me call.
import { get, post } from '../lib/api.js';
import { storage } from '../lib/util.js';

let user = null;
let loaded = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(user));

const hasHint = () => /(?:^|;\s*)kn_in=1/.test(document.cookie);

export function loadSession({ force = false } = {}) {
  if (!loaded || force) {
    loaded = (hasHint() || force ? get('/api/auth/me') : Promise.resolve({ user: null }))
      .then((r) => {
        user = r?.user || null;
        emit();
        return user;
      })
      .catch(() => {
        user = null;
        emit();
        return null;
      });
  }
  return loaded;
}

export const currentUser = () => user;
export const isOwner = () => user?.role === 'owner';

export function onSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setUser(u) {
  user = u || null;
  loaded = Promise.resolve(user);
  emit();
}

export async function logout() {
  await post('/api/auth/logout').catch(() => {});
  setUser(null);
}

// What the shopper was about to do when we asked them to sign up. Kept in this
// browser so the "email confirmed" page can offer to carry on where they left off.
const intentDb = storage('knotily.intent.v1', null);
export const saveIntent = (intent) => intentDb.write({ ...intent, at: Date.now() });
export function takeIntent() {
  const i = intentDb.read();
  intentDb.write(null);
  return i && Date.now() - i.at < 24 * 3600 * 1000 ? i : null;
}
export const peekIntent = () => {
  const i = intentDb.read();
  return i && Date.now() - i.at < 24 * 3600 * 1000 ? i : null;
};
