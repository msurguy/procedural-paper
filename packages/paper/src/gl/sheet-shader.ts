/**
 * Sheet pass: samples the paper field (rendered at the sheet's size, so it
 * wraps exactly once) and adds the outline, holes, sheet-scale relief and a
 * cast shadow. Sheet coordinates are device px with y down, origin at the
 * sheet's top-left; the output has `uMargin` px of transparent border.
 */
import { COMMON, OVERLAYS } from './shaders';
import { MAX_HOLES, MAX_HOLE_ROWS } from '../sheet';

export const SHEET_FS = /* glsl */ `#version 300 es
${COMMON}
${OVERLAYS}
uniform highp sampler2D uField;  // paper field, 1px apron
uniform ivec2 uFieldSize;
uniform vec2 uSheet;
uniform float uMargin;
uniform int uMode;               // 0 color, 1 base, 2 shade, 3 shadow only
uniform int uSeparateShadow;     // 1: color/base omit the cast shadow (it is requested as its own map)
uniform vec3 uLight;
uniform float uDepth;
uniform uint uSeed;

uniform float uRadius, uChamfer, uRim;
uniform ivec4 uEdgeKind;
uniform vec4 uEdgeAmt, uEdgeScale;
uniform int uHoleCount;
uniform vec4 uHoles[${MAX_HOLES}];
uniform int uRowCount;
uniform vec4 uRowA[${MAX_HOLE_ROWS}], uRowB[${MAX_HOLE_ROWS}];

uniform vec2 uCrumples, uWrinkles;   // amp, size
uniform ivec2 uFoCount;
uniform float uFoStrength, uFoOffset, uFoWidth, uFoWear;
uniform vec4 uCurl;                  // amount, radius, corner bits, side bits
uniform vec2 uCockle, uBend;

uniform float uOpacity, uGloss, uEdgeWear, uAging;
uniform vec3 uAgeColor;
uniform int uPattern;
uniform vec3 uPatColor;
uniform vec4 uPatParam;              // scale, angle, width, opacity

uniform vec4 uShadow;                // strength, softness, offset x, offset y
uniform float uShadowLift;

out vec4 outColor;

const ivec2 BIG = ivec2(8192);

float n1(float x, uint s) { return gnoise(vec2(x, 0.37), BIG, s); }
float fbm1(float x, uint s, int oct) {
  float sum = 0.0, amp = 1.0, norm = 0.0, f = 1.0;
  for (int o = 0; o < 6; o++) {
    if (o >= oct) break;
    sum += amp * n1(x * f, s + uint(o));
    norm += amp;
    amp *= 0.55;
    f *= 2.0;
  }
  return sum / norm;
}

// how far the edge bites in at position t along it; rim = width of the fibrous zone beyond it
float edgeProfile(int kind, float t, float amt, float scale, uint s, out float rim) {
  rim = 0.0;
  if (kind == 1) {
    float n = fbm1(t / scale, s, 5);
    rim = uRim * (0.3 + 0.7 * clamp(0.5 + 0.9 * fbm1(t / (scale * 0.3), s + 9u, 3), 0.0, 1.0));
    return amt * clamp(0.5 + 0.7 * n, 0.0, 1.0);
  }
  if (kind == 2) {
    float n = fbm1(t / scale, s, 5);
    rim = uRim * 1.6 * (0.4 + 0.6 * clamp(0.5 + fbm1(t / (scale * 0.25), s + 5u, 3), 0.0, 1.0));
    return amt * clamp(0.5 + 0.7 * n, 0.0, 1.0);
  }
  if (kind == 3) return amt * abs(fract(t / scale) * 2.0 - 1.0);
  if (kind == 4) {
    float seg = floor(t / scale);
    float j = u01(pcg(uint(int(seg) + 4096) ^ s));
    return amt * (0.25 + 0.35 * j + 0.4 * clamp(0.5 + 0.5 * fbm1(t / (scale * 4.0), s, 2), 0.0, 1.0));
  }
  if (kind == 5) return amt * (0.5 + 0.5 * sin(TAU * t / scale));
  return 0.0;
}

float gHole;  // distance to the nearest punched hole (px), set by shape()

// (core, rim) signed distances in px, positive inside the paper
vec2 shape(vec2 q) {
  vec2 S = uSheet;
  float core = 1e5, rim = 1e5;
  vec4 d = vec4(q.y, S.x - q.x, S.y - q.y, q.x);
  vec4 along = vec4(q.x, q.y, S.x - q.x, S.y - q.y);
  for (int i = 0; i < 4; i++) {
    float r;
    float e = edgeProfile(uEdgeKind[i], along[i], uEdgeAmt[i], uEdgeScale[i], uSeed + uint(i) * 101u, r);
    core = min(core, d[i] - e);
    rim = min(rim, d[i] - e + r);
  }
  if (uRadius > 0.0) {
    vec2 h = S * 0.5;
    vec2 qq = abs(q - h) - (h - uRadius);
    float dr = uRadius - (length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0));
    core = min(core, dr);
    rim = min(rim, dr);
  }
  if (uChamfer > 0.0) {
    float dc = min(q.x + q.y - uChamfer, S.x - q.x + q.y - uChamfer) * 0.70710678;
    core = min(core, dc);
    rim = min(rim, dc);
  }
  gHole = 1e5;
  for (int i = 0; i < ${MAX_HOLES}; i++) {
    if (i >= uHoleCount) break;
    vec4 h = uHoles[i];
    vec2 dd = q - h.xy;
    float a = atan(dd.y, dd.x);
    float dh = length(dd) - h.z * (1.0 + h.w * 0.12 * gnoise(vec2(a * 3.0, float(i) * 7.1), BIG, uSeed + 61u));
    gHole = min(gHole, dh);
  }
  for (int i = 0; i < ${MAX_HOLE_ROWS}; i++) {
    if (i >= uRowCount) break;
    vec4 A = uRowA[i], B = uRowB[i];
    vec2 stp = A.zw;
    float k = clamp(floor(dot(q - A.xy, stp) / max(dot(stp, stp), 1e-6) + 0.5), 0.0, B.x - 1.0);
    vec2 c = A.xy + stp * k;
    vec2 dd = q - c;
    float a = atan(dd.y, dd.x);
    uint hs = pcg(uint(int(k) + 17 * i) ^ uSeed);
    float dh = length(dd) - B.y * (1.0 + B.w * 0.12 * gnoise(vec2(a * 3.0, k * 3.1), BIG, hs));
    gHole = min(gHole, dh);
    // torn out towards the nearest sheet side
    if (u01(pcg(hs)) < B.z) {
      vec4 sd = vec4(c.y, S.x - c.x, S.y - c.y, c.x);
      vec2 dir = vec2(0.0, -1.0); float L = sd.x;
      if (sd.y < L) { dir = vec2(1.0, 0.0); L = sd.y; }
      if (sd.z < L) { dir = vec2(0.0, 1.0); L = sd.z; }
      if (sd.w < L) { dir = vec2(-1.0, 0.0); L = sd.w; }
      float along2 = dot(dd, dir);
      float perp = dot(dd, vec2(-dir.y, dir.x));
      float w = B.y * (0.55 + 0.35 * clamp(0.5 + fbm1(along2 * 0.25 + k * 13.0, hs, 3), 0.0, 1.0));
      float slot = min(w - abs(perp), along2 + B.y);
      if (along2 <= L + 2.0) {
        core = min(core, -slot);
        rim = min(rim, -slot + uRim * 0.8);
      }
    }
  }
  core = min(core, gHole);
  rim = min(rim, gHole);
  return vec2(core, rim);
}

float macroH(vec2 q) {
  float h = 0.0;
  if (uCrumples.x > 0.0) h += uCrumples.x * crumple(q / uCrumples.y + 7.3, BIG, uSeed + 31u);
  if (uWrinkles.x > 0.0) {
    h += uWrinkles.x * (crumple(q / uWrinkles.y + 3.1, BIG, uSeed + 32u) + 0.5 * crumple(q / (uWrinkles.y * 0.5), BIG, uSeed + 33u));
  }
  if (uFoStrength > 0.0) {
    float dd;
    if (uFoCount.x > 0) h += foldAxis(q.x, uSheet.x, uFoCount.x, uFoOffset, uSeed + 41u, uFoStrength, uFoWidth, dd);
    if (uFoCount.y > 0) h += foldAxis(q.y, uSheet.y, uFoCount.y, uFoOffset, uSeed + 42u, uFoStrength, uFoWidth, dd);
  }
  if (uCurl.x > 0.0) {
    int cb = int(uCurl.z), sb = int(uCurl.w);
    vec2 corners[4] = vec2[4](vec2(0.0), vec2(uSheet.x, 0.0), uSheet, vec2(0.0, uSheet.y));
    for (int i = 0; i < 4; i++) {
      if ((cb & (1 << i)) == 0) continue;
      float s = max(0.0, 1.0 - length(q - corners[i]) / uCurl.y);
      h += uCurl.x * s * s;
    }
    vec4 sd = vec4(q.y, uSheet.x - q.x, uSheet.y - q.y, q.x);
    for (int i = 0; i < 4; i++) {
      if ((sb & (1 << i)) == 0) continue;
      float s = max(0.0, 1.0 - sd[i] / uCurl.y);
      h += uCurl.x * s * s;
    }
  }
  if (uCockle.x > 0.0) h += uCockle.x * fbm(q / uCockle.y, BIG, 3, 0.5, uSeed + 51u);
  if (uBend.x != 0.0) {
    vec2 dir = vec2(cos(uBend.y), sin(uBend.y));
    float t = dot(q - uSheet * 0.5, dir) / (0.5 * length(uSheet));
    h += uBend.x * t * t;
  }
  return h;
}

float softShape(vec2 q, float blur) {
  vec2 s = shape(q);
  return smoothstep(-blur, blur, s.x);
}

float pattern(vec2 q) {
  float c = cos(uPatParam.y), s = sin(uPatParam.y);
  vec2 r = vec2(c * q.x + s * q.y, -s * q.x + c * q.y) / uPatParam.x;
  float w = uPatParam.z;
  if (uPattern == 1) return smoothstep(w + 0.03, w - 0.03, fract(r.x));
  if (uPattern == 2) return smoothstep(w * 0.5 + 0.04, w * 0.5 - 0.04, length(fract(r) - 0.5));
  if (uPattern == 3) {
    vec2 g = abs(fract(r) - 0.5);
    return smoothstep(0.5 - w * 0.2, 0.5 - w * 0.2 + 0.05, max(g.x, g.y));
  }
  if (uPattern == 4) return mod(floor(r.x) + floor(r.y), 2.0);
  return 0.0;
}

void main() {
  vec2 q = gl_FragCoord.xy - uMargin;
  vec2 sd = shape(q);
  float holeD = gHole;
  float aCore = clamp(sd.x + 0.5, 0.0, 1.0);
  float aRim = 0.0;
  if (sd.y > sd.x + 0.01 && sd.x < 1.0) {
    float fuzz = 0.45 + 0.55 * clamp(0.5 + 0.8 * gnoise(q * 0.8, BIG, uSeed + 71u), 0.0, 1.0);
    aRim = clamp(sd.y + 0.5, 0.0, 1.0) * fuzz;
    // stray fibres just past the rim
    if (sd.y < 0.0 && sd.y > -5.0) {
      float hair = smoothstep(0.55, 0.8, gnoise(q * vec2(0.45, 0.45), BIG, uSeed + 72u) + 0.5 * gnoise(q * 1.7, BIG, uSeed + 73u));
      aRim = max(aRim, hair * exp(sd.y / 1.6) * 0.8);
    }
  }
  float A = max(aCore, aRim) * uOpacity;

  vec3 col = vec3(0.0);
  if (A > 0.0 && uMode != 3) {
    ivec2 fi = imod2(ivec2(floor(q)), uFieldSize) + 1;
    vec4 f = texelFetch(uField, fi, 0);
    float hx = (texelFetch(uField, fi + ivec2(1, 0), 0).a - texelFetch(uField, fi - ivec2(1, 0), 0).a) * 0.5;
    float hy = (texelFetch(uField, fi + ivec2(0, 1), 0).a - texelFetch(uField, fi - ivec2(0, 1), 0).a) * 0.5;
    float Hx = (macroH(q + vec2(1.0, 0.0)) - macroH(q - vec2(1.0, 0.0))) * 0.5;
    float Hy = (macroH(q + vec2(0.0, 1.0)) - macroH(q - vec2(0.0, 1.0))) * 0.5;
    vec3 nm = normalize(vec3(-hx * uDepth, -hy * uDepth, 1.0));
    vec3 nf = normalize(vec3(-hx * uDepth - Hx, -hy * uDepth - Hy, 1.0));
    float sm = clamp(dot(nm, uLight) / uLight.z, 0.0, 3.0);
    float sf = clamp(dot(nf, uLight) / uLight.z, 0.0, 3.0);

    vec3 alb = f.rgb;
    if (uPattern > 0) alb = mix(alb, alb * uPatColor, pattern(q) * uPatParam.w);
    float inner = max(sd.x, 0.0);
    if (uAging > 0.0) alb *= mix(vec3(1.0), uAgeColor, uAging * exp(-inner / (0.18 * min(uSheet.x, uSheet.y))));
    if (uEdgeWear > 0.0) alb *= 1.0 - uEdgeWear * 0.2 * exp(-inner / 3.0);
    if (uFoWear > 0.0) {
      float wear = 0.0, dd;
      if (uFoCount.x > 0) { foldAxis(q.x, uSheet.x, uFoCount.x, uFoOffset, uSeed + 41u, uFoStrength, uFoWidth, dd); wear = max(wear, exp(-(dd / 1.3) * (dd / 1.3))); }
      if (uFoCount.y > 0) { foldAxis(q.y, uSheet.y, uFoCount.y, uFoOffset, uSeed + 42u, uFoStrength, uFoWidth, dd); wear = max(wear, exp(-(dd / 1.3) * (dd / 1.3))); }
      alb *= 1.0 - uFoWear * 0.22 * wear;
    }
    if (holeD < 4.0) alb *= 1.0 - 0.16 * exp(-max(holeD, 0.0) / 1.2);
    // torn fibres expose the paler core of the sheet
    vec3 rimCol = mix(alb, vec3(0.975, 0.97, 0.955), 0.55);
    alb = mix(rimCol, alb, aCore / max(max(aCore, aRim), 1e-4));

    vec3 refl = reflect(-uLight, nf);
    float spec = uGloss * pow(max(refl.z, 0.0), 24.0);

    if (uMode == 2) {
      float R = sf / max(sm, 1e-3);
      float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
      // shadows: exact multiply; highlights: screen, capped so ink on top never washes out
      float g = R <= 1.0 ? 0.5 * R : 0.5 + 0.5 * min(0.3, (R - 1.0) * lum / max(1.0 - lum, 0.06));
      g = min(1.0, g + 0.5 * spec);
      outColor = vec4(vec3(g), A);
      return;
    }
    col = alb * (uMode == 1 ? sm : sf) + (uMode == 1 ? 0.0 : spec);
  } else if (uMode == 2) {
    outColor = vec4(0.5, 0.5, 0.5, 0.0);
    return;
  }

  float sh = 0.0;
  if (uShadow.x > 0.0 && (uMode == 3 || uSeparateShadow == 0)) {
    float lift = uShadowLift * max(macroH(q), 0.0);
    float s1 = softShape(q - uShadow.zw * 0.3, 1.0 + 0.3 * lift);
    float s2 = softShape(q - uShadow.zw * (1.0 + lift), uShadow.y * (1.0 + 0.4 * lift));
    sh = 1.0 - (1.0 - 0.38 * s1) * (1.0 - 0.3 * s2);
    sh *= uShadow.x * mix(1.0, uOpacity, 0.6);
  }
  if (uMode == 3) {
    outColor = vec4(0.0, 0.0, 0.0, sh);
    return;
  }
  float outA = A + sh * (1.0 - A);
  outColor = vec4(outA > 0.0 ? clamp(col, 0.0, 1.0) * A / outA : vec3(0.0), outA);
}
`;
