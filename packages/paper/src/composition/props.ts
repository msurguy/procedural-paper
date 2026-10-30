/**
 * Desk props & attachments, rendered as 2.5D height fields in one WebGL2
 * shader: push pins, map pins, thumbtacks, magnets, binder clips, paper clips,
 * staples, pencils, a steel ruler, an eraser, tape rolls, a mug and a craft
 * knife. Every prop is lit by the same light as the paper and casts a
 * ray-marched shadow from its real height, so tall things (mugs, pins) cast
 * long shadows and flat things (staples, tacks) barely any.
 *
 * Objects are rendered already rotated (the light stays fixed) and returned
 * as sprites with straight alpha.
 */
import { parseColor } from '../index';

export type PropKind =
  | 'pushpin'
  | 'mappin'
  | 'thumbtack'
  | 'magnet'
  | 'magnet-neo'
  | 'magnet-bar'
  | 'binder'
  | 'paperclip'
  | 'staple'
  | 'pencil'
  | 'ruler'
  | 'eraser'
  | 'tape-roll'
  | 'mug'
  | 'knife'
  | 'washi-roll'
  | 'eyelet';

const KIND_ID: Record<PropKind, number> = {
  pushpin: 0, mappin: 1, thumbtack: 2, magnet: 3, 'magnet-neo': 4, 'magnet-bar': 5, binder: 6, paperclip: 7, staple: 8,
  pencil: 9, ruler: 10, eraser: 11, 'tape-roll': 12, mug: 13, knife: 14, 'washi-roll': 15, eyelet: 16,
};

/** [footprint radius, max height] in CSS px. */
export const EXTENT: Record<PropKind, [number, number]> = {
  pushpin: [9.5, 15], mappin: [6.5, 20], thumbtack: [8, 2.6], magnet: [14, 8], 'magnet-neo': [6.5, 3.2], 'magnet-bar': [19, 6.5],
  binder: [34, 10], paperclip: [21, 2.4], staple: [8, 1.2], pencil: [92, 9.5], ruler: [158, 1.6], eraser: [27, 10.5],
  'tape-roll': [32, 17], mug: [56, 84], knife: [66, 9.5], 'washi-roll': [25, 15], eyelet: [9.5, 1.4],
};

export interface PropSpec {
  kind: PropKind;
  color?: string;
  color2?: string;
  /** Rotation in degrees (clockwise on screen). */
  angle?: number;
  /** Paper clip: 'front' = the loop on top of the paper, 'back' = the rest. */
  part?: 'all' | 'front' | 'back';
  /** Light direction in the sprite's frame (degrees, same convention as paper `lighting.azimuth`). */
  azimuth?: number;
  elevation?: number;
  seed?: number;
  /** Pencil / ruler / knife length (CSS px). */
  length?: number;
}

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** CSS size of the sprite. */
  w: number;
  h: number;
  /** Where the prop's origin sits inside the sprite (CSS px). */
  ox: number;
  oy: number;
}

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uOrigin;   // object origin in sprite px
uniform float uScale;   // device px per CSS px
uniform float uAngle;
uniform vec3 uLight;
uniform int uKind;
uniform vec3 uColor, uColor2;
uniform float uLength;
uniform int uPart;
uniform float uSeed;
uniform float uMaxH;
out vec4 outColor;

const int PLASTIC = 1, METAL = 2, BRASS = 3, MATTE = 4, WOOD = 5, GRAPHITE = 6, CERAMIC = 7, COFFEE = 8, PAINT = 9, STEEL = 10, CARD = 11;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 13.7) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// signed distances (negative inside)
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// half-circle arc around c from angle a0 to a1 (radians)
float sdArc(vec2 p, vec2 c, float r, float a0, float a1) {
  vec2 d = p - c;
  float a = atan(d.y, d.x);
  float mid = (a0 + a1) * 0.5, half_ = abs(a1 - a0) * 0.5;
  float da = abs(mod(a - mid + 3.14159265, 6.2831853) - 3.14159265);
  if (da <= half_) return abs(length(d) - r);
  vec2 e0 = c + r * vec2(cos(a0), sin(a0)), e1 = c + r * vec2(cos(a1), sin(a1));
  return min(length(p - e0), length(p - e1));
}

