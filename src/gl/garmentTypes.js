// Garment library: silhouette, inflation, hanger, ties and surface details per type.
// All coordinates are in garment space (y up, shoulders near y = 1, hook top at y = 1.375).
import { mirrorHalf, chaikin, TEX_BOX } from './mesh.js';
import { drawLogo } from '../brand/logo.js';

const S = 1024 / TEX_BOX.size; // texture pixels per garment unit (each atlas half is 1024px)

// ---------- silhouettes (right half, top-centre clockwise to bottom-centre) ----------
const HALVES = {
  oversized: [[0, 0.98], [0.2, 1.0], [0.36, 0.985], [0.6, 0.95], [0.82, 0.86], [0.98, 0.62], [1.14, 0.2], [0.88, 0.04], [0.79, 0.24], [0.79, 0.0], [0.8, -1.12], [0.4, -1.14], [0, -1.14]],
  tee: [[0, 0.97], [0.21, 0.99], [0.36, 0.975], [0.6, 0.93], [0.8, 0.8], [1.02, 0.52], [0.84, 0.36], [0.69, 0.5], [0.68, 0.0], [0.69, -0.98], [0.35, -1.0], [0, -1.0]],
  tank: [[0, 0.94], [0.17, 0.975], [0.24, 1.0], [0.37, 1.0], [0.4, 0.85], [0.46, 0.66], [0.56, 0.52], [0.64, 0.46], [0.64, 0.0], [0.66, -0.98], [0.3, -1.0], [0, -1.0]],
  halter: [[0, 0.92], [0.05, 1.0], [0.11, 1.0], [0.2, 0.7], [0.36, 0.42], [0.55, 0.22], [0.6, 0.0], [0.62, -0.42], [0.3, -0.46], [0, -0.47]],
  hoodie: [[0, 1.2], [0.16, 1.19], [0.28, 1.13], [0.36, 1.0], [0.42, 0.92], [0.66, 0.87], [0.84, 0.66], [0.98, 0.3], [1.06, -0.2], [1.1, -0.6], [0.88, -0.64], [0.84, -0.2], [0.79, 0.1], [0.7, 0.45], [0.71, 0.0], [0.73, -0.95], [0.35, -0.98], [0, -0.98]],
  longsleeve: [[0, 0.97], [0.21, 0.99], [0.36, 0.975], [0.58, 0.92], [0.78, 0.7], [0.95, 0.3], [1.03, -0.2], [1.07, -0.62], [0.88, -0.65], [0.84, -0.2], [0.78, 0.12], [0.68, 0.47], [0.68, 0.0], [0.7, -0.98], [0.35, -1.0], [0, -1.0]],
  jacket: [[0, 0.98], [0.23, 1.0], [0.4, 0.98], [0.62, 0.93], [0.82, 0.7], [1.0, 0.3], [1.08, -0.15], [1.12, -0.58], [0.9, -0.62], [0.86, -0.2], [0.8, 0.1], [0.72, 0.45], [0.73, 0.0], [0.74, -0.8], [0.35, -0.82], [0, -0.82]],
  pants: [[0, 1.05], [0.3, 1.05], [0.58, 1.05], [0.62, 0.7], [0.66, 0.2], [0.69, -0.6], [0.7, -1.3], [0.4, -1.3], [0.12, -1.3], [0.08, -0.5], [0.04, 0.1], [0, 0.12]],
  skirt: [[0, 1.05], [0.5, 1.05], [0.56, 0.7], [0.68, 0.2], [0.8, -0.35], [0.4, -0.38], [0, -0.4]],
};

const POLY = {};
export function silhouette(type) {
  if (!POLY[type]) POLY[type] = chaikin(mirrorHalf(HALVES[type]), 1);
  return POLY[type];
}

export const INFLATE = {
  oversized: { depth: 0.08, radius: 0.12 },
  tee: { depth: 0.07, radius: 0.1 },
  tank: { depth: 0.06, radius: 0.09 },
  halter: { depth: 0.055, radius: 0.08 },
  hoodie: { depth: 0.095, radius: 0.15 },
  longsleeve: { depth: 0.065, radius: 0.1 },
  jacket: { depth: 0.1, radius: 0.15 },
  pants: { depth: 0.06, radius: 0.09 },
  skirt: { depth: 0.065, radius: 0.1 },
};

