/**
 * Strings and ribbons: jute / hemp twine, baker's twine, cotton string,
 * twisted wire ties, satin and grosgrain ribbon. A cord is a set of polylines
 * in a card's local px; the shader finds the nearest segment, builds a
 * cross-section (round ply-twisted cord or flat ribbon), shades it with the
 * desk light and casts a short shadow. Segments carry a layer flag so one
 * cord can pass *through* a tag: the strands lying on the paper render in
 * front of the sheet, the parts tucked under it render behind.
 *
 * Reference: real tags are tied with a lark's head (cow hitch): from the front
 * you see two parallel strands running from the hole over the top edge, the
 * bight crosses the back of the hole, and the doubled tails continue beyond
 * the edge. Twine shows diagonal ply ridges and stray fibres and frays at the
 * ends; satin catches bright sheen bands; ribbon ends are cut on a slant or V.
 */
import { parseColor } from '../index';
import type { Rng } from './rng';
import type { Sprite } from './props';

export type CordKind = 'jute' | 'hemp' | 'baker' | 'cotton' | 'satin' | 'grosgrain' | 'wire';
const KIND_ID: Record<CordKind, number> = { jute: 0, hemp: 1, baker: 2, cotton: 3, satin: 4, grosgrain: 5, wire: 6 };

type P3 = [number, number, number];
export interface Polyline {
  pts: P3[];
  /** Per point: true if that point lies under the sheet. */
  under: boolean[];
  /** Free ends fray (twine) or get a cut (ribbon). */
  freeStart: boolean;
  freeEnd: boolean;
}
export interface CordSpec {
  kind: CordKind;
  width: number;
  colors: [string, string];
  lines: Polyline[];
  /** Knots: x, y, radius (lying on top). */
  knots: [number, number, number][];
  seed: number;
}

const MAXP = 96;