struct Hit { float h; float sd; int mat; vec3 col; };

void add(inout Hit o, float sd, float h, int mat, vec3 col) {
  if (sd < 0.0 && h > o.h) { o.h = h; o.mat = mat; o.col = col; }
  o.sd = min(o.sd, sd);
}

// round tube of radius r lying with its top at height top: profile across distance d
float tube(float d, float r, float top) { return top - r + sqrt(max(r * r - d * d, 0.0)); }
float dome(float d, float R) { return sqrt(max(1.0 - (d / R) * (d / R), 0.0)); }

Hit scene(vec2 p) {
  Hit o = Hit(0.0, 1e5, 0, vec3(0.0));
  float d = length(p);
  if (uKind == 0) { // push pin: flared grip, domed cap
    float R = 9.0;
    add(o, sdCircle(p, R), 11.0 + 2.2 * dome(d, R), PLASTIC, uColor);
    if (d < R * 0.55) add(o, sdCircle(p, R * 0.55), 13.5 + 1.4 * dome(d, R * 0.55), PLASTIC, uColor * 1.08);
  } else if (uKind == 1) { // map pin: sphere on a needle
    add(o, sdCircle(p, 0.7), 14.0, METAL, vec3(0.8));
    add(o, sdCircle(p, 5.8), 14.0 + 5.8 * dome(d, 5.8), PLASTIC, uColor);
  } else if (uKind == 2) { // thumbtack
    float R = 7.6;
    float h = 1.1 + 1.2 * (1.0 - (d / R) * (d / R)) - 0.7 * exp(-(d / 1.3) * (d / 1.3));
    add(o, sdCircle(p, R), h, BRASS, uColor);
  } else if (uKind == 3) { // dome magnet
    float R = 13.0;
    add(o, sdCircle(p, R), 3.5 + 4.0 * pow(dome(d, R), 0.7), PLASTIC, uColor);
  } else if (uKind == 4) { // neodymium disc
    float R = 6.0;
    add(o, sdCircle(p, R), 2.2 + 0.8 * smoothstep(R, R - 0.9, d), METAL, vec3(0.86, 0.87, 0.9));
  } else if (uKind == 5) { // bar magnet
    float sd = sdBox(p, vec2(17.0, 8.5), 3.0);
    add(o, sd, 6.0 * smoothstep(0.0, -2.5, sd), PLASTIC, uColor);
  } else if (uKind == 6) { // binder clip: jaw on the paper (+y), hinge past the edge (-y), handles out
    float w = 15.0;
    float sd = sdBox(p - vec2(0.0, -4.0), vec2(w, 10.0), 1.2);
    float t = clamp((p.y + 14.0) / 20.0, 0.0, 1.0);
    float bevel = smoothstep(0.0, -1.2, sd);
    add(o, sd, mix(9.0, 1.8, t) * bevel, PAINT, uColor);
    // folded-out wire handles
    float wr = 1.1;
    for (int s = -1; s <= 1; s += 2) {
      vec2 a = vec2(float(s) * w * 0.72, -13.0), b = vec2(float(s) * w * 0.55, -30.0);
      float dw = sdSeg(p, a, b);
      float tt = clamp((-p.y - 13.0) / 17.0, 0.0, 1.0);
      add(o, dw - wr, tube(dw, wr, mix(9.5, 3.0, tt)), METAL, vec3(0.9));
    }
    float db = sdSeg(p, vec2(-w * 0.55, -30.0), vec2(w * 0.55, -30.0));
    add(o, db - wr, tube(db, wr, 3.0), METAL, vec3(0.9));
  } else if (uKind == 7) { // gem paper clip, 10 x 36, origin at its centre
    vec2 q = p + vec2(5.0, 18.0);
    float r = 0.75;
    float back = min(min(sdSeg(q, vec2(0.0, 8.0), vec2(0.0, 31.0)), sdArc(q, vec2(5.0, 31.0), 5.0, 0.0, 3.14159265)),
                     sdSeg(q, vec2(10.0, 31.0), vec2(10.0, 5.0)));
    float front = min(min(sdArc(q, vec2(6.5, 5.0), 3.5, -3.14159265, 0.0), sdSeg(q, vec2(3.0, 5.0), vec2(3.0, 27.0))),
                      min(sdArc(q, vec2(5.0, 27.0), 2.0, 0.0, 3.14159265), sdSeg(q, vec2(7.0, 27.0), vec2(7.0, 11.0))));
    float dd = uPart == 1 ? front : (uPart == 2 ? back : min(front, back));
    add(o, dd - r, tube(dd, r, 1.6), METAL, uColor);
  } else if (uKind == 8) { // staple crown
    float dd = sdSeg(p, vec2(-6.0, 0.0), vec2(6.0, 0.0));
    add(o, dd - 0.6, 0.9 + 0.2 * smoothstep(0.6, 0.0, dd), METAL, vec3(0.85));
  } else if (uKind == 9) { // pencil along x, tip at -L/2
    float L = uLength, w = 8.6, R = w * 0.5;
    float x = p.x + L * 0.5;            // 0 at the tip
    float ay = abs(p.y);
    float cone = 24.0;
    if (x >= 0.0 && x < cone) {
      float rr = R * x / cone;
      if (ay < rr) {
        bool lead = x < 6.0;
        vec3 wood = uColor2;
        add(o, ay - rr, R + sqrt(max(rr * rr - p.y * p.y, 0.0)) - (R - rr) * 0.6, lead ? GRAPHITE : WOOD, lead ? vec3(0.17) : wood);
      }
      o.sd = min(o.sd, ay - rr);
    } else if (x >= cone && x <= L) {
      float hexTop = R * 1.0 - max(0.0, ay - w * 0.25) * 1.15;
      float sd = max(ay - R, max(cone - x, x - L));
      int mat = PAINT; vec3 c = uColor;
      if (x > L - 16.0 && x <= L - 6.0) { mat = METAL; c = vec3(0.82, 0.76, 0.55); hexTop = sqrt(max(R * R - p.y * p.y, 0.0)) * (0.92 + 0.08 * step(0.5, fract(x * 0.5))); }
      else if (x > L - 6.0) { mat = MATTE; c = vec3(0.92, 0.55, 0.55); hexTop = sqrt(max(R * R - p.y * p.y, 0.0)) * 0.95; }
      add(o, sd, R + hexTop * 0.95, mat, c);
    }
  } else if (uKind == 10) { // steel ruler
    float L = uLength;
    float sd = sdBox(p, vec2(L * 0.5, 13.0), 1.5);
    vec3 c = vec3(0.78, 0.79, 0.8) * (0.93 + 0.07 * vnoise(vec2(p.x * 0.05, p.y * 3.0)));
    float x = p.x + L * 0.5 - 8.0;
    float mm = 3.7795;
    float k = floor(x / mm + 0.5);
    float tl = mod(k, 10.0) == 0.0 ? 9.0 : (mod(k, 5.0) == 0.0 ? 6.5 : 4.0);
    if (x > -0.5 && x < L - 16.0 && abs(x - k * mm) < 0.35 && p.y < -13.0 + tl) c *= 0.25;
    add(o, sd, 1.4 * smoothstep(0.0, -0.8, sd), STEEL, c);
  } else if (uKind == 11) { // eraser with sleeve
    float sd = sdBox(p, vec2(23.0, 10.0), 3.0);
    float h = 9.5 * smoothstep(0.0, -3.5, sd);
    bool sleeve = p.x > -8.0 && p.x < 20.0;
    add(o, sd, h + (sleeve ? 0.4 : 0.0), sleeve ? CARD : MATTE, sleeve ? uColor : vec3(0.95, 0.94, 0.92));
  } else if (uKind == 12 || uKind == 15) { // tape roll / washi roll seen from above
    bool washi = uKind == 15;
    float Ro = washi ? 24.0 : 31.0, Ri = washi ? 16.0 : 21.0, Rc = Ri - 2.6;
    float H = washi ? 14.0 : 16.5;
    float sdOut = d - Ro;
    if (d > Ri && d < Ro) {
      vec3 c = uColor * (0.93 + 0.07 * sin(d * 7.0 + vnoise(p * 0.3) * 3.0));
      add(o, sdOut, H - 0.6 * smoothstep(Ro - 1.2, Ro, d) - 0.6 * smoothstep(Ri + 1.2, Ri, d), MATTE, c);
    }
    if (d > Rc && d <= Ri) add(o, -1.0, H + 0.4, CARD, vec3(0.62, 0.5, 0.37));
    o.sd = min(o.sd, max(sdOut, Rc - d));
  } else if (uKind == 13) { // mug: rim, coffee, handle
    float Ro = 38.0, Ri = 33.5;
    vec2 hp = p - vec2(Ro + 7.0, 0.0);
    float dh = abs(length(hp * vec2(1.0, 0.8)) - 9.0);
    if (p.x > Ro - 2.0) add(o, dh - 3.2, tube(dh, 3.2, 52.0), CERAMIC, uColor);
    if (d < Ro) {
      if (d > Ri) add(o, d - Ro, 80.0 + 1.5 * dome(abs(d - (Ro + Ri) * 0.5), (Ro - Ri) * 0.5), CERAMIC, uColor);
      else {
        float crema = smoothstep(Ri - 4.0, Ri - 0.5, d);
        vec3 c = mix(vec3(0.17, 0.09, 0.05), vec3(0.42, 0.27, 0.15), crema * 0.7);
        add(o, d - Ro, 66.0 + 2.0 * crema, COFFEE, c);
      }
    }
    o.sd = min(o.sd, d - Ro);
  } else if (uKind == 16) { // metal eyelet: rolled ring around a 6px hole, see-through middle
    float ri = 6.0, ro = 9.0;
    if (d > ri - 0.4 && d < ro) {
      float m = (d - ri) / (ro - ri);
      add(o, max(d - ro, ri - 0.4 - d), 0.35 + 1.0 * sqrt(max(1.0 - (2.0 * m - 0.7) * (2.0 * m - 0.7), 0.0)), BRASS, uColor);
    }
    o.sd = min(o.sd, max(d - ro, ri - 0.4 - d));
  } else if (uKind == 14) { // craft knife along x, blade at -L/2
    float L = uLength;
    float x = p.x + L * 0.5;
    float body = sdBox(p - vec2(8.0, 0.0), vec2(L * 0.5 - 8.0, 4.8), 4.5);
    float ay = abs(p.y);
    if (body < 0.0) {
      float hh = 4.8 + sqrt(max(4.8 * 4.8 - p.y * p.y, 0.0));
      bool grip = x > 30.0 && x < 70.0;
      bool collar = x > 16.0 && x < 24.0;
      vec3 c = grip ? uColor : vec3(0.75, 0.77, 0.8);
      if (grip) hh += 0.5 * sin(x * 1.6);
      add(o, body, hh, grip ? MATTE : (collar ? METAL : STEEL), c);
    }
    // blade: angled triangle
    vec2 b = vec2(x, p.y);
    float blade = max(max(-b.x, b.x - 18.0), max(-b.y - 3.2, b.y - 3.2 + (18.0 - b.x) * 0.35));
    if (x < 18.0 && blade < 0.0) add(o, blade, 1.2, METAL, vec3(0.92));
    o.sd = min(o.sd, min(body, x < 18.0 ? blade : 1e5));
  }
  return o;
}

