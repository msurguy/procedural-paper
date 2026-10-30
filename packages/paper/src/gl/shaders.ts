/**
 * GLSL ES 3.00 twins of src/cpu/*. Keep in sync with:
 *   hash.ts (pcg, hash2, u01), cpu/noise.ts, cpu/field.ts, cpu/strands.ts, cpu/compose.ts
 */

export const VS = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const COMMON = /* glsl */ `
precision highp float;
precision highp int;
const float TAU = 6.283185307179586;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
uint hash2(int x, int y, uint seed) { return pcg(uint(x) + pcg(uint(y) + pcg(seed))); }
float u01(uint h) { return float(h >> 8u) * (1.0 / 16777216.0); }
int imod(int a, int b) { return a - b * int(floor(float(a) / float(b))); }
ivec2 imod2(ivec2 a, ivec2 b) { return ivec2(imod(a.x, b.x), imod(a.y, b.y)); }

float corner(ivec2 c, ivec2 per, uint seed, vec2 d) {
  ivec2 w = imod2(c, per);
  uint h = hash2(w.x, w.y, seed) & 31u;
  float a = float(h) * (TAU / 32.0);
  return cos(a) * d.x + sin(a) * d.y;
}
float fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float gnoise(vec2 p, ivec2 per, uint seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 c = ivec2(i);
  float a = corner(c, per, seed, f);
  float b = corner(c + ivec2(1, 0), per, seed, f - vec2(1.0, 0.0));
  float cc = corner(c + ivec2(0, 1), per, seed, f - vec2(0.0, 1.0));
  float d = corner(c + ivec2(1, 1), per, seed, f - vec2(1.0, 1.0));
  vec2 u = vec2(fade(f.x), fade(f.y));
  float ab = mix(a, b, u.x);
  float cd = mix(cc, d, u.x);
  return mix(ab, cd, u.y) * 1.4142;
}

float fbm(vec2 p, ivec2 per, int octaves, float persistence, uint seed) {
  float sum = 0.0, amp = 1.0, norm = 0.0, f = 1.0;
  for (int o = 0; o < 12; o++) {
    if (o >= octaves) break;
    int fi = int(f);
    sum += amp * gnoise(p * f, per * fi, seed + uint(o));
    norm += amp;
    amp *= persistence;
    f *= 2.0;
  }
  return sum / norm;
}

vec2 worley(vec2 p, ivec2 per, uint seed) {
  ivec2 c = ivec2(floor(p));
  float f1 = 9.0, f2 = 9.0, acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 n = c + ivec2(i, j);
      ivec2 w = imod2(n, per);
      uint h = hash2(w.x, w.y, seed);
      vec2 pt = vec2(n) + vec2(u01(h), u01(pcg(h)));
      float d = length(pt - p);
      acc += exp(-10.0 * d);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(max(0.0, -log(acc) / 10.0), f2);
}
`;