// ---------- hangers ----------
const HOOK_STEM_TOP = 1.3;
function hook(fromY) {
  const pts = [[0, fromY, 0], [0, HOOK_STEM_TOP, 0]];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI - (i / 10) * (Math.PI * 1.25);
    pts.push([0.075 + 0.075 * Math.cos(a), HOOK_STEM_TOP + 0.075 * Math.sin(a), 0]);
  }
  return { points: pts, radius: 0.012 };
}

export function hangerPaths(type) {
  if (type === 'pants' || type === 'skirt') {
    const y = 1.05 + 0.1;
    return {
      metal: [
        hook(y),
        { points: [[-0.62, y, 0], [0, y, 0], [0.62, y, 0]], radius: 0.016, smooth: false },
        ...[-0.42, 0.42].map((x) => ({ points: [[x, y + 0.01, 0], [x, 0.98, 0]], radius: 0.034, smooth: false })),
      ],
      wood: [],
    };
  }
  const half = type === 'halter' ? 0.5 : 0.62;
  const top = type === 'halter' ? 0.9 : 0.93;
  const bar = [];
  for (let i = -6; i <= 6; i++) {
    const x = (i / 6) * half;
    bar.push([x, top - 0.11 * Math.pow(Math.abs(x) / half, 1.5), 0]);
  }
  return { metal: [hook(top + 0.02)], wood: [{ points: bar, radius: 0.034 }] };
}

// ---------- ties, laces and drawcords ----------
export function tiePaths(type, heightAt) {
  const on = (x, y) => heightAt(x, y);
  // Two loose cord ends with metal tips, hanging from a point on the garment.
  const cords = (x0, y0, len, spread, r = 0.012) =>
    [-1, 1].flatMap((s) => {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        const x = x0 + s * (spread + 0.02 * Math.sin(k * 3));
        const y = y0 - k * len;
        pts.push([x, y, on(x, y) + r + 0.004]);
      }
      const end = pts[pts.length - 1];
      return [
        { points: pts, radius: r },
        { points: [[end[0], end[1] + 0.01, end[2]], [end[0], end[1] - 0.06, end[2] + 0.004]], radius: r * 1.4, smooth: false },
      ];
    });
  switch (type) {
    case 'hoodie':
      return cords(0, 0.84, 0.62, 0.09);
    case 'pants':
      return cords(0, 0.98, 0.42, 0.06, 0.011);
    case 'halter': {
      // neck strap looping over the hanger
      const strap = [];
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI * (i / 16);
        strap.push([-0.08 * Math.cos(a), 0.96 + 0.07 * Math.sin(a), 0.02]);
      }
      return [{ points: strap, radius: 0.022, flat: true }];
    }
    case 'jacket': {
      const lace = [];
      for (let i = 0; i <= 14; i++) {
        const y = 0.78 - i * 0.1;
        const x = (i % 2 ? 1 : -1) * 0.07;
        lace.push([x, y, on(x, y) + 0.014]);
      }
      return [{ points: lace, radius: 0.012 }, ...cords(0, 0.8, 0.2, 0.05, 0.011)];
    }
    default:
      return [];
  }
}

// ---------- surface details painted into the texture atlas ----------
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const inkFor = (hex) => (luminance(hex) > 0.35 ? '#141210' : '#F3EFE7');