float heightAt(vec2 p) { return scene(p).h; }

vec2 local(vec2 px) {
  vec2 v = (px - uOrigin) / uScale;
  float c = cos(uAngle), s = sin(uAngle);
  return vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
}
vec2 toLocalDir(vec2 dir) {
  float c = cos(uAngle), s = sin(uAngle);
  return vec2(c * dir.x + s * dir.y, -s * dir.x + c * dir.y);
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 p = local(px);
  Hit o = scene(p);
  float alpha = clamp(0.5 - o.sd * uScale, 0.0, 1.0);

  // light in the object's frame
  vec2 l2 = toLocalDir(uLight.xy);
  vec3 L = normalize(vec3(l2, uLight.z));
  float tanE = L.z / max(length(L.xy), 1e-3);
  vec2 ld = normalize(L.xy);

  // shadow: march towards the light, compare the ray height with the field
  float h0 = o.h * step(0.0, -o.sd);
  float vis = 1.0;
  float reach = (uMaxH - h0) / tanE + 2.0;
  for (int i = 1; i <= 40; i++) {
    float t = reach * float(i) / 40.0;
    float z = h0 + t * tanE;
    float hh = heightAt(p + ld * t);
    if (hh > 0.001) vis = min(vis, clamp((z - hh) / (0.07 * t + 0.5), 0.0, 1.0));
    if (vis <= 0.0) break;
  }

  vec3 col = vec3(0.0);
  if (alpha > 0.0) {
    float e = 0.3;
    float hx = (heightAt(p + vec2(e, 0.0)) - heightAt(p - vec2(e, 0.0))) / (2.0 * e);
    float hy = (heightAt(p + vec2(0.0, e)) - heightAt(p - vec2(0.0, e))) / (2.0 * e);
    vec3 n = normalize(vec3(-hx, -hy, 1.0));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float dif = max(dot(n, L), 0.0) * (0.35 + 0.65 * vis);
    float nh = max(dot(n, H), 0.0);
    vec3 r = reflect(-V, n);
    vec3 base = o.col;
    int m = o.mat;
    if (m == METAL || m == BRASS || m == STEEL) {
      vec3 tint = base;
      float horizon = length(r.xy);
      float env = 0.32 + 0.38 * r.z + 0.75 * max(dot(normalize(r.xy + 1e-5), ld), 0.0) * horizon;
      if (m == STEEL) env += 0.08 * (vnoise(vec2(p.x * 0.08, p.y * 4.0)) - 0.5);
      col = tint * env * (0.55 + 0.45 * vis) + vec3(1.0) * pow(nh, 90.0) * 1.4 * vis;
    } else if (m == COFFEE) {
      col = base * (0.6 + 0.5 * dif) + vec3(1.0) * pow(nh, 180.0) * 1.2 * vis;
    } else {
      float sp = m == PLASTIC ? 0.55 : (m == CERAMIC ? 0.45 : (m == PAINT ? 0.5 : (m == GRAPHITE ? 0.25 : 0.05)));
      float sh = m == PLASTIC ? 70.0 : (m == CERAMIC ? 50.0 : 40.0);
      if (m == WOOD) base *= 0.9 + 0.12 * sin(p.x * 0.9 + vnoise(p * vec2(0.15, 1.2)) * 6.0);
      if (m == CARD) base *= 0.92 + 0.1 * vnoise(p * 0.8);
      if (m == MATTE) base *= 0.95 + 0.06 * vnoise(p * 1.3);
      col = base * (0.42 + 0.7 * dif) + vec3(1.0) * pow(nh, sh) * sp * vis;
      // soft translucent glow for coloured plastic
      if (m == PLASTIC) col += base * 0.12 * (1.0 - n.z);
    }
  }
  // ground shadow under / around the object
  float shadow = (1.0 - vis) * 0.42 * (1.0 - alpha);
  float outA = alpha + shadow;
  outColor = vec4(outA > 0.0 ? clamp(col, 0.0, 1.0) * alpha / outA : vec3(0.0), outA);
}
`;

export function createPropRenderer() {
let gl: WebGL2RenderingContext | null = null;
let prog: WebGLProgram;
const loc = new Map<string, WebGLUniformLocation | null>();

function init() {
  const canvas = new OffscreenCanvas(1, 1);
  const g = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
  if (!g) throw new Error('WebGL2 not available');
  gl = g;
  const sh = (type: number, src: string) => {
    const s = g.createShader(type)!;
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  prog = g.createProgram()!;
  g.attachShader(prog, sh(g.VERTEX_SHADER, VS));
  g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS));
  g.bindAttribLocation(prog, 0, 'aPos');
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog) ?? 'link error');
  const vao = g.createVertexArray();
  g.bindVertexArray(vao);
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
}

const u = (n: string) => {
  if (!loc.has(n)) loc.set(n, gl!.getUniformLocation(prog, n));
  return loc.get(n)!;
};

const DEFAULT_LIGHT = { azimuth: 225, elevation: 48 };

function renderProp(spec: PropSpec, dpr: number): Sprite {
  if (!gl) init();
  const g = gl!;
  const [rad, maxH] = EXTENT[spec.kind];
  const len = spec.length ?? (spec.kind === 'ruler' ? 300 : spec.kind === 'knife' ? 120 : 170);
  const r = spec.kind === 'pencil' || spec.kind === 'ruler' || spec.kind === 'knife' ? len / 2 + 14 : rad;
  const el = ((spec.elevation ?? DEFAULT_LIGHT.elevation) * Math.PI) / 180;
  const az = ((spec.azimuth ?? DEFAULT_LIGHT.azimuth) * Math.PI) / 180;
  const shadowLen = maxH / Math.tan(el) + 3;
  // shadow falls away from the light
  const sx = -Math.cos(az) * shadowLen, sy = -Math.sin(az) * shadowLen;
  const minX = -r + Math.min(0, sx) - 2, maxX = r + Math.max(0, sx) + 2;
  const minY = -r + Math.min(0, sy) - 2, maxY = r + Math.max(0, sy) + 2;
  const w = Math.ceil(maxX - minX), h = Math.ceil(maxY - minY);
  const W = Math.ceil(w * dpr), H = Math.ceil(h * dpr);
  (g.canvas as OffscreenCanvas).width = W;
  (g.canvas as OffscreenCanvas).height = H;
  g.viewport(0, 0, W, H);
  g.useProgram(prog);
  const c1 = parseColor(spec.color ?? '#d33b3b');
  const c2 = parseColor(spec.color2 ?? '#e8c79a');
  g.uniform2f(u('uOrigin'), -minX * dpr, -minY * dpr);
  g.uniform1f(u('uScale'), dpr);
  g.uniform1f(u('uAngle'), ((spec.angle ?? 0) * Math.PI) / 180);
  g.uniform3f(u('uLight'), Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
  g.uniform1i(u('uKind'), KIND_ID[spec.kind]);
  g.uniform3f(u('uColor'), c1[0], c1[1], c1[2]);
  g.uniform3f(u('uColor2'), c2[0], c2[1], c2[2]);
  g.uniform1f(u('uLength'), len);
  g.uniform1i(u('uPart'), spec.part === 'front' ? 1 : spec.part === 'back' ? 2 : 0);
  g.uniform1f(u('uSeed'), spec.seed ?? 0);
  g.uniform1f(u('uMaxH'), maxH);
  g.drawArrays(g.TRIANGLES, 0, 3);
  const px = new Uint8ClampedArray(W * H * 4);
  g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (spec.kind === 'ruler') labelRuler(canvas, -minX, -minY, len, spec.angle ?? 0, dpr);
  return { canvas, w, h, ox: -minX, oy: -minY };
}

function labelRuler(canvas: HTMLCanvasElement, ox: number, oy: number, len: number, angle: number, dpr: number) {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(ox, oy);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.font = "600 7.5px 'IBM Plex Mono', monospace";
  ctx.fillStyle = 'rgba(30,30,32,0.85)';
  ctx.textAlign = 'center';
  const mm = 3.7795;
  for (let cm = 1; cm * 10 * mm < len - 18; cm++) ctx.fillText(String(cm), -len / 2 + 8 + cm * 10 * mm, -1);
  ctx.font = "500 6px 'IBM Plex Mono', monospace";
  ctx.textAlign = 'left';
  ctx.fillText('STAINLESS  ·  30 cm', -len / 2 + 10, 9);
  ctx.restore();
}

return { renderProp, dispose() { gl?.getExtension('WEBGL_lose_context')?.loseContext(); gl = null; loc.clear(); } };
}
let shared: ReturnType<typeof createPropRenderer> | undefined;
export const renderProp: ReturnType<typeof createPropRenderer>['renderProp'] = (...args) => (shared ??= createPropRenderer()).renderProp(...args);