const FS = /* glsl */ `#version 300 es
precision highp float;
#define MAXP ${MAXP}
uniform vec4 uP[MAXP];   // x, y, z, layer (1 on top, 2 under); negative = first point of a polyline
uniform vec4 uA[MAXP];   // arc length at point, polyline length, free-end bits, polyline index
uniform int uN;
uniform int uPart;       // 1 front, 2 back
uniform vec3 uKnots[4];
uniform int uKnotN;
uniform vec2 uOrigin;
uniform float uScale;
uniform vec3 uLight;
uniform int uKind;
uniform vec3 uC1, uC2;
uniform float uW;
uniform float uSeed;
out vec4 outColor;

const int JUTE = 0, HEMP = 1, BAKER = 2, COTTON = 3, SATIN = 4, GROS = 5, WIRE = 6;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 17.3) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

bool ribbon() { return uKind == SATIN || uKind == GROS; }
float plies() { return uKind == BAKER ? 2.0 : (uKind == COTTON ? 4.0 : (uKind == WIRE ? 1.0 : 3.0)); }
float pitch() { return uW * (uKind == COTTON ? 1.2 : (uKind == BAKER ? 2.4 : 1.9)); }

// height of the cord surface above its centre-line height, in local (t along, s across in -1..1)
float surf(float t, float s) {
  float r = uW * 0.5;
  float a = max(1.0 - s * s, 0.0);
  if (ribbon()) {
    // flat band: nearly no camber, crisp edges; grosgrain has fine ribs across its width
    float h = r * 0.04 * a;
    if (uKind == GROS) h += 0.16 * sin(t * 6.2831 / 1.1);
    return h;
  }
  float h = r * sqrt(a);
  if (uKind != WIRE) {
    float n = plies();
    float g = fract((t / pitch() + s * 0.45) * n);
    float groove = 1.0 - smoothstep(0.0, 0.28, g) * smoothstep(1.0, 0.72, g);
    h -= groove * r * (uKind == COTTON ? 0.18 : 0.38) * sqrt(a);
  }
  return h;
}

struct Hit { float h; float d; float t; float s; float z; float len; float ends; vec2 tan; float side; float knot; };

Hit nearest(vec2 p, int part) {
  Hit best = Hit(-1e9, 1e9, 0.0, 0.0, 0.0, 1.0, 0.0, vec2(1.0, 0.0), 1.0, 0.0);
  float r = uW * 0.5;
  float bestD = 1e9;
  for (int i = 1; i < MAXP; i++) {
    if (i >= uN) break;
    vec4 b = uP[i];
    if (b.w < 0.0) continue;
    vec4 a = uP[i - 1];
    if (part != 0 && int(abs(a.w) + 0.5) != part) continue;
    vec2 ab = b.xy - a.xy;
    float L = length(ab);
    if (L < 1e-4) continue;
    vec2 td = ab / L;
    float u = clamp(dot(p - a.xy, td), 0.0, L);
    vec2 dv = p - (a.xy + td * u);
    float d = length(dv);
    if (d > r + 3.0) continue;
    float side = (td.x * dv.y - td.y * dv.x) >= 0.0 ? 1.0 : -1.0;
    float z = mix(a.z, b.z, u / L);
    float t = uA[i - 1].x + u;
    float s = side * d / r;
    float h = d < r ? z + surf(t, s) : -1e6 + z - d;
    if (h > best.h || (best.h < -1e5 && d < bestD)) {
      best = Hit(h, d, t, s, z, uA[i - 1].y, uA[i - 1].z, td, side, 0.0);
      bestD = d;
    }
  }
  for (int k = 0; k < 4; k++) {
    if (k >= uKnotN || part == 2) break;
    vec3 kn = uKnots[k];
    vec2 dv = p - kn.xy;
    float d = length(dv);
    if (d < kn.z) {
      float h = 0.4 + kn.z * 0.75 * sqrt(1.0 - (d / kn.z) * (d / kn.z));
      if (h > best.h) best = Hit(h, d, atan(dv.y, dv.x) * kn.z * 1.3, d / kn.z, 0.4, 1e3, 0.0, normalize(vec2(-dv.y, dv.x) + 1e-5), 1.0, 1.0);
    }
  }
  return best;
}

vec2 local(vec2 px) { return (px - uOrigin) / uScale; }

void main() {
  vec2 p = local(gl_FragCoord.xy);
  Hit o = nearest(p, uPart);
  float r = uW * 0.5;
  vec3 L = normalize(uLight);
  vec2 ld = normalize(L.xy);
  float tanE = L.z / max(length(L.xy), 1e-3);

  float alpha = 0.0;
  vec3 col = vec3(0.0);
  bool fuzzy = uKind == JUTE || uKind == HEMP || uKind == BAKER;
  if (o.d < r + 3.0) {
    alpha = clamp((r - o.d) * uScale + 0.5, 0.0, 1.0);
    // free ends: twine frays (plies part), ribbon gets a V / slanted cut
    float fromStart = o.t, fromEnd = o.len - o.t;
    bool startFree = mod(o.ends, 2.0) >= 1.0, endFree = o.ends >= 2.0;
    float endDist = min(startFree ? fromStart : 1e3, endFree ? fromEnd : 1e3);
    if (o.knot < 0.5) {
      if (ribbon()) {
        float notch = r * 1.6;
        if (endDist < notch * (1.0 - abs(o.s)) + (o.s * 0.5 + 0.5) * r * 0.25) alpha = 0.0;
      } else if (endDist < uW * 2.2 && uKind != WIRE) {
        float g = fract((o.t / pitch() + o.s * 0.45) * plies());
        float gap = smoothstep(uW * 2.2, 0.0, endDist);
        alpha *= smoothstep(0.0, 0.25 * gap + 0.01, g) * smoothstep(1.0, 1.0 - 0.25 * gap - 0.01, g);
      } else if (endDist < 0.6) alpha = 0.0;
    }
    // stray fibres around twine
    if (fuzzy && o.d >= r - 0.3) {
      float k = o.d - r;
      float hair = smoothstep(0.62, 0.8, vnoise(vec2(o.t * 0.45, k * 0.9 + o.side * 11.0)) * (1.0 - k / 3.0));
      alpha = max(alpha, hair * 0.75);
    }
    if (alpha > 0.0) {
      // normal from the local surface: across (s) and along (t)
      float e = 0.08;
      float hs = (surf(o.t, clamp(o.s + e, -1.0, 1.0)) - surf(o.t, clamp(o.s - e, -1.0, 1.0))) / (2.0 * e * r);
      float ht = (surf(o.t + 0.2, o.s) - surf(o.t - 0.2, o.s)) / 0.4;
      vec2 perp = vec2(-o.tan.y, o.tan.x);
      vec2 grad = perp * hs + o.tan * ht;
      if (o.knot > 0.5) {
        // knots are little domes
        float q = min(o.s, 0.98);
        grad = vec2(o.tan.y, -o.tan.x) * (-0.75 * q / sqrt(1.0 - q * q)) + o.tan * ht;
      }
      if (uKind == SATIN) grad += o.tan * (0.35 * sin(o.t / 17.0 + uSeed) + 0.18 * sin(o.t / 6.3 + uSeed * 2.0));
      if (uKind == GROS) grad += o.tan * 0.15 * sin(o.t / 21.0 + uSeed);
      vec3 n = normalize(vec3(-grad, 1.0));
      vec3 V = vec3(0.0, 0.0, 1.0);
      vec3 H = normalize(L + V);
      float dif = max(dot(n, L), 0.0);
      float nh = max(dot(n, H), 0.0);

      vec3 base = uC1;
      float n2 = plies();
      float ply = mod(floor((o.t / pitch() + o.s * 0.45) * n2), n2);
      if (uKind == BAKER) base = ply < 0.5 ? uC1 : uC2;
      else if (uKind == JUTE || uKind == HEMP) base *= 0.9 + 0.08 * ply + 0.2 * (vnoise(vec2(o.t * 0.9, o.s * 3.0 + ply * 5.0)) - 0.5);
      else if (uKind == COTTON) base *= 0.96 + 0.06 * vnoise(vec2(o.t * 1.4, o.s * 4.0));
      if (ribbon()) base *= 1.0 - 0.07 * smoothstep(0.86, 1.0, abs(o.s));
      if (uKind == GROS) base *= 0.92 + 0.08 * sin(o.t * 6.2831 / 1.1);
      if (o.d >= r) base = mix(base, vec3(1.0), 0.15);

      if (uKind == WIRE) {
        vec3 rf = reflect(-V, n);
        float env = 0.35 + 0.35 * rf.z + 0.7 * max(dot(normalize(rf.xy + 1e-5), ld), 0.0) * length(rf.xy);
        col = base * env + vec3(1.0) * pow(nh, 80.0) * 1.2;
      } else if (uKind == SATIN) {
        col = base * (0.38 + 0.62 * dif) + mix(base, vec3(1.0), 0.55) * pow(nh, 26.0) * 0.85 + base * 0.12 * pow(1.0 - n.z, 0.5);
      } else {
        float spec = uKind == GROS ? 0.08 : 0.05;
        col = base * (0.36 + 0.74 * dif) + vec3(1.0) * pow(nh, 18.0) * spec;
      }
    }
  }

  // short cast shadow: the cord's footprint shifted away from the light by its height
  float shadow = 0.0;
  if (alpha < 1.0) {
    float hgt = (ribbon() ? 0.6 : r * 1.6) + 0.3;
    Hit s = nearest(p + ld * hgt / tanE, uPart);
    float reach = s.knot > 0.5 ? uW * 1.2 : r;
    shadow = smoothstep(reach + 1.2, reach - 0.6, s.d) * 0.34;
  }
  float outA = alpha + shadow * (1.0 - alpha);
  outColor = vec4(outA > 0.0 ? clamp(col, 0.0, 1.0) * alpha / outA : vec3(0.0), outA);
}
`;

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export function createCordRenderer() {
let gl: WebGL2RenderingContext | null = null;
let prog: WebGLProgram;
const loc = new Map<string, WebGLUniformLocation | null>();
const u = (n: string) => {
  if (!loc.has(n)) loc.set(n, gl!.getUniformLocation(prog, n));
  return loc.get(n)!;
};

function init() {
  const canvas = new OffscreenCanvas(1, 1);
  const g = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
  if (!g) throw new Error('WebGL2 not available');
  gl = g;
  const sh = (type: number, src: string) => {
    const s = g.createShader(type)!;
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? 'cord shader error');
    return s;
  };
  prog = g.createProgram()!;
  g.attachShader(prog, sh(g.VERTEX_SHADER, VS));
  g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS));
  g.bindAttribLocation(prog, 0, 'aPos');
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog) ?? 'cord link error');
  g.bindVertexArray(g.createVertexArray());
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
}