/** Sheet-scale overlays; twins of cpu/overlays.ts. */
export const OVERLAYS = /* glsl */ `
vec3 crV[9];
void crVertex(ivec2 n, ivec2 per, uint seed, int k) {
  ivec2 w = imod2(n, per);
  uint h = hash2(w.x, w.y, seed);
  float jx = u01(h); h = pcg(h);
  float jy = u01(h); h = pcg(h);
  crV[k] = vec3(vec2(n) + 0.5 + (vec2(jx, jy) - 0.5) * 0.7, u01(h) * 2.0 - 1.0);
}
bool crTri(vec2 p, int a, int b, int c, out float h) {
  vec2 v0 = crV[b].xy - crV[a].xy, v1 = crV[c].xy - crV[a].xy, v2 = p - crV[a].xy;
  float d = v0.x * v1.y - v1.x * v0.y;
  float u = (v2.x * v1.y - v1.x * v2.y) / d;
  float v = (v0.x * v2.y - v2.x * v0.y) / d;
  h = crV[a].z + u * (crV[b].z - crV[a].z) + v * (crV[c].z - crV[a].z);
  return u >= -1e-5 && v >= -1e-5 && u + v <= 1.0 + 1e-5;
}
// periodic faceted height in [-1, 1]; p in lattice units
float crumple(vec2 p, ivec2 per, uint seed) {
  ivec2 c = ivec2(floor(p));
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) crVertex(c + ivec2(i - 1, j - 1), per, seed, j * 3 + i);
  float h;
  for (int qy = 0; qy < 2; qy++) for (int qx = 0; qx < 2; qx++) {
    int a = qy * 3 + qx, b = a + 1, cc = a + 3, d = a + 4;
    ivec2 qw = imod2(c + ivec2(qx - 1, qy - 1), per);
    uint diag = hash2(qw.x, qw.y, seed + 7u) & 1u;
    if (diag == 0u) {
      if (crTri(p, a, b, d, h)) return h;
      if (crTri(p, a, d, cc, h)) return h;
    } else {
      if (crTri(p, a, b, cc, h)) return h;
      if (crTri(p, b, d, cc, h)) return h;
    }
  }
  return 0.0;
}
float foldAxis(float x, float L, int count, float offset, uint seed, float strength, float width, out float dist) {
  float s = L / float(count);
  float t = x / s - offset;
  float k = floor(t);
  float f = t - k;
  int k0 = imod(int(k), count);
  int k1 = imod(int(k) + 1, count);
  float h0 = u01(hash2(k0, 0, seed)) * 2.0 - 1.0;
  float h1 = u01(hash2(k1, 0, seed)) * 2.0 - 1.0;
  float panel = h0 + (h1 - h0) * f;
  float dn = min(f, 1.0 - f) * s;
  int kn = f < 0.5 ? k0 : k1;
  float sgn = u01(pcg(hash2(kn, 0, seed))) < 0.5 ? -1.0 : 1.0;
  float rr = max(0.0, 1.0 - dn / width);
  dist = dn;
  return strength * (panel * s * 0.12 + sgn * rr * rr * width * 0.3);
}
`;