function space(ctx, side) {
  // garment units -> atlas pixels. Back half uses viewer-from-behind coordinates.
  ctx.setTransform(S, 0, 0, -S, (side === 'back' ? 1024 : 0) + -TEX_BOX.x0 * S, (TEX_BOX.y0 + TEX_BOX.size) * S);
}
function path(ctx, pts, close = true) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
}
const sym = (pts) => pts.map(([x, y]) => [-x, y]);
function stroke(ctx, pts, width, color, dash) {
  path(ctx, pts, false);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.setLineDash(dash ? dash : []);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.setLineDash([]);
}
const stitch = (ctx, pts, color = 'rgba(0,0,0,.28)') => stroke(ctx, pts, 0.008, color, [0.028, 0.02]);
const seam = (ctx, pts, color = 'rgba(0,0,0,.22)') => stroke(ctx, pts, 0.01, color);
function rib(ctx, pts, width, base = 'rgba(0,0,0,.10)') {
  stroke(ctx, pts, width, base);
  stroke(ctx, pts, width * 0.85, 'rgba(0,0,0,.08)', [0.006, 0.014]);
}
function curve(p0, c, p1, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]]);
  }
  return out;
}
function text(ctx, side, str, x, y, size, { color = '#000', weight = 900, stretch = 'expanded', spacing = 0, angle = 0, align = 'center', italic = false } = {}) {
  const px = (side === 'back' ? 1024 : 0) + (x - TEX_BOX.x0) * S;
  const py = (TEX_BOX.y0 + TEX_BOX.size - y) * S;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, px, py);
  ctx.rotate(angle);
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size * S}px "Archivo", "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  try { ctx.fontStretch = stretch; } catch { /* older browsers */ }
  try { ctx.letterSpacing = `${spacing * S}px`; } catch { /* older browsers */ }
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, 0, 0);
  ctx.restore();
}
// Brand wordmark printed on the garment, centred at (x, y), `width` garment units wide.
function logo(ctx, side, x, y, width, color, opts) {
  const px = (side === 'back' ? 1024 : 0) + (x - TEX_BOX.x0) * S;
  const py = (TEX_BOX.y0 + TEX_BOX.size - y) * S;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawLogo(ctx, px, py, width * S, color, opts);
  ctx.restore();
}
function neckOpening(ctx, inner = 'rgba(0,0,0,.32)') {
  const front = curve([-0.22, 0.985], [0, 0.66], [0.22, 0.985]);
  path(ctx, [[-0.3, 1.1], ...front, [0.3, 1.1]]);
  ctx.fillStyle = inner;
  ctx.fill();
  rib(ctx, front, 0.05);
}
function distress(ctx, pts) {
  pts.forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fill();
    ctx.lineWidth = 0.006;
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.stroke();
  });
}

