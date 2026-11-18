// High-level garment API used by the UI.
//   hasWebGL()                      -> boolean
//   thumbnail(product, color, side) -> Promise<url>  (cached renders for rack, grid, bag)
//   createViewer(canvas, product, color) -> live, draggable 3D model
import { createRenderer } from './renderer.js';
import { multiply, translation, rotationX, rotationY } from './math.js';
import { drawLogo, BRAND } from '../brand/logo.js';
import { buildGarment, buildTubes } from './mesh.js';
import { silhouette, INFLATE, hangerPaths, tiePaths, paintTexture, inkFor } from './garmentTypes.js';

const WOOD = '#8A5A3A';
const METAL = '#D8C9CE';

let glOK;
export function hasWebGL() {
  if (glOK !== undefined) return glOK;
  try {
    const c = document.createElement('canvas');
    glOK = !!c.getContext('webgl');
  } catch {
    glOK = false;
  }
  return glOK;
}

// ---------- fonts used in prints must be ready before painting ----------
let fontsReady;
function waitFonts() {
  if (!fontsReady) {
    fontsReady = Promise.race([
      Promise.all([
        document.fonts?.load('900 64px "Archivo"'),
        document.fonts?.load('700 64px "Archivo"'),
      ]).catch(() => {}),
      new Promise((r) => setTimeout(r, 1800)),
    ]);
  }
  return fontsReady;
}

// ---------- owner-uploaded print artwork (PNG/WebP on the tee) ----------
const artCache = new Map(); // url -> Promise<HTMLImageElement|null>
function loadImage(url) {
  if (!artCache.has(url)) {
    artCache.set(url, new Promise((res) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // keeps the texture canvas usable by WebGL
      img.decoding = 'async';
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
      setTimeout(() => res(null), 8000);
    }));
  }
  return artCache.get(url);
}
async function loadArt(product) {
  const a = product.artwork || {};
  const [front, back] = await Promise.all([a.front ? loadImage(a.front) : null, a.back ? loadImage(a.back) : null]);
  return { front, back };
}

// ---------- CPU geometry, shared across renderers ----------
const geoCache = new Map();
function geometry(type) {
  if (!geoCache.has(type)) {
    const body = buildGarment(silhouette(type), INFLATE[type]);
    const hanger = hangerPaths(type);
    geoCache.set(type, {
      body,
      ties: buildTubes(tiePaths(type, body.heightAt)),
      wood: hanger.wood.length ? buildTubes(hanger.wood) : null,
      metal: buildTubes(hanger.metal, 8),
    });
  }
  return geoCache.get(type);
}

const tieColor = (product, color) => color.tie || (product.art === 'jacket' ? '#F3EFE7' : inkFor(color.hex) === '#141210' ? shade(color.hex, -0.18) : shade(color.hex, 0.12));
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt)))));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// GPU model for one renderer
function makeModel(r, product, color, gpuCache, art = {}) {
  const type = product.art;
  const geo = geometry(type);
  if (!gpuCache.has(type)) {
    gpuCache.set(type, {
      body: r.upload(geo.body),
      ties: geo.ties.idx.length ? r.upload(geo.ties) : null,
      wood: geo.wood ? r.upload(geo.wood) : null,
      metal: r.upload(geo.metal),
    });
  }
  const g = gpuCache.get(type);
  const tex = r.texture(paintTexture(type, color, product, art));
  const fabric = product.fabric || {};
  // Edge light takes the garment's own hue (brand pink for near-black pieces).
  const rimColor = inkFor(color.hex) === '#F3EFE7' && parseInt(color.hex.slice(1), 16) < 0x303030 ? '#FF8A4C' : shade(color.hex, 0.35);
  const parts = [{ role: 'garment', gpu: g.body, color: color.hex, tex, cut: true, sheen: fabric.sheen ?? 0.26, spec: fabric.spec ?? 0.015, weave: fabric.weave ?? 0.035, rim: 0.32, rimColor }];
  if (g.ties) parts.push({ role: 'garment', gpu: g.ties, color: tieColor(product, color), sheen: 0.5, spec: 0.12, shine: 30, weave: 0, rim: 0.2, rimColor });
  if (g.wood) parts.push({ role: 'hanger', gpu: g.wood, color: WOOD, sheen: 0.1, spec: 0.25, shine: 40, weave: 0 });
  parts.push({ role: 'hanger', gpu: g.metal, color: METAL, sheen: 0.2, spec: 0.9, shine: 60, weave: 0 });
  return { parts, tex };
}