/** Render the part of a cord that lies on top of the sheet ('front') or under it ('back'). */
function renderCord(spec: CordSpec, part: 'front' | 'back', dpr: number, azimuth: number, elevation: number): Sprite | null {
  if (!gl) init();
  const g = gl!;
  const P = new Float32Array(MAXP * 4);
  const A = new Float32Array(MAXP * 4);
  let n = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  spec.lines.forEach((line, li) => {
    let arc = 0;
    const start = n;
    line.pts.forEach((pt, i) => {
      if (n >= MAXP) return;
      if (i > 0) arc += Math.hypot(pt[0] - line.pts[i - 1][0], pt[1] - line.pts[i - 1][1]);
      const layer = line.under[i] ? 2 : 1;
      P.set([pt[0], pt[1], pt[2], i === 0 ? -layer : layer], n * 4);
      A.set([arc, 0, (line.freeStart ? 1 : 0) + (line.freeEnd ? 2 : 0), li], n * 4);
      if (i < line.pts.length - 1 && (layer === 2) === (part === 'back')) {
        any = true;
        for (const q of [pt, line.pts[i + 1]]) {
          minX = Math.min(minX, q[0]);
          maxX = Math.max(maxX, q[0]);
          minY = Math.min(minY, q[1]);
          maxY = Math.max(maxY, q[1]);
        }
      }
      n++;
    });
    for (let k = start; k < n; k++) A[k * 4 + 1] = arc;
  });
  if (part === 'front')
    for (const [x, y, r] of spec.knots) {
      any = true;
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    }
  if (!any) return null;
  const pad = spec.width + 8;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const w = Math.ceil(maxX - minX), h = Math.ceil(maxY - minY);
  const W = Math.ceil(w * dpr), H = Math.ceil(h * dpr);
  (g.canvas as OffscreenCanvas).width = W;
  (g.canvas as OffscreenCanvas).height = H;
  g.viewport(0, 0, W, H);
  g.useProgram(prog);
  g.uniform4fv(u('uP'), P);
  g.uniform4fv(u('uA'), A);
  g.uniform1i(u('uN'), n);
  g.uniform1i(u('uPart'), part === 'front' ? 1 : 2);
  const K = new Float32Array(12);
  spec.knots.slice(0, 4).forEach((k, i) => K.set(k, i * 3));
  g.uniform3fv(u('uKnots'), K);
  g.uniform1i(u('uKnotN'), Math.min(4, spec.knots.length));
  g.uniform2f(u('uOrigin'), -minX * dpr, -minY * dpr);
  g.uniform1f(u('uScale'), dpr);
  const el = (elevation * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
  g.uniform3f(u('uLight'), Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
  g.uniform1i(u('uKind'), KIND_ID[spec.kind]);
  const c1 = parseColor(spec.colors[0]), c2 = parseColor(spec.colors[1]);
  g.uniform3f(u('uC1'), c1[0], c1[1], c1[2]);
  g.uniform3f(u('uC2'), c2[0], c2[1], c2[2]);
  g.uniform1f(u('uW'), spec.width);
  g.uniform1f(u('uSeed'), spec.seed % 97);
  g.drawArrays(g.TRIANGLES, 0, 3);
  const px = new Uint8ClampedArray(W * H * 4);
  g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  return { canvas, w, h, ox: -minX, oy: -minY };
}


return { renderCord, dispose() { gl?.getExtension('WEBGL_lose_context')?.loseContext(); gl = null; loc.clear(); } };
}
let shared: ReturnType<typeof createCordRenderer> | undefined;
export const renderCord: ReturnType<typeof createCordRenderer>['renderCord'] = (...args) => (shared ??= createCordRenderer()).renderCord(...args);
// ---------------------------------------------------------------- geometry

/** A relaxed path lying on the desk: random-walk curvature, smoothed, sampled every `step` px. */
function lazyPath(rng: Rng, x: number, y: number, angle: number, length: number, step = 5, wiggle = 0.06): [number, number][] {
  const pts: [number, number][] = [[x, y]];
  let a = angle, k = rng.range(-wiggle, wiggle);
  for (let s = step; s <= length; s += step) {
    k = k * 0.85 + rng.range(-wiggle, wiggle) * 0.6;
    a += k * step * 0.25;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
  }
  return pts;
}

/** Offset a centre-line sideways (twisting doubled strands around each other). */
function offsetPath(path: [number, number][], off: (i: number, t: number) => [number, number]): P3[] {
  let t = 0;
  return path.map((p, i) => {
    if (i > 0) t += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]);
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const [o, z] = off(i, t);
    return [p[0] - (dy / L) * o, p[1] + (dx / L) * o, z];
  });
}

