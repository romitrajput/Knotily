// Small helpers shared by the owner dashboard screens.
import { esc } from '../lib/util.js';
import { post } from '../lib/api.js';

export const inr = (paise) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
export const num = (n) => Number(n || 0).toLocaleString('en-IN');
export const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : '—');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);
export { esc };

// Messages float at the top-right of the dashboard so they're seen wherever you've scrolled.
export function flash(_host, msg, kind = 'ok') {
  let box = document.getElementById('adm-flashes');
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'adm-flashes' });
    document.body.appendChild(box);
  }
  const el = document.createElement('p');
  el.className = `adm-flash adm-flash-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : 4500);
}

// Upload a file straight to storage through a signed URL from our API.
// kind: image | design | video | audio. Resolves the public URL.
export async function upload(file, kind, productSlug, onProgress = () => {}) {
  const { uploadUrl, publicUrl } = await post('/api/admin/uploads', { kind, contentType: file.type, size: file.size, productSlug });
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('content-type', file.type);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}). Try again.`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
  return publicUrl;
}

// First frame of a local video file as a JPEG poster (best effort).
export function posterFrom(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (blob) => (URL.revokeObjectURL(url), resolve(blob));
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 4);
    };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        c.toBlob((b) => done(b ? new File([b], 'poster.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.82);
      } catch {
        done(null);
      }
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

export function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="adm-empty">${esc(text)}</td></tr>`;
}
