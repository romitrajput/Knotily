// Works out phone / tablet / desktop and iOS / Android / … once, and tags <html>
// so the styles can adapt (see the [data-device] and [data-os] rules in styles/device.css).
// Uses the same parser as the server, so analytics and orders agree with the UI.
import { parseUserAgent } from '../../server/lib/device.js';

let info = null;

export function deviceHints() {
  const uad = navigator.userAgentData;
  return { maxTouchPoints: navigator.maxTouchPoints || 0, mobile: uad?.mobile, platform: uad?.platform };
}

export function detectDevice() {
  if (info) return info;
  info = parseUserAgent(navigator.userAgent, deviceHints());
  const html = document.documentElement;
  html.dataset.device = info.device_type;
  html.dataset.os = info.os;
  html.dataset.browser = info.browser;
  html.classList.toggle('is-touch', (navigator.maxTouchPoints || 0) > 0 || matchMedia('(pointer: coarse)').matches);
  html.classList.toggle('is-standalone', matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  return info;
}
