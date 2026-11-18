// The owner's track for a product: plays at the volume set in the owner settings
// (20% by default) when the shopper opens the product, loops quietly, and stops when
// they leave. One tap mutes it, and the choice is remembered across the whole site.
import { config } from '../config.js';
import { storage, esc } from '../lib/util.js';
import { track } from '../lib/analytics.js';

const pref = storage('knotily.audio.muted', false);
let audio = null;
let pill = null;
let current = null; // { productId, url, title }

const icon = (muted) =>
  muted
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function ensure() {
  if (audio) return;
  audio = new Audio();
  audio.loop = true;
  audio.preload = 'none';
  pill = document.createElement('div');
  pill.className = 'track-pill';
  pill.hidden = true;
  pill.innerHTML = `
    <span class="track-eq" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="track-title" data-title></span>
    <button type="button" class="track-btn" data-toggle></button>`;
  document.body.appendChild(pill);
  pill.querySelector('[data-toggle]').addEventListener('click', toggle);
  // pause when a product video starts playing with sound
  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLVideoElement && !e.target.muted && audio && !audio.paused) audio.pause(), render();
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && audio && !audio.paused) audio.pause(), (audio.dataset.resume = '1');
    else if (!document.hidden && audio?.dataset.resume) delete audio.dataset.resume, attempt();
  });
}

function render() {
  if (!pill || !current) return;
  const muted = pref.read();
  const playing = !audio.paused;
  pill.classList.toggle('is-playing', playing && !muted);
  pill.querySelector('[data-title]').textContent = current.title || 'Now playing';
  const b = pill.querySelector('[data-toggle]');
  const label = muted || !playing ? 'Play track' : 'Mute track';
  b.innerHTML = `${icon(muted || !playing)}<span class="sr-only">${esc(label)}</span>`;
  b.setAttribute('aria-label', label);
  b.title = label;
}

async function attempt() {
  if (!current || pref.read()) return render();
  audio.volume = config.audioVolume;
  try {
    await audio.play();
    track('audio_play', { product_id: current.productId });
  } catch {
    /* autoplay blocked until the shopper interacts; the pill shows Play */
  }
  render();
}

function toggle() {
  if (!current) return;
  const muted = pref.read();
  if (muted || audio.paused) {
    pref.write(false);
    track('audio_unmute', { product_id: current.productId });
    attempt();
  } else {
    pref.write(true);
    audio.pause();
    track('audio_mute', { product_id: current.productId });
    render();
  }
}

export function playProductAudio(product) {
  if (!product?.audio?.url) return stopProductAudio();
  ensure();
  if (current?.url !== product.audio.url) {
    audio.pause();
    audio.src = product.audio.url;
    audio.currentTime = 0;
  }
  current = { productId: product.id, url: product.audio.url, title: product.audio.title };
  pill.hidden = false;
  requestAnimationFrame(() => pill.classList.add('in'));
  attempt();
}

export function stopProductAudio() {
  current = null;
  if (!audio) return;
  audio.pause();
  pill.classList.remove('in');
  setTimeout(() => !current && (pill.hidden = true), 250);
}
