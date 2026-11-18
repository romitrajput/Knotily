// Procedural garment geometry.
//  - buildGarment(): turns a 2D silhouette into a closed, inflated 3D shell
//    (front + back height fields that meet at the outline), with hanging folds.
//  - buildTubes(): drawcords, laces, straps and hangers as swept tubes.
// Texture space: a 2.8 x 2.8 box (x -1.4..1.4, y -1.5..1.3). Front in the
// left half of the atlas, back (mirrored) in the right half.

export const TEX_BOX = { x0: -1.4, y0: -1.5, size: 2.8 };

// ---------- polygon helpers ----------
export function mirrorHalf(half) {
  const left = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return [...half, ...left];
}

export function chaikin(poly, iterations = 2) {
  let p = poly;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

function signedDistance(poly, x, y) {
  let inside = false;
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1)));
    const ex = xi + t * dx - x, ey = yi + t * dy - y;
    const d = ex * ex + ey * ey;
    if (d < min) min = d;
  }
  const d = Math.sqrt(min);
  return inside ? d : -d;
}

const smooth = (t) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

// ---------- the garment shell ----------
export function buildGarment(poly, { depth = 0.12, radius = 0.24, back = 0.85, folds = 1, res = 118 } = {}) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of poly) {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  }
  const pad = 0.04;
  minx -= pad; maxx += pad; miny -= pad; maxy += pad;
  const nx = res;
  const ny = Math.max(8, Math.round((res * (maxy - miny)) / (maxx - minx)));
  const dx = (maxx - minx) / (nx - 1);
  const dy = (maxy - miny) / (ny - 1);
  const N = nx * ny;
  const D = new Float32Array(N);
  const H = new Float32Array(N);

  for (let j = 0; j < ny; j++) {
    const y = miny + j * dy;
    // hanging fabric: folds deepen towards the hem
    const hang = 0.3 + 0.7 * smooth((1.05 - y) / 2.3);
    for (let i = 0; i < nx; i++) {
      const x = minx + i * dx;
      const k = j * nx + i;
      const d = signedDistance(poly, x, y);
      D[k] = d;
      if (d <= 0) continue;
      const t = Math.min(d / radius, 1);
      const profile = depth * Math.sqrt(1 - (1 - t) * (1 - t));
      const fold =
        folds *
        hang *
        smooth(d / (radius * 1.2)) *
        (0.02 * Math.sin(x * 9.5 + Math.sin(y * 2.1) * 1.8) + 0.01 * Math.sin(x * 21 + y * 3.1 + 1.3) + 0.006 * Math.sin(x * 4 - y * 7));
      H[k] = profile + fold;
    }
  }

  const ux = (x) => (x - TEX_BOX.x0) / TEX_BOX.size;
  const vy = (y) => (y - TEX_BOX.y0) / TEX_BOX.size;
  const idx = (i, j) => j * nx + i;
  const grad = (A, i, j) => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1);
    const j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1);
    return [(A[idx(i1, j)] - A[idx(i0, j)]) / ((i1 - i0) * dx), (A[idx(i, j1)] - A[idx(i, j0)]) / ((j1 - j0) * dy)];
  };

  const pos = new Float32Array(N * 2 * 3);
  const nor = new Float32Array(N * 2 * 3);
  const uv = new Float32Array(N * 2 * 2);
  const dist = new Float32Array(N * 2);
  const edge = dx * 0.75;

  for (let side = 0; side < 2; side++) {
    const s = side === 0 ? 1 : -back;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = idx(i, j);
        const v = side * N + k;
        const x = minx + i * dx, y = miny + j * dy;
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = s * H[k];
        let n;
        if (D[k] <= edge) {
          const [gx, gy] = grad(D, i, j);
          n = [-gx, -gy, side === 0 ? 0.22 : -0.22];
        } else {
          const [hx, hy] = grad(H, i, j);
          n = [-s * hx, -s * hy, side === 0 ? 1 : -1];
        }
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        nor[v * 3] = n[0] / l; nor[v * 3 + 1] = n[1] / l; nor[v * 3 + 2] = n[2] / l;
        const u = ux(x);
        uv[v * 2] = side === 0 ? u * 0.5 : 0.5 + (1 - u) * 0.5;
        uv[v * 2 + 1] = vy(y);
        dist[v] = D[k];
      }
  }

  const tris = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
      if (D[a] < 0 && D[b] < 0 && D[c] < 0 && D[d] < 0) continue;
      tris.push(a, b, c, b, d, c); // front, CCW from +z
      tris.push(N + a, N + c, N + b, N + b, N + c, N + d); // back, CCW from -z
    }

  const heightAt = (x, y) => {
    const fi = (x - minx) / dx, fj = (y - miny) / dy;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(fi)));
    const j = Math.max(0, Math.min(ny - 2, Math.floor(fj)));
    const tx = Math.min(1, Math.max(0, fi - i)), ty = Math.min(1, Math.max(0, fj - j));
    const h = (ii, jj) => H[idx(ii, jj)];
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - ty) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * ty;
  };

  return { pos, nor, uv, dist, idx: new Uint16Array(tris), heightAt };
}

// ---------- tubes ----------
function catmull(points, steps = 6) {
  if (points.length < 3) return points;
  const out = [];
  const P = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((c) =>
        0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)
      ));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// paths: [{ points: [[x,y,z]...], radius, smooth=true, taper=false }]
export function buildTubes(paths, seg = 10) {
  const pos = [], nor = [], idx = [];
  for (const path of paths) {
    const pts = path.smooth === false ? path.points : catmull(path.points);
    if (pts.length < 2) continue;
    const base = pos.length / 3;
    let prevN = null;
    for (let i = 0; i < pts.length; i++) {
      const t = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
      let n = prevN ? norm(cross(cross(t, prevN), t)) : norm(cross(t, Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
      prevN = n;
      const b = cross(t, n);
      const r = path.radius * (path.taper ? 1 - 0.55 * (i / (pts.length - 1)) : 1) * (path.flat ? 1 : 1);
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a) * (path.flat ? 0.3 : 1);
        const dir = [n[0] * ca + b[0] * sa, n[1] * ca + b[1] * sa, n[2] * ca + b[2] * sa];
        pos.push(pts[i][0] + dir[0] * r, pts[i][1] + dir[1] * r, pts[i][2] + dir[2] * r);
        const nd = norm(dir);
        nor.push(nd[0], nd[1], nd[2]);
      }
    }
    for (let i = 0; i < pts.length - 1; i++)
      for (let s = 0; s < seg; s++) {
        const a = base + i * (seg + 1) + s;
        const c = a + seg + 1;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
  }
  const n = pos.length / 3;
  return {
    pos: new Float32Array(pos),
    nor: new Float32Array(nor),
    uv: new Float32Array(n * 2),
    dist: new Float32Array(n).fill(1),
    idx: new Uint16Array(idx),
  };
}