export const FIELD_FS = /* glsl */ `#version 300 es
${COMMON}
${OVERLAYS}
uniform ivec2 uSize;      // tile size
uniform ivec2 uOrigin;    // absolute pixel of this target's (0,0)

uniform vec3 uBase, uTint;
uniform float uTintAmount, uVariation, uGrainTone;

uniform uint uMoSeed, uMoTintSeed, uMoWarpSeed;
uniform ivec2 uMoPer; uniform int uMoOct; uniform float uMoWarp, uMoRelief;

uniform uint uGrSeed; uniform ivec2 uGrPer; uniform int uGrOct; uniform float uGrRough, uGrStrength;

uniform uint uCeSeed, uCeWarpSeed; uniform ivec2 uCePer; uniform float uCeStrength, uCeRidge, uCeWarp;

uniform uint uSkSeed; uniform ivec2 uSkPer; uniform int uSkOct; uniform float uSkStrength;

uniform int uStType; uniform uint uStSeed; uniform ivec2 uStPer;
uniform float uStStrength, uStSharp, uStWarp; uniform bool uStVertical;

uniform uint uFbSeed; uniform ivec2 uFbPer; uniform vec2 uFbCell; uniform float uFbCount;
uniform float uFbLength, uFbWidth, uFbCurl, uFbDarkRatio, uFbOpacity, uFbRelief;
uniform vec3 uFbDark, uFbLight;

uniform uint uSpSeed; uniform ivec2 uSpPer; uniform vec2 uSpCell; uniform float uSpCount;
uniform float uSpMin, uSpMax, uSpElong, uSpOpacity, uSpRelief;
uniform vec3 uSpC0, uSpC1, uSpC2;

uniform uint uCrSeed, uCrWarpSeed; uniform ivec2 uCrPer, uCrWPer; uniform float uCrAmp, uCrWAmp, uCrWarp;
uniform uint uFoSeed; uniform ivec2 uFoCount; uniform float uFoOffset, uFoStrength, uFoWidth, uFoWear;
uniform uint uSnSeed; uniform ivec2 uSnPer; uniform vec2 uSnCell; uniform float uSnDensity, uSnSize, uSnStrength, uSnRing; uniform vec3 uSnColor;

out vec4 outField;

// returns colour multiplier; adds relief to dh
vec3 overlays(vec2 p, float u, float v, inout float dh) {
  vec3 mul = vec3(1.0);
  if (uCrAmp > 0.0 || uCrWAmp > 0.0) {
    float wu = u, wv = v;
    if (uCrWarp > 0.0) {
      float k = uCrWarp / (float(uCrPer.x + uCrPer.y) * 0.5);
      wu += k * gnoise(vec2(u, v) * vec2(uCrPer), uCrPer, uCrWarpSeed);
      wv += k * gnoise(vec2(u, v) * vec2(uCrPer) + vec2(5.2, 1.3), uCrPer, uCrWarpSeed);
    }
    if (uCrAmp > 0.0) dh += uCrAmp * crumple(vec2(wu, wv) * vec2(uCrPer), uCrPer, uCrSeed);
    if (uCrWAmp > 0.0) {
      dh += uCrWAmp * (crumple(vec2(wu, wv) * vec2(uCrWPer), uCrWPer, uCrSeed + 1u)
        + 0.5 * crumple(vec2(wu, wv) * vec2(uCrWPer * 2), uCrWPer * 2, uCrSeed + 2u));
    }
  }
  if (uFoStrength > 0.0 || uFoWear > 0.0) {
    float wear = 0.0, d;
    if (uFoCount.x > 0) {
      dh += foldAxis(p.x, float(uSize.x), uFoCount.x, uFoOffset, uFoSeed, uFoStrength, uFoWidth, d);
      wear = max(wear, exp(-(d / 1.3) * (d / 1.3)));
    }
    if (uFoCount.y > 0) {
      dh += foldAxis(p.y, float(uSize.y), uFoCount.y, uFoOffset, uFoSeed + 1u, uFoStrength, uFoWidth, d);
      wear = max(wear, exp(-(d / 1.3) * (d / 1.3)));
    }
    mul *= 1.0 - uFoWear * 0.22 * wear;
  }
  if (uSnDensity > 0.0 && uSnStrength > 0.0) {
    ivec2 c = ivec2(floor(p / uSnCell));
    float keep = 1.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec2 n = c + ivec2(i, j);
      ivec2 w = imod2(n, uSnPer);
      uint h = hash2(w.x, w.y, uSnSeed);
      if (u01(h) >= uSnDensity) continue;
      h = pcg(h); float r1 = u01(h);
      h = pcg(h); float r2 = u01(h);
      h = pcg(h); float r3 = u01(h);
      h = pcg(h); float r4 = u01(h);
      h = pcg(h); float r5 = u01(h);
      h = pcg(h); float r6 = u01(h);
      vec2 cen = (vec2(n) + 0.2 + 0.6 * vec2(r1, r2)) * uSnCell;
      float R = uSnSize * (0.55 + 0.55 * r3);
      vec2 dd = p - cen;
      float L = length(dd);
      if (L > R * 1.3) continue;
      float a = atan(dd.y, dd.x);
      float e = 1.0 + 0.035 * sin(3.0 * a + r4 * TAU) + 0.02 * sin(7.0 * a + r5 * TAU);
      float q = L / (R * e);
      float inside = clamp((1.0 - q) * R * e + 0.5, 0.0, 1.0);
      float t = (q - 0.985) / 0.03;
      float ring = exp(-t * t) * (0.35 + 0.65 * smoothstep(-0.4, 0.6, sin(a + r6 * TAU)));
      float alpha = clamp(inside * (0.1 + 0.14 * q * q) + ring * uSnRing, 0.0, 1.0) * uSnStrength;
      keep *= 1.0 - alpha;
      dh += 0.15 * ring * uSnStrength;
    }
    mul *= 1.0 + (uSnColor - 1.0) * (1.0 - keep);
  }
  return mul;
}

float structureHeight(float u, float v) {
  float a = uStVertical ? u : v;
  float b = uStVertical ? v : u;
  float mainLen = float(uStVertical ? uSize.x : uSize.y);
  float crossLen = float(uStVertical ? uSize.y : uSize.x);
  int wpa = max(1, int(round(float(uStPer.x) / 4.0)));
  int wpb = max(1, int(round(float(uStPer.y) / 4.0)));
  float A = a * float(uStPer.x) + uStWarp * 0.6 * gnoise(vec2(a * float(wpa), b * float(wpb)), ivec2(wpa, wpb), uStSeed);
  float B = b * float(uStPer.y);
  float sharp = uStSharp;
  if (uStType == 1) {
    float s = 0.5 + 0.5 * cos(TAU * A);
    return pow(s, 1.0 + 5.0 * sharp) * 2.0 - 1.0;
  } else if (uStType == 2) {
    float chain = pow(0.5 + 0.5 * cos(TAU * B), 8.0 + 60.0 * sharp);
    return 0.6 * cos(TAU * A) + 1.2 * chain - 0.1;
  } else if (uStType == 3) {
    float cellA = mainLen / float(uStPer.x);
    float cellB = crossLen / float(uStPer.y);
    float cm = min(cellA, cellB);
    int row = int(floor(A));
    float dmin = 9.0;
    for (int dr = -1; dr <= 1; dr++) {
      int rr = row + dr;
      float off = imod(rr, 2) == 1 ? 0.5 : 0.0;
      float col = floor(B - off);
      for (int dc = -1; dc <= 1; dc++) {
        float dy = (A - (float(rr) + 0.5)) * cellA;
        float dx = (B - (col + float(dc) + off + 0.5)) * cellB;
        dmin = min(dmin, sqrt(dx * dx + dy * dy) / cm);
      }
    }
    float edge = mix(0.45, 0.08, sharp);
    return smoothstep(0.35 - edge, 0.35 + edge, dmin) * 2.0 - 1.0;
  } else if (uStType == 4) {
    float x = cos(TAU * A) * cos(TAU * B);
    return sign(x) * pow(abs(x), 1.0 - 0.7 * sharp);
  }
  return 0.0;
}

uint slotHash(ivec2 w, uint seed, int k) { return pcg(hash2(w.x, w.y, seed) + uint(k) * 0x9e3779b9u); }

float segDist2(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a, w = p - a;
  float t = clamp(dot(w, e) / (dot(e, e) + 1e-9), 0.0, 1.0);
  vec2 q = w - e * t;
  return dot(q, q);
}

// returns (darkT, lightT)
vec2 fibers(vec2 p) {
  float darkT = 1.0, lightT = 1.0;
  if (uFbCount <= 0.0 || uFbOpacity <= 0.0) return vec2(1.0);
  ivec2 c = ivec2(floor(p / uFbCell));
  int slots = int(ceil(uFbCount));
  float reach = uFbLength * (0.5 + 0.75 * uFbCurl) + uFbWidth * 0.7 + 1.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 n = c + ivec2(i, j);
    ivec2 w = imod2(n, uFbPer);
    for (int k = 0; k < 32; k++) {
      if (k >= slots) break;
      uint h = slotHash(w, uFbSeed, k);
      if (u01(h) >= clamp(uFbCount - float(k), 0.0, 1.0)) continue;
      h = pcg(h); float r1 = u01(h);
      h = pcg(h); float r2 = u01(h);
      vec2 cen = (vec2(n) + vec2(r1, r2)) * uFbCell;
      if (length(p - cen) > reach) continue;
      h = pcg(h); float r3 = u01(h);
      h = pcg(h); float r4 = u01(h);
      h = pcg(h); float r5 = u01(h);
      h = pcg(h); float r6 = u01(h);
      h = pcg(h); float r7 = u01(h);
      h = pcg(h); float r8 = u01(h);
      h = pcg(h); float r9 = u01(h);
      float ang = r3 * TAU;
      vec2 d = vec2(cos(ang), sin(ang));
      vec2 nrm = vec2(-d.y, d.x);
      float L = uFbLength * (0.4 + 0.6 * r4);
      float c1 = (r5 * 2.0 - 1.0) * uFbCurl * L;
      float c2 = (r6 * 2.0 - 1.0) * uFbCurl * L;
      vec2 p0 = cen - d * L * 0.5;
      vec2 p3 = cen + d * L * 0.5;
      vec2 p1 = p0 + d * L / 3.0 + nrm * c1;
      vec2 p2 = p0 + d * 2.0 * L / 3.0 + nrm * c2;
      float d2 = 1e20;
      vec2 prev = p0;
      for (int s = 1; s <= 6; s++) {
        float t = float(s) / 6.0;
        float q = 1.0 - t;
        vec2 cur = q * q * q * p0 + 3.0 * q * q * t * p1 + 3.0 * q * t * t * p2 + t * t * t * p3;
        d2 = min(d2, segDist2(p, prev, cur));
        prev = cur;
      }
      float hw = uFbWidth * (0.6 + 0.8 * r8) * 0.5;
      float cov = clamp(hw + 0.5 - sqrt(d2), 0.0, 1.0);
      if (cov <= 0.0) continue;
      float alpha = uFbOpacity * (0.4 + 0.6 * r9);
      if (r7 < uFbDarkRatio) darkT *= 1.0 - cov * alpha; else lightT *= 1.0 - cov * alpha;
    }
  }
  return vec2(darkT, lightT);
}

// returns accumulated (rgb * a, a) and transmittance in .w of second
void specks(vec2 p, out vec4 acc, out float T) {
  acc = vec4(0.0); T = 1.0;
  if (uSpCount <= 0.0 || uSpOpacity <= 0.0) return;
  ivec2 c = ivec2(floor(p / uSpCell));
  int slots = int(ceil(uSpCount));
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    ivec2 n = c + ivec2(i, j);
    ivec2 w = imod2(n, uSpPer);
    for (int k = 0; k < 32; k++) {
      if (k >= slots) break;
      uint h = slotHash(w, uSpSeed, k);
      if (u01(h) >= clamp(uSpCount - float(k), 0.0, 1.0)) continue;
      h = pcg(h); float r1 = u01(h);
      h = pcg(h); float r2 = u01(h);
      h = pcg(h); float r3 = u01(h);
      h = pcg(h); float r4 = u01(h);
      h = pcg(h); float r5 = u01(h);
      vec2 cen = (vec2(n) + vec2(r1, r2)) * uSpCell;
      float rad = uSpMin + (uSpMax - uSpMin) * r4 * r4 * r4;
      float rb = rad;
      float ra = rad * (1.0 + uSpElong * r5);
      vec2 dd = p - cen;
      if (length(dd) > 1.32 * ra + 0.66 * ra / rb + 1.0) continue;
      h = pcg(h); float r6 = u01(h);
      h = pcg(h); float r7 = u01(h);
      h = pcg(h); float r8 = u01(h);
      h = pcg(h); float r9 = u01(h);
      float ang = r3 * TAU;
      float cs = cos(ang), sn = sin(ang);
      vec2 q = vec2(dd.x * cs + dd.y * sn, -dd.x * sn + dd.y * cs);
      vec2 e = vec2(q.x / ra, q.y / rb);
      float a2 = atan(e.y, e.x);
      float irr = 1.0 + 0.12 * sin(3.0 * a2 + r8 * TAU) + 0.1 * sin(5.0 * a2 + r9 * TAU);
      float dn = length(e) / irr;
      float cov = clamp((1.0 - dn) * rb + 0.5, 0.0, 1.0);
      if (cov <= 0.0) continue;
      int ci = min(2, int(floor(r6 * 3.0)));
      vec3 col = ci == 0 ? uSpC0 : (ci == 1 ? uSpC1 : uSpC2);
      float a = cov * uSpOpacity * (0.5 + 0.5 * r7);
      T *= 1.0 - a;
      acc += vec4(col * a, a);
    }
  }
}

void main() {
  ivec2 ip = imod2(uOrigin + ivec2(gl_FragCoord.xy), uSize);
  vec2 p = vec2(ip) + 0.5;
  float u = p.x / float(uSize.x);
  float v = p.y / float(uSize.y);

  // mottle
  vec2 mp = vec2(u, v) * vec2(uMoPer);
  if (uMoWarp > 0.0) {
    float wx = fbm(mp, uMoPer, 3, 0.5, uMoWarpSeed);
    float wy = fbm(mp + vec2(5.2, 1.3), uMoPer, 3, 0.5, uMoWarpSeed);
    mp += uMoWarp * vec2(wx, wy);
  }
  float m = fbm(mp, uMoPer, uMoOct, 0.5, uMoSeed);
  float t = uTintAmount > 0.0 ? fbm(vec2(u, v) * vec2(uMoPer), uMoPer, uMoOct, 0.5, uMoTintSeed) : 0.0;

  float g = uGrStrength > 0.0 ? fbm(vec2(u, v) * vec2(uGrPer), uGrPer, uGrOct, uGrRough, uGrSeed) : 0.0;

  float hc = 0.0;
  if (uCeStrength > 0.0) {
    vec2 cp = vec2(u, v) * vec2(uCePer);
    if (uCeWarp > 0.0) {
      cp.x += uCeWarp * fbm(cp, uCePer, 2, 0.5, uCeWarpSeed);
      cp.y += uCeWarp * fbm(cp + vec2(3.7, 8.1), uCePer, 2, 0.5, uCeWarpSeed);
    }
    vec2 F = worley(cp, uCePer, uCeSeed);
    float dome = 0.5 - F.x;
    float ridge = F.y - F.x - 0.4;
    hc = mix(dome, ridge, uCeRidge) * 2.0;
  }

  float st = uSkStrength > 0.0 ? fbm(vec2(u, v) * vec2(uSkPer), uSkPer, uSkOct, 0.5, uSkSeed) : 0.0;
  float hs = uStStrength > 0.0 ? structureHeight(u, v) : 0.0;

  float surface = uGrStrength * g + uCeStrength * hc + uSkStrength * st + uStStrength * hs;
  float height = uMoRelief * m + surface;

  float ta = uTintAmount * clamp(0.5 + t, 0.0, 1.0);
  float tone = 1.0 + uVariation * 2.0 * m + uGrainTone * surface;
  vec3 col = mix(uBase, uTint, ta) * tone;

  vec2 fT = fibers(p);
  col = mix(col, uFbDark, 1.0 - fT.x);
  col = mix(col, uFbLight, 1.0 - fT.y);
  height += uFbRelief * (1.0 - fT.x * fT.y);

  vec4 acc; float T;
  specks(p, acc, T);
  if (acc.w > 0.0) {
    col = mix(col, acc.rgb / acc.w, 1.0 - T);
    height += uSpRelief * (1.0 - T);
  }

  vec3 mul = overlays(p, u, v, height);
  outField = vec4(col * mul, height);
}
`;