export const CORD_STYLES: { kind: CordKind; colors: [string, string]; width: number; weight: number; label: string }[] = [
  { kind: 'jute', colors: ['#b79a6c', '#b79a6c'], width: 2.6, weight: 3, label: 'jute twine' },
  { kind: 'hemp', colors: ['#cdb98f', '#cdb98f'], width: 2.0, weight: 2, label: 'hemp twine' },
  { kind: 'baker', colors: ['#c8323a', '#f3efe7'], width: 1.8, weight: 2, label: "baker's twine" },
  { kind: 'baker', colors: ['#2f7a4a', '#f3efe7'], width: 1.8, weight: 0.7, label: "baker's twine" },
  { kind: 'baker', colors: ['#1f1e24', '#f3efe7'], width: 1.8, weight: 0.7, label: "baker's twine" },
  { kind: 'cotton', colors: ['#efebe1', '#efebe1'], width: 1.7, weight: 1.2, label: 'cotton string' },
  { kind: 'wire', colors: ['#c9ccd0', '#c9ccd0'], width: 0.9, weight: 0.8, label: 'wire tie' },
  { kind: 'satin', colors: ['#b8233a', '#b8233a'], width: 6, weight: 1, label: 'satin ribbon' },
  { kind: 'satin', colors: ['#20385f', '#20385f'], width: 6, weight: 0.6, label: 'satin ribbon' },
  { kind: 'grosgrain', colors: ['#3f5e45', '#3f5e45'], width: 7, weight: 0.7, label: 'grosgrain ribbon' },
  { kind: 'grosgrain', colors: ['#e6dccb', '#e6dccb'], width: 7, weight: 0.6, label: 'grosgrain ribbon' },
];

