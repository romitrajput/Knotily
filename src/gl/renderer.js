// Small WebGL1 renderer for garment models: fabric shading with wrapped
// diffuse, cotton sheen, soft key/fill/rim lights and a printed texture atlas.
import { perspective, multiply, translation, rotationY, rotationX, rotationZ } from './math.js';

const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv; attribute float aD;
uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel; uniform mat4 uPart;
uniform float uFoldOn; uniform float uFlat;
// Up to five folds, applied in order. For each: progress 0..1, hinge line,
// axis (0 = vertical line on x, 1 = horizontal line on y), side that moves (-1/+1),
// hinge depth, and direction (-1 = folds behind, like retail folding; +1 = over the front).
uniform float uFP[5]; uniform float uFL[5]; uniform float uFA[5]; uniform float uFS[5]; uniform float uFZ[5]; uniform float uFD[5];
varying vec3 vN; varying vec2 vUv; varying float vD; varying vec3 vPosV;
void main(){
  vec3 P = aPos; vec3 N = aNor;
  if (uFoldOn > 0.5) {
    P.z *= mix(1.0, 0.09, uFlat);
    for (int i = 0; i < 5; i++) {
      float prog = uFP[i];
      if (prog <= 0.0) continue;
      float side = uFS[i]; float dir = uFD[i];
      bool onY = uFA[i] > 0.5;
      float d = (onY ? P.y : P.x) - uFL[i];
      float k = smoothstep(0.0, 0.07, side * d); // short bend band instead of a hard crease
      if (k <= 0.0) continue;
      float a = 3.14159265 * prog * k;
      float c = cos(a), s = sin(a);
      float zz = P.z - uFZ[i];
      float d2 = d * c - dir * side * zz * s;
      float z2 = dir * side * d * s + zz * c;
      float nd = onY ? N.y : N.x;
      float nd2 = nd * c - dir * side * N.z * s;
      float nz2 = dir * side * nd * s + N.z * c;
      if (onY) { P.y = d2 + uFL[i]; N.y = nd2; } else { P.x = d2 + uFL[i]; N.x = nd2; }
      P.z = z2 + uFZ[i]; N.z = nz2;
    }
  }
  vec4 wp = uModel * uPart * vec4(P, 1.0);
  vec4 vp = uView * wp;
  vPosV = vp.xyz;
  vN = mat3(uView) * mat3(uModel) * mat3(uPart) * N;
  vUv = aUv; vD = aD;
  gl_Position = uProj * vp;
}`;

const FS = `
precision highp float;
varying vec3 vN; varying vec2 vUv; varying float vD; varying vec3 vPosV;
uniform vec3 uColor; uniform sampler2D uTex; uniform float uUseTex; uniform float uCut;
uniform float uSheen; uniform float uSpec; uniform float uShine; uniform float uWeave; uniform float uRim; uniform vec3 uRimColor;
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
void main(){
  if (uCut > 0.5 && vD < 0.0) discard;
  vec3 base = lin(uColor);
  if (uUseTex > 0.5) { vec4 t = texture2D(uTex, vUv); base = mix(base, lin(t.rgb), t.a); }
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(-vPosV);
  vec3 L1 = normalize(vec3(-0.55, 0.75, 0.75));
  vec3 L2 = normalize(vec3(0.8, 0.15, 0.45));
  vec3 L3 = normalize(vec3(0.0, 0.3, -1.0));
  float k1 = max((dot(N, L1) + 0.4) / 1.4, 0.0);
  float k2 = max((dot(N, L2) + 0.3) / 1.3, 0.0);
  float k3 = pow(max(dot(N, L3), 0.0), 2.0);
  float ndv = max(dot(N, V), 0.0);
  float sheen = pow(1.0 - ndv, 3.0) * uSheen;
  vec3 H = normalize(L1 + V);
  float spec = pow(max(dot(N, H), 0.0), uShine) * uSpec;
  vec3 col = base * (0.2 + 0.78 * k1 + 0.22 * k2) + vec3(0.06) * k3;
  col += sheen * mix(vec3(0.55), base + 0.25, 0.5);
  col += spec;
  col += pow(1.0 - ndv, 2.6) * uRimColor * uRim;
  float weave = sin(vUv.x * 3400.0) * sin(vUv.y * 6800.0);
  col *= 1.0 + weave * uWeave;
  if (uCut > 0.5) col *= mix(0.72, 1.0, smoothstep(0.0, 0.1, vD));
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const FRAME = { centerY: 0.05, halfHeight: 1.48, fov: (28 * Math.PI) / 180 };

export function createRenderer(canvas, { preserve = false } = {}) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: preserve });
  if (!gl) throw new Error('WebGL unavailable');

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const A = ['aPos', 'aNor', 'aUv', 'aD'].reduce((o, n) => ((o[n] = gl.getAttribLocation(prog, n)), o), {});
  const U = ['uProj', 'uView', 'uModel', 'uPart', 'uFoldOn', 'uFlat', 'uFP', 'uFL', 'uFA', 'uFS', 'uFZ', 'uFD', 'uColor', 'uTex', 'uUseTex', 'uCut', 'uSheen', 'uSpec', 'uShine', 'uWeave', 'uRim', 'uRimColor'].reduce(
    (o, n) => ((o[n] = gl.getUniformLocation(prog, n)), o),
    {}
  );
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);

  const owned = { buffers: [], textures: [] };

  function upload(mesh) {
    const buf = (data, target = gl.ARRAY_BUFFER) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      owned.buffers.push(b);
      return b;
    };
    return {
      pos: buf(mesh.pos), nor: buf(mesh.nor), uv: buf(mesh.uv), d: buf(mesh.dist),
      idx: buf(mesh.idx, gl.ELEMENT_ARRAY_BUFFER), count: mesh.idx.length,
    };
  }

  function texture(canvas2d) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    owned.textures.push(t);
    return t;
  }

  function size(w, h, dpr = 1) {
    const W = Math.max(1, Math.round(w * dpr)), Hh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== Hh) {
      canvas.width = W;
      canvas.height = Hh;
    }
    gl.viewport(0, 0, W, Hh);
  }

  // parts: [{ gpu, color:'#hex', tex?, cut, sheen, spec, shine, weave }]
  const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  function draw(parts, { rotY = 0, rotX = 0, sway = 0, frame = FRAME, fold = null } = {}) {
    const aspect = canvas.width / canvas.height;
    const half = Math.max(frame.halfHeight, (frame.halfWidth || 0) / aspect);
    const dist = half / Math.tan(FRAME.fov / 2);
    gl.uniformMatrix4fv(U.uProj, false, perspective(FRAME.fov, aspect, 0.1, 50));
    gl.uniformMatrix4fv(U.uView, false, translation(0, -frame.centerY, -dist));
    // pivot around the hook so the garment swings like it really hangs
    const pivot = 1.37;
    const model = multiply(
      translation(0, pivot, 0),
      multiply(rotationZ(sway), multiply(rotationX(rotX), multiply(rotationY(rotY), translation(0, -pivot, 0))))
    );
    gl.uniformMatrix4fv(U.uModel, false, model);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (fold) {
      // fold = { flat, folds: [{ p, line, axis: 'x'|'y', side, piv, dir }] }
      const F = (key, map) => {
        const a = new Float32Array(5);
        fold.folds.forEach((f, i) => (a[i] = map(f)));
        return a;
      };
      gl.uniform1f(U.uFlat, fold.flat);
      gl.uniform1fv(U.uFP, F('p', (f) => f.p));
      gl.uniform1fv(U.uFL, F('l', (f) => f.line));
      gl.uniform1fv(U.uFA, F('a', (f) => (f.axis === 'y' ? 1 : 0)));
      gl.uniform1fv(U.uFS, F('s', (f) => f.side));
      gl.uniform1fv(U.uFZ, F('z', (f) => f.piv));
      gl.uniform1fv(U.uFD, F('d', (f) => f.dir ?? -1));
    }
    for (const p of parts) {
      const g = p.gpu;
      const bind = (b, loc, n) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
      };
      bind(g.pos, A.aPos, 3);
      bind(g.nor, A.aNor, 3);
      bind(g.uv, A.aUv, 2);
      bind(g.d, A.aD, 1);
      gl.uniform3fv(U.uColor, hexToRgb(p.color));
      gl.uniformMatrix4fv(U.uPart, false, p.model || IDENT);
      gl.uniform1f(U.uFoldOn, fold && p.role === 'garment' ? 1 : 0);
      gl.uniform1f(U.uUseTex, p.tex ? 1 : 0);
      if (p.tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, p.tex);
        gl.uniform1i(U.uTex, 0);
      }
      gl.uniform1f(U.uCut, p.cut ? 1 : 0);
      gl.uniform1f(U.uSheen, p.sheen ?? 0.35);
      gl.uniform1f(U.uSpec, p.spec ?? 0.02);
      gl.uniform1f(U.uShine, p.shine ?? 18);
      gl.uniform1f(U.uWeave, p.weave ?? 0.035);
      gl.uniform1f(U.uRim, p.rim ?? 0);
      gl.uniform3fv(U.uRimColor, hexToRgb(p.rimColor || '#FF8A4C'));
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  function dispose() {
    owned.buffers.forEach((b) => gl.deleteBuffer(b));
    owned.textures.forEach((t) => gl.deleteTexture(t));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  return { gl, canvas, upload, texture, size, draw, dispose };
}