export const COMPOSE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uField; // padded by 1px on every side
uniform int uMode;              // 0 color, 1 albedo, 2 overlay, 3 height, 4 normal
uniform vec3 uLight;
uniform float uDepth, uBaseLum, uHeightNorm, uBrightness, uContrast;
uniform bool uFlipY;
uniform bool uFlipOut;          // flip vertically when drawing to the default framebuffer
uniform int uOutHeight;
out vec4 outColor;

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  if (uFlipOut) ij.y = uOutHeight - 1 - ij.y;
  ivec2 q = ij + 1;
  vec4 f = texelFetch(uField, q, 0);
  float hx = (texelFetch(uField, q + ivec2(1, 0), 0).a - texelFetch(uField, q - ivec2(1, 0), 0).a) * 0.5;
  float hy = (texelFetch(uField, q + ivec2(0, 1), 0).a - texelFetch(uField, q - ivec2(0, 1), 0).a) * 0.5;
  vec3 n = normalize(vec3(-hx * uDepth, -hy * uDepth, 1.0));

  if (uMode == 4) {
    outColor = vec4(n.x * 0.5 + 0.5, (uFlipY ? n.y : -n.y) * 0.5 + 0.5, n.z * 0.5 + 0.5, 1.0);
    return;
  }
  if (uMode == 3) {
    outColor = vec4(vec3(clamp(0.5 + 0.5 * f.a * uHeightNorm, 0.0, 1.0)), 1.0);
    return;
  }
  float shade = clamp(dot(n, uLight) / uLight.z, 0.0, 3.0);
  vec3 c = uMode == 1 ? f.rgb : f.rgb * shade;
  if (uMode == 2) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    outColor = vec4(vec3(clamp((lum - uBaseLum) * 0.5 * uContrast + 0.5 + uBrightness, 0.0, 1.0)), 1.0);
    return;
  }
  outColor = vec4(clamp((c - 0.5) * uContrast + 0.5 + uBrightness, 0.0, 1.0), 1.0);
}
`;
