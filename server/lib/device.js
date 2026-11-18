// Device class, OS and browser from the User-Agent (plus client hints when sent).
// Shared by the server (orders, events) and the browser (src/lib/device.js re-exports it).
export function parseUserAgent(ua = '', hints = {}) {
  const s = String(ua);
  let os = 'other';
  if (/iPhone|iPod/.test(s)) os = 'ios';
  else if (/iPad/.test(s) || (/Macintosh/.test(s) && hints.maxTouchPoints > 1)) os = 'ipados';
  else if (/Android/i.test(s)) os = 'android';
  else if (/Windows/i.test(s)) os = 'windows';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macos';
  else if (/CrOS/.test(s)) os = 'chromeos';
  else if (/Linux/i.test(s)) os = 'linux';
  if (hints.platform) {
    const p = String(hints.platform).toLowerCase();
    if (p === 'android') os = 'android';
    else if (p === 'ios') os = 'ios';
    else if (p === 'windows') os = 'windows';
    else if (p === 'macos') os = 'macos';
    else if (p === 'chrome os') os = 'chromeos';
    else if (p === 'linux') os = 'linux';
  }

  let device = 'desktop';
  if (os === 'ipados' || /Tablet|PlayBook|Silk/i.test(s) || (os === 'android' && !/Mobile/i.test(s))) device = 'tablet';
  else if (os === 'ios' || /Mobi|iPhone|Android.+Mobile|Windows Phone/i.test(s)) device = 'phone';
  if (hints.mobile === true && device === 'desktop') device = 'phone';

  let browser = 'other';
  if (/Edg\//.test(s)) browser = 'edge';
  else if (/OPR\/|Opera/.test(s)) browser = 'opera';
  else if (/SamsungBrowser/.test(s)) browser = 'samsung';
  else if (/Firefox\/|FxiOS/.test(s)) browser = 'firefox';
  else if (/CriOS|Chrome\//.test(s)) browser = 'chrome';
  else if (/Safari\//.test(s)) browser = 'safari';

  return { device_type: device, os, browser };
}