const PAINT = {
  oversized(ctx, side, c, ink, product) {
    const pr = product.print || {};
    if (side === 'front') {
      neckOpening(ctx);
      const lines = pr.front || [];
      if (pr.frontStyle === 'chest') {
        lines.forEach((l, i) => text(ctx, side, l, -0.27, 0.6 - i * 0.09, 0.075, { color: ink, weight: 800, stretch: 'normal', align: 'left' }));
      } else {
        const size = pr.frontSize || 0.17;
        lines.forEach((l, i) => text(ctx, side, l, 0, 0.5 - i * size * 1.02, size, { color: ink, weight: 900 }));
      }
    } else {
      rib(ctx, curve([-0.22, 0.985], [0, 0.93], [0.22, 0.985]), 0.035);
      logo(ctx, side, 0, 0.85, 0.24, ink, { tm: false });
      const back = pr.back || [];
      const size = pr.backSize || 0.27;
      back.forEach((l, i) => text(ctx, side, l, 0, 0.52 - i * size * 0.98, size, { color: ink, weight: 900 }));
      if (pr.sub) text(ctx, side, pr.sub, 0, 0.52 - back.length * size * 0.98 + size * 0.42, 0.048, { color: ink, weight: 700, spacing: 0.012 });
    }
    const drop = curve([0.82, 0.86], [0.86, 0.5], [0.79, 0.24]);
    seam(ctx, drop); seam(ctx, sym(drop));
    stitch(ctx, [[-0.79, -1.06], [0.79, -1.06]]);
    stitch(ctx, [[1.1, 0.26], [0.9, 0.1]]); stitch(ctx, sym([[1.1, 0.26], [0.9, 0.1]]));
  },
  tee(ctx, side, c, ink) {
    if (side === 'front') {
      neckOpening(ctx);
      logo(ctx, side, 0, 0.5, 0.78, ink);
      text(ctx, side, 'TIED UP RIGHT NOW', 0, 0.34, 0.048, { color: ink, weight: 700, spacing: 0.012 });
    } else {
      rib(ctx, curve([-0.22, 0.985], [0, 0.93], [0.22, 0.985]), 0.035);
      text(ctx, side, 'LOOSE', 0, 0.46, 0.27, { color: ink, weight: 900 });
      text(ctx, side, 'ENDS', 0, 0.2, 0.27, { color: ink, weight: 900 });
      text(ctx, side, 'DROP 04', 0, -0.02, 0.045, { color: ink, weight: 600, spacing: 0.012 });
    }
    seam(ctx, [[0.22, 0.985], [0.56, 0.92]]); seam(ctx, sym([[0.22, 0.985], [0.56, 0.92]]));
    seam(ctx, curve([0.56, 0.92], [0.6, 0.6], [0.67, 0.48])); seam(ctx, sym(curve([0.56, 0.92], [0.6, 0.6], [0.67, 0.48])));
    stitch(ctx, [[-0.66, -0.93], [0.66, -0.93]]);
    stitch(ctx, [[0.965, 0.585], [0.8, 0.36]]); stitch(ctx, sym([[0.965, 0.585], [0.8, 0.36]]));
  },
  tank(ctx, side, c, ink) {
    if (side === 'front') {
      const scoop = curve([-0.25, 1.0], [0, 0.52], [0.25, 1.0]);
      path(ctx, [[-0.3, 1.1], ...scoop, [0.3, 1.1]]);
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.fill();
      rib(ctx, scoop, 0.04);
      text(ctx, side, 'NO STRINGS', 0, 0.42, 0.11, { color: ink, weight: 900 });
      distress(ctx, [[-0.16, 0.72, 0.022], [0.2, 0.66, 0.016], [0.1, 0.78, 0.012], [-0.3, -0.6, 0.02], [0.34, -0.72, 0.014]]);
    } else {
      rib(ctx, curve([-0.25, 1.0], [0, 0.88], [0.25, 1.0]), 0.035);
      text(ctx, side, 'ATTACHED', 0, 0.5, 0.15, { color: ink, weight: 900 });
    }
    const arm = curve([0.4, 1.0], [0.45, 0.5], [0.65, 0.42]);
    rib(ctx, arm, 0.035); rib(ctx, sym(arm), 0.035);
    stitch(ctx, [[-0.64, -0.93], [0.64, -0.93]]);
  },
  halter(ctx, side) {
    for (let i = -3; i <= 3; i++) stroke(ctx, curve([i * 0.015, 0.9], [i * 0.08, 0.4], [i * 0.15, -0.38]), 0.02, 'rgba(0,0,0,.06)');
    rib(ctx, [[-0.56, -0.44], [0.56, -0.44]], 0.07);
    if (side === 'front') {
      path(ctx, [[0.34, -0.33], [0.44, -0.33], [0.44, -0.27], [0.34, -0.27]]);
      ctx.fillStyle = '#141214';
      ctx.fill();
    }
  },
  hoodie(ctx, side, c, ink) {
    if (side === 'front') {
      ctx.beginPath();
      ctx.ellipse(0, 1.0, 0.2, 0.17, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.42)';
      ctx.fill();
      ctx.lineWidth = 0.045;
      ctx.strokeStyle = 'rgba(0,0,0,.12)';
      ctx.stroke();
      const pocket = [[-0.4, -0.3], [0.4, -0.3], [0.5, -0.8], [-0.5, -0.8]];
      path(ctx, pocket);
      ctx.fillStyle = 'rgba(0,0,0,.035)';
      ctx.fill();
      stitch(ctx, [...pocket, pocket[0]]);
      seam(ctx, curve([0.4, -0.3], [0.38, -0.55], [0.5, -0.8]), 'rgba(0,0,0,.3)');
      seam(ctx, sym(curve([0.4, -0.3], [0.38, -0.55], [0.5, -0.8])), 'rgba(0,0,0,.3)');
      logo(ctx, side, -0.34, 0.52, 0.3, ink, { tm: false });
    } else {
      seam(ctx, [[0, 1.2], [0, 0.88]]);
      logo(ctx, side, 0, 0.44, 0.9, ink, { made: true });
      text(ctx, side, 'MADE TO BE UNDONE', 0, 0.26, 0.045, { color: ink, weight: 700, spacing: 0.012 });
    }
    rib(ctx, [[-0.72, -0.9], [0.72, -0.9]], 0.1);
    rib(ctx, [[0.88, -0.6], [1.1, -0.56]], 0.09); rib(ctx, sym([[0.88, -0.6], [1.1, -0.56]]), 0.09);
    seam(ctx, curve([0.66, 0.86], [0.66, 0.6], [0.7, 0.45])); seam(ctx, sym(curve([0.66, 0.86], [0.66, 0.6], [0.7, 0.45])));
  },
  longsleeve(ctx, side, c, ink) {
    if (side === 'front') {
      neckOpening(ctx);
      logo(ctx, side, 0, 0.54, 0.5, ink, { tm: false });
      text(ctx, side, "DON'T BE SHY", 0.93, -0.12, 0.05, { color: ink, weight: 800, spacing: 0.01, angle: 1.32 });
    } else {
      rib(ctx, curve([-0.22, 0.985], [0, 0.93], [0.22, 0.985]), 0.035);
      text(ctx, side, "k'", 0, 0.8, 0.09, { color: ink, weight: 900 });
    }
    rib(ctx, [[0.88, -0.6], [1.08, -0.57]], 0.08); rib(ctx, sym([[0.88, -0.6], [1.08, -0.57]]), 0.08);
    seam(ctx, curve([0.58, 0.91], [0.62, 0.6], [0.68, 0.46])); seam(ctx, sym(curve([0.58, 0.91], [0.62, 0.6], [0.68, 0.46])));
    stitch(ctx, [[-0.68, -0.93], [0.68, -0.93]]);
  },
  jacket(ctx, side, c, ink) {
    const trim = c.hex2 || '#F3EFE7';
    // sleeves in the contrast colour, body in the main colour
    path(ctx, [[-1.3, 1.2], [1.3, 1.2], [1.3, -1], [-1.3, -1]]);
    ctx.fillStyle = trim;
    ctx.fill();
    const bodyHalf = [[0, 1.05], [0.5, 0.96], [0.66, 0.7], [0.72, 0.45], [0.75, -0.85], [0, -0.85]];
    path(ctx, mirrorHalf(bodyHalf));
    ctx.fillStyle = c.hex;
    ctx.fill();
    seam(ctx, curve([0.5, 0.96], [0.68, 0.75], [0.72, 0.45]), 'rgba(0,0,0,.35)');
    seam(ctx, sym(curve([0.5, 0.96], [0.68, 0.75], [0.72, 0.45])), 'rgba(0,0,0,.35)');
    const stripes = (pts, w) => {
      stroke(ctx, pts, w, trim);
      stroke(ctx, pts, w * 0.28, ink === '#F3EFE7' ? '#141210' : c.hex);
    };
    stripes([[-0.74, -0.76], [0.74, -0.76]], 0.11);
    stripes([[0.9, -0.55], [1.12, -0.51]], 0.1); stripes(sym([[0.9, -0.55], [1.12, -0.51]]), 0.1);
    if (side === 'front') {
      stripes(curve([-0.24, 1.0], [0, 0.72], [0.24, 1.0]), 0.07);
      seam(ctx, [[0, 0.8], [0, -0.82]], 'rgba(0,0,0,.4)');
      ctx.beginPath();
      ctx.arc(-0.4, 0.45, 0.14, 0, Math.PI * 2);
      ctx.fillStyle = trim;
      ctx.fill();
      ctx.lineWidth = 0.018;
      ctx.strokeStyle = '#141210';
      ctx.stroke();
      text(ctx, side, 'k', -0.4, 0.45, 0.2, { color: c.hex, weight: 900 });
    } else {
      stripes(curve([-0.24, 1.0], [0, 0.95], [0.24, 1.0]), 0.06);
      logo(ctx, side, 0, 0.6, 0.86, trim, { tm: false });
      text(ctx, side, '04', 0, 0.18, 0.42, { color: trim, weight: 900 });
    }
  },
  pants(ctx, side) {
    rib(ctx, [[-0.58, 1.0], [0.58, 1.0]], 0.1, 'rgba(0,0,0,.08)');
    [-0.4, -0.12, 0.12, 0.4].forEach((x) => {
      path(ctx, [[x - 0.025, 1.05], [x + 0.025, 1.05], [x + 0.025, 0.92], [x - 0.025, 0.92]]);
      ctx.fillStyle = 'rgba(0,0,0,.1)';
      ctx.fill();
    });
    stitch(ctx, [[-0.7, -1.24], [-0.12, -1.24]]);
    stitch(ctx, [[0.12, -1.24], [0.7, -1.24]]);
    if (side === 'front') {
      seam(ctx, [[0, 0.95], [0, 0.18]], 'rgba(0,0,0,.3)');
      stitch(ctx, curve([0.08, 0.95], [0.1, 0.36], [0.0, 0.3]));
      [1, -1].forEach((s) => {
        const px = s * 0.5;
        const pocket = [[px - 0.15, -0.2], [px + 0.15, -0.2], [px + 0.15, -0.66], [px - 0.15, -0.66]].map(([x, y]) => [x, y]);
        path(ctx, pocket);
        ctx.fillStyle = 'rgba(0,0,0,.05)';
        ctx.fill();
        stitch(ctx, [...pocket, pocket[0]]);
        path(ctx, [[px - 0.16, -0.18], [px + 0.16, -0.18], [px + 0.16, -0.3], [px - 0.16, -0.3]]);
        ctx.fillStyle = 'rgba(0,0,0,.09)';
        ctx.fill();
        seam(ctx, curve([s * 0.58, 0.95], [s * 0.36, 0.86], [s * 0.3, 0.6]));
      });
    } else {
      [1, -1].forEach((s) => {
        const p = [[s * 0.18, 0.78], [s * 0.46, 0.78], [s * 0.46, 0.48], [s * 0.18, 0.48]];
        path(ctx, p);
        ctx.fillStyle = 'rgba(0,0,0,.05)';
        ctx.fill();
        stitch(ctx, [...p, p[0]]);
      });
      seam(ctx, [[0, 0.95], [0, 0.12]]);
    }
  },
  skirt(ctx, side) {
    rib(ctx, [[-0.5, 0.99], [0.5, 0.99]], 0.11, 'rgba(0,0,0,.08)');
    if (side === 'front') {
      const wrap = curve([0.42, 0.94], [0.2, 0.2], [-0.32, -0.38]);
      stroke(ctx, wrap, 0.05, 'rgba(0,0,0,.08)');
      seam(ctx, wrap, 'rgba(0,0,0,.35)');
      stitch(ctx, curve([0.38, 0.92], [0.16, 0.2], [-0.36, -0.36]));
    }
    stitch(ctx, [[-0.78, -0.34], [0.78, -0.34]]);
  },
};