/**
 * A cord tied through a tag's hole at (cx, cy), radius hr, tag top edge at y = 0.
 * Twine and wire: lark's head (two strands over the edge, bight behind the hole,
 * doubled tails). Ribbon: threaded once, knotted just past the edge, two V-cut tails.
 */
export function tagCord(rng: Rng, cx: number, cy: number, hr: number, tagW: number): { spec: CordSpec; label: string } {
  const style = rng.weighted(CORD_STYLES, (s) => s.weight);
  const w = style.width;
  const lines: Polyline[] = [];
  const knots: [number, number, number][] = [];
  const onTag = (x: number, y: number) => y > 0 && x > 0 && x < tagW;
  const isRibbon = style.kind === 'satin' || style.kind === 'grosgrain';
  // which way the tails fall
  const out = -Math.PI / 2 + rng.range(-0.9, 0.9);

  if (!isRibbon) {
    // the two strands of a lark's head lie side by side, just touching
    const gap = w * 1.08;
    // the two strands of the hitch, from inside the hole over the top edge
    for (const sx of [-1, 1]) {
      const x0 = cx + sx * gap * 0.5;
      const pts: P3[] = [
        [x0 + sx * 0.3, cy + hr * 0.15, -0.4],
        [x0, cy - hr * 0.6, 0.1],
        [x0, cy - hr - 2, 0.3],
        [x0 + sx * 0.2, (cy - hr) * 0.45, 0.35],
        [x0 + sx * 0.3, 0.8, 0.45],
        [x0 + sx * 0.3, -1.5, 0.1],
      ];
      lines.push({ pts, under: pts.map(() => false), freeStart: false, freeEnd: false });
    }
    // the bight crossing the back of the hole (seen through it)
    const bight: P3[] = [
      [cx - hr * 1.7, cy - hr * 0.2, 0],
      [cx - hr * 0.6, cy + hr * 0.5, 0],
      [cx + hr * 0.6, cy + hr * 0.5, 0],
      [cx + hr * 1.7, cy - hr * 0.2, 0],
    ];
    lines.push({ pts: bight, under: bight.map(() => true), freeStart: false, freeEnd: false });
    // doubled tails: start under the tag's top edge, twist around each other, part near the end
    const len = rng.range(70, 150);
    const path = lazyPath(rng, cx, 6, out, len);
    const twist = rng.range(16, 26) * (style.kind === 'wire' ? 0.35 : 1);
    const ph = rng.range(0, Math.PI * 2);
    const part = rng.range(0.55, 0.85) * len;
    for (const sx of [-1, 1]) {
      const strand = offsetPath(path, (_i, t) => {
        const spread = t > part ? (t - part) * (0.18 + rng.range(0, 0.02)) * sx : 0;
        const tw = Math.cos(ph + (t / twist) * Math.PI);
        return [gap * 0.5 * sx * tw + spread, 0.15 + 0.35 * w * sx * Math.sin(ph + (t / twist) * Math.PI)];
      });
      const cut = Math.floor(strand.length * rng.range(0.82, 1));
      const s = strand.slice(0, Math.max(3, cut));
      let left = false;
      const under = s.map(([x, y]) => {
        if (!onTag(x, y)) left = true;
        return !left && onTag(x, y);
      });
      lines.push({ pts: s, under, freeStart: false, freeEnd: true });
    }
  } else {
    // ribbon: one flat strip through the hole and over the edge, knotted past the edge
    const leg: P3[] = [
      [cx, cy + hr * 0.1, -0.3],
      [cx, cy - hr - 1, 0.1],
      [cx + rng.range(-1, 1), 2, 0.25],
      [cx, -w * 0.9, 0.3],
    ];
    lines.push({ pts: leg, under: leg.map(() => false), freeStart: false, freeEnd: false });
    const bight: P3[] = [
      [cx, cy - hr * 0.3, 0],
      [cx, cy + hr * 2.4, 0],
    ];
    lines.push({ pts: bight, under: [true, true], freeStart: false, freeEnd: false });
    const kx = cx, ky = -w * 1.05;
    knots.push([kx, ky, w * 0.85]);
    for (const sx of [-1, 1]) {
      const a = out + sx * rng.range(0.35, 0.7);
      const pts = lazyPath(rng, kx + Math.cos(a) * w * 0.6, ky + Math.sin(a) * w * 0.6, a, rng.range(45, 85), 5, 0.035).map(([x, y]) => [x, y, 0.2] as P3);
      lines.push({ pts, under: pts.map(() => false), freeStart: false, freeEnd: true });
    }
  }
  return { spec: { kind: style.kind, width: w, colors: style.colors, lines, knots, seed: rng.int(1, 9999) }, label: style.label };
}