// ---------- thumbnails ----------
let thumbR = null;
const thumbGpu = new Map();
const thumbCache = new Map();
let queue = Promise.resolve();
export const THUMB = { w: 800, h: 1000 }; // 4:5 product stills
const STILL_FRAME = { centerY: -0.02, halfHeight: 1.42, halfWidth: 1.22, fov: (28 * Math.PI) / 180 };

export function thumbnail(product, color, side = 'front') {
  const key = `${product.id}|${color.name}|${side}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const job = (queue = queue.then(async () => {
    await waitFonts();
    const art = await loadArt(product);
    if (!thumbR) {
      const c = document.createElement('canvas');
      thumbR = createRenderer(c, { preserve: true });
    }
    thumbR.size(THUMB.w, THUMB.h, 1);
    const m = makeModel(thumbR, product, color, thumbGpu, art);
    // product shot: garment only (no hanger), almost straight on, like a studio still
    thumbR.draw(m.parts.filter((pt) => pt.role !== 'hanger').map((pt) => ({ ...pt, rim: (pt.rim || 0) * 0.35 })), { rotY: side === 'back' ? Math.PI + 0.06 : -0.06, rotX: 0.02, frame: STILL_FRAME });
    const blob = await new Promise((res) => thumbR.canvas.toBlob(res, 'image/png'));
    thumbR.gl.deleteTexture(m.tex);
    return URL.createObjectURL(blob);
  }));
  thumbCache.set(key, job);
  return job;
}

// Fill every <img data-thumb="productId|colorName"> inside root.
export async function hydrateThumbs(root, lookup) {
  const imgs = Array.from(root.querySelectorAll('img[data-thumb]'));
  for (const img of imgs) {
    const [id, colorName, side] = img.dataset.thumb.split('|');
    const p = lookup(id);
    if (!p) continue;
    const c = p.colors.find((x) => x.name === colorName) || p.colors[0];
    try {
      const url = await thumbnail(p, c, side || 'front');
      if (img.isConnected) {
        img.src = url;
        img.closest('[data-thumb-wrap]')?.classList.add('is-ready');
      }
    } catch (e) {
      console.warn('[knotily] thumbnail failed', e);
    }
  }
}

// ---------- purchase animation helpers ----------

// Knot'ily paper shopping bag (garment units). Origin: centre of the opening at y = BAG.top.
const BAG = { w: 1.3, d: 0.46, top: -0.92, h: 1.5 };

function paintBag() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const g = c.getContext('2d');
  // left half: front/back panel art. right half: side gusset.
  for (const [x0, w] of [[0, 1024], [1024, 1024]]) {
    g.fillStyle = BRAND.blue;
    g.fillRect(x0, 0, w, 1024);
    // paper grain
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
      g.fillRect(x0 + Math.random() * w, Math.random() * 1024, 1 + Math.random() * 3, 1);
    }
    // folded-over top band and its crease
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(x0, 0, w, 70);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(x0, 70, w, 3);
  }
  // gusset crease down the side panel
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(1024 + 508, 70, 8, 954);
  // the logo, centred a little above the middle of the panel
  drawLogo(g, 512, 470, 780, BRAND.orange, { made: true });
  return c;
}

function bagMeshes() {
  const { w, d, top, h } = BAG;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, y0 = top - h, y1 = top;
  const pos = [], nor = [], uv = [], idx = [];
  const quad = (a, b, cc, dd, n, uvs) => {
    const base = pos.length / 3;
    [a, b, cc, dd].forEach((p, i) => { pos.push(...p); nor.push(...n); uv.push(...uvs[i]); });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const FRONT = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]];
  const SIDE = [[0.5, 0], [1, 0], [1, 1], [0.5, 1]];
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], FRONT);   // front
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], FRONT);  // back
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], SIDE);    // right gusset
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], SIDE);   // left gusset
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], SIDE);   // base
  const n = pos.length / 3;
  const body = { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), dist: new Float32Array(n).fill(1), idx: new Uint16Array(idx) };
  // rope handles: an arch on the front and one on the back
  const arch = (z) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * (i / 16);
      pts.push([-0.24 * Math.cos(a), top - 0.1 + 0.52 * Math.sin(a), z]);
    }
    return { points: pts, radius: 0.022 };
  };
  const handles = buildTubes([arch(z1 - 0.012), arch(z0 + 0.012)], 8);
  return { body, handles };
}

// Retail fold plan per garment type. Every fold goes BEHIND the garment, so the
// front (and its print) stays on top, like a shop-folded tee.
function foldPlan(type) {
  const poly = silhouette(type);
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of poly) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const top = Math.min(maxY, 1.02);
  const body = { oversized: 0.79, tee: 0.68, longsleeve: 0.69, hoodie: 0.72, jacket: 0.73, tank: 0.65, halter: 0.58, skirt: 0.7, pants: 0.68 }[type] || 0.7;
  const side = body * 0.44;
  const D = INFLATE[type].depth;
  const zmax = D * 0.09, zmin0 = -D * 0.85 * 0.09, e = 0.003;
  let m = zmin0;
  const folds = [];
  const add = (f, shared = false) => {
    const piv = shared ? folds[folds.length - 1].piv : m - e;
    if (!shared) m = 2 * piv - zmax;
    folds.push({ ...f, piv, dir: -1 });
  };
  let y5 = (minY + top) / 2, finalTop = top, finalBottom = y5, halfW = side, cx = 0;
  if (type === 'pants') {
    const mid = (minY + top) / 2;
    add({ axis: 'x', line: 0, side: -1 });                       // left leg onto the right
    add({ axis: 'y', line: mid, side: -1 });                     // hems up to the middle
    add({ axis: 'y', line: (mid + top) / 2, side: -1 });         // and in half again
    finalBottom = (mid + top) / 2; halfW = body / 2; cx = body / 2;
  } else if (type === 'skirt' || type === 'tank' || type === 'halter') {
    add({ axis: 'x', line: -side, side: -1 });                   // left side back
    add({ axis: 'x', line: side, side: 1 });                     // right side back
    add({ axis: 'y', line: y5, side: -1 });                      // bottom up
  } else {
    add({ axis: 'x', line: -body, side: -1 });                   // left sleeve back
    add({ axis: 'x', line: body, side: 1 }, true);               // right sleeve back (same layer)
    add({ axis: 'x', line: -side, side: -1 });                   // left side back
    add({ axis: 'x', line: side, side: 1 });                     // right side back
    add({ axis: 'y', line: y5, side: -1 });                      // bottom up in half
  }
  return {
    folds,
    center: [cx, (finalTop + finalBottom) / 2, (m + zmax) / 2],
    size: [halfW * 2, finalTop - finalBottom, zmax - m],
  };
}

const smoothstep = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t) => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

// Tight camera frame around one garment (hook to hem), used by the live viewer.
function fitFrame(type) {
  const poly = silhouette(type);
  let minY = Infinity, maxX = 0;
  for (const [x, y] of poly) {
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, Math.abs(x));
  }
  const top = 1.42, bottom = minY - 0.1;
  return { centerY: (top + bottom) / 2, halfHeight: ((top - bottom) / 2) * 1.04, halfWidth: maxX * 1.12 };
}

// ---------- live viewer ----------
export function createViewer(canvas, product, color, { reducedMotion = false, onTurn = () => {}, autoSpin = 0 } = {}) {
  const r = createRenderer(canvas);
  const gpu = new Map();
  let model = null;
  let p = product;
  const st = { rotY: -0.18, target: -0.18, vel: 0, rotX: 0.03, sway: 0, dragging: false, lastX: 0, t: 0, running: true, raf: 0 };

  let frameFit = fitFrame(product.art);
  let buy = null;  // running purchase animation
  async function setGarment(prod, col) {
    p = prod;
    frameFit = fitFrame(prod.art);
    await waitFonts();
    const art = await loadArt(prod);
    if (model) r.gl.deleteTexture(model.tex);
    model = makeModel(r, prod, col, gpu, art);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    r.size(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
  }

  function frame(now) {
    st.raf = 0;
    const dt = st.t ? Math.min(0.1, now / 1000 - st.t) : 0;
    st.t = now / 1000;
    if (autoSpin && !st.dragging) {
      st.rotY += autoSpin * dt;
      st.target = st.rotY;
    }
    if (!st.dragging) {
      st.rotY += st.vel;
      st.vel *= 0.92;
      if (Math.abs(st.vel) < 0.0008) st.rotY += (st.target - st.rotY) * 0.09;
    }
    st.sway = reducedMotion ? 0 : Math.sin(st.t * 0.9) * 0.012;
    if (model && buy) drawPurchase(now / 1000);
    else if (model) {
      let parts = model.parts;
      if (st.rehang !== undefined) {
        const k = Math.min(1, (st.t - st.rehang) / 0.6);
        const y = (1 - easeOutBack(k)) * 2.4;
        if (k >= 1) st.rehang = undefined;
        else parts = parts.map((pt) => ({ ...pt, model: translation(0, y, 0) }));
      }
      r.draw(parts, { rotY: st.rotY, rotX: st.rotX, sway: st.sway, frame: frameFit });
    }
    onTurn(st.rotY);
    if (st.running) st.raf = requestAnimationFrame(frame);
  }

  // ---------- purchase: unhook -> fold (retail style) -> into the Knot'ily bag -> carried away ----------
  const WIDE = { centerY: -0.62, halfHeight: 1.82, halfWidth: 1.25 };
  const BAG_YAW = -0.32;
  const easeOutBack = (t) => { const c1 = 1.4; return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  function drawPurchase(nowS) {
    const t = nowS - buy.start;
    const plan = buy.plan;
    const n = plan.folds.length;
    // 0–0.95  unhook: the hanger lifts off, the piece slips and squares up to the camera
    const lift = Math.pow(smoothstep(0.08, 0.95, t), 2.2);
    const slip = Math.sin(Math.min(1, t / 0.55) * Math.PI) * -0.09;
    st.rotY = lerp(buy.rot0, 0, smoothstep(0, 0.5, t));
    // 0.7 – ~2.7  folds, one after another (sleeves together)
    let at = 0.7;
    const folds = plan.folds.map((f, i) => {
      const shared = i > 0 && f.piv === plan.folds[i - 1].piv;
      if (shared) at -= 0.3;
      const p = smoothstep(at, at + 0.5, t);
      at += 0.42;
      return { ...f, p };
    });
    const foldEnd = at + 0.1;
    const flat = smoothstep(0.55, 1.05, t);
    // bag rises into frame under the folded piece
    const zoom = smoothstep(foldEnd - 0.15, foldEnd + 0.45, t);
    const tilt = lerp(0.03, 0.2, zoom);
    const rise = smoothstep(foldEnd, foldEnd + 0.6, t);
    const bagUp = rise > 0 ? easeOutBack(rise) : 0;
    // folded piece slides down into the bag
    const t0 = foldEnd + 0.55;
    const slide = smoothstep(t0, t0 + 0.75, t);
    const settle = t > t0 + 0.75 ? Math.sin(Math.min(1, (t - t0 - 0.75) / 0.32) * Math.PI) * 0.05 : 0;
    // the bag is picked up and carried off
    const t1 = t0 + 1.15;
    const carry = smoothstep(t1, t1 + 0.9, t);
    const c2 = carry * carry;
    const bagPos = [c2 * 1.2, lerp(-2.8, 0, bagUp) + c2 * 3.8 - settle, -c2 * 5];
    const swing = Math.sin(carry * Math.PI) * 0.12;
    const frame = {
      centerY: lerp(frameFit.centerY, WIDE.centerY, zoom),
      halfHeight: lerp(frameFit.halfHeight, WIDE.halfHeight, zoom),
      halfWidth: lerp(frameFit.halfWidth || 0, WIDE.halfWidth, zoom),
    };
    const yaw = BAG_YAW + (1 - rise) * 0.5 + swing;
    const bagM = multiply(translation(bagPos[0], bagPos[1], bagPos[2]), multiply(rotationY(yaw), rotationX(swing * 0.5)));
    // garment: from where it hangs to standing upright inside the bag
    const c = plan.center;
    const local = [0, BAG.top - BAG.h + plan.size[1] / 2 + 0.06, 0];
    const k = slide;
    const ky = 1 - Math.pow(1 - k, 2) * (1 - k); // eases into the bag
    const wl = [local[0] * Math.cos(yaw) + local[2] * Math.sin(yaw), local[1], -local[0] * Math.sin(yaw) + local[2] * Math.cos(yaw)];
    const inBag = k >= 1;
    const pos = inBag
      ? null
      : [lerp(c[0], wl[0] + bagPos[0], k), lerp(c[1] + slip, wl[1] + bagPos[1], ky), lerp(c[2], wl[2] + bagPos[2], k)];
    const gM = inBag
      ? multiply(bagM, multiply(translation(local[0], local[1], local[2]), translation(-c[0], -c[1], -c[2])))
      : multiply(translation(pos[0], pos[1], pos[2]), multiply(rotationY(yaw * k), translation(-c[0], -c[1], -c[2])));
    const hM = translation(0, lift * 3.2, 0);
    const gone = t > t1 + 0.92;
    const parts = gone ? [] : model.parts.map((pt) => ({ ...pt, model: pt.role === 'hanger' ? hM : gM }));
    if (rise > 0 && !gone) parts.push(...bag.parts.map((pt) => ({ ...pt, model: bagM })));
    r.draw(parts, { rotY: st.rotY, rotX: tilt, sway: 0, frame, fold: { flat, folds } });
    if (gone && !buy.done) {
      buy.done = true;
      buy.resolve();
    }
  }

  let bag = null;
  function purchase() {
    if (buy) return buy.promise;
    if (!bag) {
      const m = bagMeshes();
      bag = {
        parts: [
          { role: 'bag', gpu: r.upload(m.body), color: BRAND.blue, tex: r.texture(paintBag()), sheen: 0.12, spec: 0.05, shine: 20, weave: 0.015 },
          { role: 'bag', gpu: r.upload(m.handles), color: BRAND.orange, sheen: 0.3, spec: 0.1, shine: 20, weave: 0 },
        ],
      };
    }
    let resolve;
    const promise = new Promise((res) => (resolve = res));
    const turns = Math.round(st.rotY / (2 * Math.PI));
    buy = { start: st.t, rot0: st.rotY - turns * 2 * Math.PI, plan: foldPlan(p.art), resolve, promise, done: false };
    return promise;
  }

  // Put a fresh one back on the hanger (drops in from above).
  function rehang() {
    buy = null;
    st.rotY = st.target = -0.18;
    st.vel = 0;
    st.rehang = st.t;
  }

  const down = (e) => {
    if (buy) return;
    st.dragging = true;
    st.lastX = e.clientX;
    st.vel = 0;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!st.dragging) return;
    const dx = e.clientX - st.lastX;
    st.lastX = e.clientX;
    st.rotY += dx * 0.012;
    st.vel = dx * 0.012;
  };
  const up = () => {
    if (!st.dragging) return;
    st.dragging = false;
    // settle on whichever side faces the viewer
    const turns = Math.round((st.rotY + st.vel * 10) / Math.PI);
    st.target = turns * Math.PI + (turns % 2 === 0 ? -0.18 : 0);
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const ready = setGarment(product, color).then(() => (st.raf = requestAnimationFrame(frame)));

  return {
    ready,
    purchase,
    rehang,
    busy: () => !!buy,
    setColor: (col) => setGarment(p, col),
    setProduct: (prod, col) => setGarment(prod, col),
    showSide(side) {
      const base = Math.round(st.rotY / (2 * Math.PI)) * 2 * Math.PI;
      st.vel = 0;
      st.target = side === 'back' ? base + Math.PI : base - 0.18;
    },
    side: () => (Math.abs(Math.round(st.rotY / Math.PI)) % 2 === 0 ? 'front' : 'back'),
    destroy() {
      // never strand a purchase: whoever awaits it still gets to add the item
      if (buy && !buy.done) { buy.done = true; buy.resolve(); }
      st.running = false;
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      r.dispose();
    },
  };
}
