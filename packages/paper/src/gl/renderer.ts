import type { OutputMode } from '../params';
import type { ResolvedPaper } from '../resolve';
import { COMPOSE_FS, FIELD_FS, VS } from './shaders';
import { SHEET_FS } from './sheet-shader';
import type { ResolvedSheet, SheetOutput } from '../sheet';

const MODE_INDEX: Record<OutputMode, number> = { color: 0, albedo: 1, overlay: 2, height: 3, normal: 4 };

const DISPLAY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec2 uView;     // canvas size in px
uniform vec2 uOffset;   // pan in texture px
uniform float uZoom;    // screen px per texture px
uniform bool uSeams;
out vec4 outColor;
void main() {
  vec2 s = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 t = (s - uView * 0.5) / uZoom + uOffset;
  vec2 w = mod(t, uTexSize);
  vec4 c = texelFetch(uTex, ivec2(w), 0);
  if (uSeams) {
    vec2 e = min(w, uTexSize - w) * uZoom;
    if (min(e.x, e.y) < 2.0) c.rgb = mix(c.rgb, vec3(1.0, 0.1, 0.4), 0.6);
  }
  outColor = c;
}
`;

export type GLCanvas = HTMLCanvasElement | OffscreenCanvas;

interface Prog {
  prog: WebGLProgram;
  loc: Map<string, WebGLUniformLocation | null>;
}

export interface PreviewView {
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  seams?: boolean;
}

/**
 * WebGL2 renderer. Reuse one instance for interactive editing; it keeps its
 * context, programs and textures alive between renders.
 */
export class GLPaperRenderer {
  readonly canvas: GLCanvas;
  readonly gl: WebGL2RenderingContext;
  readonly maxSize: number;
  private fieldProg: Prog;
  private composeProg: Prog;
  private displayProg: Prog;
  private sheetProg: Prog | null = null;
  private vao: WebGLVertexArrayObject;
  private fieldFormat: { internal: number; type: number };
  private fieldTex: WebGLTexture | null = null;
  private fieldSize = [0, 0];
  private outTex: WebGLTexture | null = null;
  private outSize = [0, 0];
  private fbo: WebGLFramebuffer;
  /** Size of the texture produced by the last renderToTexture(). */
  lastSize: [number, number] = [0, 0];

  static isSupported(): boolean {
    try {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
      return !!gl && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    } catch {
      return false;
    }
  }

  constructor(canvas?: GLCanvas) {
    this.canvas =
      canvas ?? (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'));
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('procedural-paper: WebGL2 is not available');
    this.gl = gl;
    if (gl.getExtension('EXT_color_buffer_float')) {
      this.fieldFormat = { internal: gl.RGBA32F, type: gl.FLOAT };
    } else if (gl.getExtension('EXT_color_buffer_half_float')) {
      this.fieldFormat = { internal: gl.RGBA16F, type: gl.HALF_FLOAT };
    } else {
      throw new Error('procedural-paper: float render targets are not supported');
    }
    this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    this.fieldProg = this.program(FIELD_FS);
    this.composeProg = this.program(COMPOSE_FS);
    this.displayProg = this.program(DISPLAY_FS);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const p of [this.fieldProg, this.composeProg, this.displayProg]) {
      const loc = gl.getAttribLocation(p.prog, 'aPos');
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    this.fbo = gl.createFramebuffer()!;
  }

  private program(fs: string): Prog {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('procedural-paper shader error: ' + gl.getShaderInfoLog(s));
      }
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('procedural-paper link error: ' + gl.getProgramInfoLog(prog));
    }
    return { prog, loc: new Map() };
  }

  private u(p: Prog, name: string) {
    let l = p.loc.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(p.prog, name);
      p.loc.set(name, l);
    }
    return l;
  }

  private ensureTex(which: 'field' | 'out', w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const cur = which === 'field' ? this.fieldTex : this.outTex;
    const size = which === 'field' ? this.fieldSize : this.outSize;
    if (cur && size[0] === w && size[1] === h) return cur;
    if (cur) gl.deleteTexture(cur);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (which === 'field') {
      gl.texStorage2D(gl.TEXTURE_2D, 1, this.fieldFormat.internal, w, h);
    } else {
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (which === 'field') {
      this.fieldTex = t;
      this.fieldSize = [w, h];
    } else {
      this.outTex = t;
      this.outSize = [w, h];
    }
    return t;
  }

  private setFieldUniforms(r: ResolvedPaper) {
    const gl = this.gl;
    const p = this.fieldProg;
    const f1 = (n: string, v: number) => gl.uniform1f(this.u(p, n), v);
    const i1 = (n: string, v: number) => gl.uniform1i(this.u(p, n), v);
    const ui = (n: string, v: number) => gl.uniform1ui(this.u(p, n), v >>> 0);
    const i2 = (n: string, v: [number, number]) => gl.uniform2i(this.u(p, n), v[0], v[1]);
    const f2 = (n: string, v: [number, number]) => gl.uniform2f(this.u(p, n), v[0], v[1]);
    const f3 = (n: string, v: [number, number, number]) => gl.uniform3f(this.u(p, n), v[0], v[1], v[2]);

    i2('uSize', [r.width, r.height]);
    f3('uBase', r.base);
    f3('uTint', r.tint);
    f1('uTintAmount', r.tintAmount);
    f1('uVariation', r.variation);
    f1('uGrainTone', r.grainTone);

    ui('uMoSeed', r.mottle.seed);
    ui('uMoTintSeed', r.mottle.tintSeed);
    ui('uMoWarpSeed', r.mottle.warpSeed);
    i2('uMoPer', r.mottle.per);
    i1('uMoOct', r.mottle.octaves);
    f1('uMoWarp', r.mottle.warp);
    f1('uMoRelief', r.mottle.relief);

    ui('uGrSeed', r.grain.seed);
    i2('uGrPer', r.grain.per);
    i1('uGrOct', r.grain.octaves);
    f1('uGrRough', r.grain.roughness);
    f1('uGrStrength', r.grain.strength);

    ui('uCeSeed', r.cells.seed);
    ui('uCeWarpSeed', r.cells.warpSeed);
    i2('uCePer', r.cells.per);
    f1('uCeStrength', r.cells.strength);
    f1('uCeRidge', r.cells.ridge);
    f1('uCeWarp', r.cells.warp);

    ui('uSkSeed', r.streaks.seed);
    i2('uSkPer', r.streaks.per);
    i1('uSkOct', r.streaks.octaves);
    f1('uSkStrength', r.streaks.strength);

    i1('uStType', r.structure.type);
    ui('uStSeed', r.structure.seed);
    i2('uStPer', r.structure.per);
    f1('uStStrength', r.structure.strength);
    f1('uStSharp', r.structure.sharpness);
    f1('uStWarp', r.structure.warp);
    i1('uStVertical', r.structure.vertical ? 1 : 0);

    const fb = r.fibers;
    ui('uFbSeed', fb.seed);
    i2('uFbPer', fb.per);
    f2('uFbCell', fb.cell);
    f1('uFbCount', fb.count);
    f1('uFbLength', fb.length);
    f1('uFbWidth', fb.width);
    f1('uFbCurl', fb.curl);
    f1('uFbDarkRatio', fb.darkRatio);
    f1('uFbOpacity', fb.opacity);
    f1('uFbRelief', fb.relief);
    f3('uFbDark', fb.dark);
    f3('uFbLight', fb.light);

    const sp = r.specks;
    ui('uSpSeed', sp.seed);
    i2('uSpPer', sp.per);
    f2('uSpCell', sp.cell);
    f1('uSpCount', sp.count);
    f1('uSpMin', sp.sizeMin);
    f1('uSpMax', sp.sizeMax);
    f1('uSpElong', sp.elongation);
    f1('uSpOpacity', sp.opacity);
    f1('uSpRelief', sp.relief);
    f3('uSpC0', sp.colors[0]);
    f3('uSpC1', sp.colors[1]);
    f3('uSpC2', sp.colors[2]);

    const cr = r.crumples;
    ui('uCrSeed', cr.seed);
    ui('uCrWarpSeed', cr.warpSeed);
    i2('uCrPer', cr.per);
    i2('uCrWPer', cr.wPer);
    f1('uCrAmp', cr.amp);
    f1('uCrWAmp', cr.wAmp);
    f1('uCrWarp', cr.warp);

    const fo = r.folds;
    ui('uFoSeed', fo.seed);
    i2('uFoCount', fo.count);
    f1('uFoOffset', fo.offset);
    f1('uFoStrength', fo.strength);
    f1('uFoWidth', fo.width);
    f1('uFoWear', fo.wear);

    const sn = r.stains;
    ui('uSnSeed', sn.seed);
    i2('uSnPer', sn.per);
    f2('uSnCell', sn.cell);
    f1('uSnDensity', sn.density);
    f1('uSnSize', sn.size);
    f1('uSnStrength', sn.strength);
    f1('uSnRing', sn.ring);
    f3('uSnColor', sn.color);
  }

  private setComposeUniforms(r: ResolvedPaper, mode: OutputMode) {
    const gl = this.gl;
    const p = this.composeProg;
    gl.uniform1i(this.u(p, 'uField'), 0);
    gl.uniform1i(this.u(p, 'uMode'), MODE_INDEX[mode]);
    gl.uniform3f(this.u(p, 'uLight'), r.light.dir[0], r.light.dir[1], r.light.dir[2]);
    gl.uniform1f(this.u(p, 'uDepth'), r.light.depth);
    gl.uniform1f(this.u(p, 'uBaseLum'), r.baseLum);
    gl.uniform1f(this.u(p, 'uHeightNorm'), r.heightNorm);
    gl.uniform1f(this.u(p, 'uBrightness'), r.output.brightness);
    gl.uniform1f(this.u(p, 'uContrast'), r.output.contrast);
    gl.uniform1i(this.u(p, 'uFlipY'), r.output.flipY ? 1 : 0);
    gl.uniform1i(this.u(p, 'uFlipOut'), 0);
  }

  /** Render the 1px-padded field for the chunk at (ox, oy) of size (w, h). */
  private renderField(r: ResolvedPaper, ox: number, oy: number, w: number, h: number) {
    const gl = this.gl;
    const tex = this.ensureTex('field', w + 2, h + 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w + 2, h + 2);
    gl.useProgram(this.fieldProg.prog);
    this.setFieldUniforms(r);
    gl.uniform2i(this.u(this.fieldProg, 'uOrigin'), ox - 1, oy - 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private composeInto(r: ResolvedPaper, mode: OutputMode, w: number, h: number) {
    const gl = this.gl;
    gl.useProgram(this.composeProg.prog);
    this.setComposeUniforms(r, mode);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Render the requested maps to RGBA8 pixel buffers (rows top to bottom).
   * Large tiles are rendered in chunks, so sizes beyond MAX_TEXTURE_SIZE work.
   */
  render(r: ResolvedPaper, outputs: OutputMode[], chunk = 1024): Record<string, Uint8ClampedArray> {
    const gl = this.gl;
    const W = r.width;
    const H = r.height;
    const cs = Math.max(64, Math.min(chunk, this.maxSize - 2));
    const res: Record<string, Uint8ClampedArray> = {};
    for (const m of outputs) res[m] = new Uint8ClampedArray(W * H * 4);
    const buf = new Uint8Array(cs * cs * 4);
    for (let oy = 0; oy < H; oy += cs) {
      for (let ox = 0; ox < W; ox += cs) {
        const w = Math.min(cs, W - ox);
        const h = Math.min(cs, H - oy);
        this.renderField(r, ox, oy, w, h);
        const out = this.ensureTex('out', cs, cs);
        for (const m of outputs) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
          this.composeInto(r, m, w, h);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          const dst = res[m];
          for (let y = 0; y < h; y++) {
            dst.set(buf.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * W + ox) * 4);
          }
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return res;
  }

  /**
   * Render one map into an internal GPU texture (no readback). Used for live
   * previews together with drawPreview(). Size must fit MAX_TEXTURE_SIZE.
   */
  renderToTexture(r: ResolvedPaper, mode: OutputMode): WebGLTexture {
    const gl = this.gl;
    const W = Math.min(r.width, this.maxSize - 2);
    const H = Math.min(r.height, this.maxSize - 2);
    this.renderField(r, 0, 0, W, H);
    // Use a dedicated texture sized exactly to the tile so the display pass can wrap.
    const out = this.ensureTex('out', W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    this.composeInto(r, mode, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastSize = [W, H];
    return out;
  }

  /**
   * Render a finite sheet (see sheet.ts): the paper field at the sheet's size,
   * then the outline / relief / shadow pass. Returns RGBA8 buffers (straight
   * alpha, rows top to bottom) of size (width + 2 margin) x (height + 2 margin).
   */
  renderSheet(r: ResolvedPaper, s: ResolvedSheet, outputs: SheetOutput[]): Record<string, Uint8ClampedArray> {
    const gl = this.gl;
    const W = s.width + 2 * s.margin;
    const H = s.height + 2 * s.margin;
    if (W > this.maxSize || H > this.maxSize) throw new Error('procedural-paper: sheet larger than MAX_TEXTURE_SIZE');
    this.renderField(r, 0, 0, r.width, r.height);
    if (!this.sheetProg) {
      this.sheetProg = this.program(SHEET_FS);
      const loc = gl.getAttribLocation(this.sheetProg.prog, 'aPos');
      gl.bindVertexArray(this.vao);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
    }
    const p = this.sheetProg;
    const out = this.ensureTex('out', W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.viewport(0, 0, W, H);
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    const u = (n: string) => this.u(p, n);
    gl.uniform1i(u('uField'), 0);
    gl.uniform2i(u('uFieldSize'), r.width, r.height);
    gl.uniform2f(u('uSheet'), s.width, s.height);
    gl.uniform1f(u('uMargin'), s.margin);
    gl.uniform3f(u('uLight'), r.light.dir[0], r.light.dir[1], r.light.dir[2]);
    gl.uniform1f(u('uDepth'), r.light.depth);
    gl.uniform1ui(u('uSeed'), s.seed >>> 0);
    gl.uniform1f(u('uRadius'), s.radius);
    gl.uniform1f(u('uChamfer'), s.chamfer);
    gl.uniform1f(u('uRim'), s.rim);
    gl.uniform4i(u('uEdgeKind'), ...s.edgeKind);
    gl.uniform4f(u('uEdgeAmt'), ...s.edgeAmt);
    gl.uniform4f(u('uEdgeScale'), ...s.edgeScale);
    gl.uniform1i(u('uHoleCount'), s.holes.length);
    if (s.holes.length) gl.uniform4fv(u('uHoles'), s.holes.flat());
    gl.uniform1i(u('uRowCount'), s.rowA.length);
    if (s.rowA.length) {
      gl.uniform4fv(u('uRowA'), s.rowA.flat());
      gl.uniform4fv(u('uRowB'), s.rowB.flat());
    }
    gl.uniform2f(u('uCrumples'), ...s.crumples);
    gl.uniform2f(u('uWrinkles'), ...s.wrinkles);
    gl.uniform2i(u('uFoCount'), ...s.folds.count);
    gl.uniform1f(u('uFoStrength'), s.folds.strength);
    gl.uniform1f(u('uFoOffset'), s.folds.offset);
    gl.uniform1f(u('uFoWidth'), s.folds.width);
    gl.uniform1f(u('uFoWear'), s.folds.wear);
    gl.uniform4f(u('uCurl'), ...s.curl);
    gl.uniform2f(u('uCockle'), ...s.cockle);
    gl.uniform2f(u('uBend'), ...s.bend);
    gl.uniform1f(u('uOpacity'), s.opacity);
    gl.uniform1f(u('uGloss'), s.gloss);
    gl.uniform1f(u('uEdgeWear'), s.edgeWear);
    gl.uniform1f(u('uAging'), s.aging);
    gl.uniform3f(u('uAgeColor'), ...s.agingColor);
    gl.uniform1i(u('uPattern'), s.pattern.kind);
    gl.uniform3f(u('uPatColor'), ...s.pattern.color);
    gl.uniform4f(u('uPatParam'), ...s.pattern.params);
    gl.uniform4f(u('uShadow'), ...s.shadow);
    gl.uniform1f(u('uShadowLift'), s.shadowLift);
    gl.bindVertexArray(this.vao);

    const res: Record<string, Uint8ClampedArray> = {};
    const MODES: Record<SheetOutput, number> = { color: 0, base: 1, shade: 2, shadow: 3 };
    gl.uniform1i(u('uSeparateShadow'), outputs.includes('shadow') ? 1 : 0);
    for (const m of outputs) {
      gl.uniform1i(u('uMode'), MODES[m]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const buf = new Uint8ClampedArray(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      res[m] = buf;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return res;
  }

  /** Draw the last renderToTexture() result to the canvas, tiled infinitely. */
  drawPreview(view: PreviewView = {}) {
    const gl = this.gl;
    if (!this.outTex) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    const p = this.displayProg;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.outTex);
    gl.uniform1i(this.u(p, 'uTex'), 0);
    gl.uniform2f(this.u(p, 'uTexSize'), this.lastSize[0], this.lastSize[1]);
    gl.uniform2f(this.u(p, 'uView'), cw, ch);
    gl.uniform2f(this.u(p, 'uOffset'), view.offsetX ?? this.lastSize[0] / 2, view.offsetY ?? this.lastSize[1] / 2);
    gl.uniform1f(this.u(p, 'uZoom'), view.zoom ?? 1);
    gl.uniform1i(this.u(p, 'uSeams'), view.seams ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    if (this.fieldTex) gl.deleteTexture(this.fieldTex);
    if (this.outTex) gl.deleteTexture(this.outTex);
    gl.deleteFramebuffer(this.fbo);
    for (const p of [this.fieldProg, this.composeProg, this.displayProg, this.sheetProg]) if (p) gl.deleteProgram(p.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