// Printable area for uploaded artwork, in garment units: a 3:4 box (e.g. a 3000 x 4000 px
// transparent PNG) centred on the chest (front) or upper back. The image is fitted inside
// and anchored to the top, so a small chest logo sits high and a full graphic fills the box.
export const ART_BOX = {
  front: { x: 0, y: -0.02, w: 1.0, h: 1.333 },
  back: { x: 0, y: -0.05, w: 1.0, h: 1.333 },
};
function artwork(ctx, side, img, type) {
  const box = ART_BOX[side];
  const scale = type === 'oversized' ? 1 : 0.82;
  const bw = box.w * scale * S, bh = box.h * scale * S;
  const k = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  const px = (side === 'back' ? 1024 : 0) + (box.x - TEX_BOX.x0) * S;
  const top = (TEX_BOX.y0 + TEX_BOX.size - box.y) * S - bh / 2;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.96; // a touch of fabric showing through, like a real print
  ctx.drawImage(img, px - w / 2, top, w, h);
  ctx.restore();
}

export function paintTexture(type, color, product = {}, art = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const ink = color.ink || inkFor(color.hex);
  const poly = silhouette(type);
  // uploaded artwork replaces the built-in text print on that side
  const print = { ...(product.print || {}) };
  if (art.front) Object.assign(print, { front: [], frontStyle: null });
  if (art.back) Object.assign(print, { back: [], sub: null });
  const prod = { ...product, print };
  for (const side of ['front', 'back']) {
    space(ctx, side);
    ctx.save();
    path(ctx, poly);
    ctx.clip();
    PAINT[type]?.(ctx, side, color, ink, prod);
    if (art[side]) artwork(ctx, side, art[side], type);
    ctx.restore();
  }
  return canvas;
}

// Flat silhouette used when WebGL is unavailable.
export function silhouetteSVG(type, hex, label = '') {
  const pts = silhouette(type).map(([x, y]) => `${(x * 100).toFixed(1)},${(-y * 100).toFixed(1)}`).join(' ');
  return `<svg viewBox="-125 -145 250 290" role="img" aria-label="${label}"><polygon points="${pts}" fill="${hex}" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/></svg>`;
}
