import { publishState, shareURL } from '../bridge';
import './style.css';
import {
  PaperRenderer,
  buildParams,
  encodePNG,
  getParam,
  paramSchema,
  presets,
  renderCPU,
  resolveParams,
  setParam,
  type OutputMode,
  type PaperFamily,
  type PaperParams,
  type ParamField,
} from 'procedural-paper';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------------- state ---------------- */

const MODES: { id: OutputMode; label: string }[] = [
  { id: 'color', label: 'Color' },
  { id: 'albedo', label: 'Albedo' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'height', label: 'Height' },
  { id: 'normal', label: 'Normal' },
];
const SIZES = [256, 512, 1024, 2048, 4096];
const FAMILY_LABEL: Record<PaperFamily, string> = {
  drawing: 'Drawing',
  construction: 'Construction',
  pastel: 'Pastel',
  handmade: 'Handmade',
  watercolor: 'Watercolor',
  craft: 'Craft & Cardboard',
};

const state = {
  presetId: 'watercolor-cold-press',
  params: buildParams('watercolor-cold-press'),
  width: 1024,
  height: 1024,
  mode: 'color' as OutputMode,
  zoom: 1,
  offsetX: 512,
  offsetY: 512,
  seams: false,
  blend: false,
  exportMaps: new Set<OutputMode>(['color']),
};

/* ---------------- URL hash ---------------- */

function diff(a: any, b: any): any {
  const out: any = {};
  for (const k of Object.keys(a)) {
    if (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) {
      const d = diff(a[k], b[k]);
      if (Object.keys(d).length) out[k] = d;
    } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = a[k];
  }
  return out;
}

function writeHash() {
  const d = diff(state.params, buildParams(state.presetId));
  const payload = { p: state.presetId, w: state.width, h: state.height, ...(Object.keys(d).length ? { o: d } : {}), view: { mode: state.mode, seams: state.seams, blend: state.blend, zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY, exportMaps: [...state.exportMaps] } };
  history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(payload)));
  publishState();
}

function readHash() {
  if (location.hash.length < 2) return;
  try {
    const v = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (v.p && presets.some((p) => p.id === v.p)) state.presetId = v.p;
    state.params = buildParams(state.presetId, v.o);
    if (v.w) state.width = v.w;
    if (v.h) state.height = v.h;
    state.offsetX = state.width / 2; state.offsetY = state.height / 2;
    if (v.view) {
      if (MODES.some(m => m.id === v.view.mode)) state.mode = v.view.mode;
      state.seams = v.view.seams === true; state.blend = v.view.blend === true;
      for (const key of ['zoom', 'offsetX', 'offsetY'] as const) if (Number.isFinite(v.view[key])) state[key] = v.view[key];
      if (Array.isArray(v.view.exportMaps)) {
        const maps = v.view.exportMaps.filter((id: OutputMode) => MODES.some(m => m.id === id));
        if (maps.length) state.exportMaps = new Set(maps);
      }
    }
  } catch {
    /* ignore malformed hash */
  }
}

/* ---------------- renderer ---------------- */

const canvas = $<HTMLCanvasElement>('gl');
const viewport = $<HTMLDivElement>('viewport');
let renderer: PaperRenderer;
try {
  renderer = new PaperRenderer({ backend: 'webgl2', canvas });
} catch (e) {
  viewport.innerHTML = `<p style="padding:24px;color:#e88">WebGL2 with float render targets is required for the live preview. (${(e as Error).message})</p>`;
  throw e;
}

let textureDirty = true;
let frameQueued = false;
let lastMs = 0;

function requestFrame(dirty = false) {
  textureDirty ||= dirty;
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(frame);
}

function frame() {
  writeHash();
  frameQueued = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(viewport.clientWidth * dpr);
  const ch = Math.round(viewport.clientHeight * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const gl = renderer.gl!;
  if (textureDirty) {
    const t0 = performance.now();
    gl.renderToTexture(resolveParams(state.params, state.width, state.height), state.mode);
    gl.gl.finish();
    lastMs = performance.now() - t0;
    textureDirty = false;
  }
  gl.drawPreview({ zoom: state.zoom * dpr, offsetX: state.offsetX, offsetY: state.offsetY, seams: state.seams });
  $('stat').textContent = `${state.width}×${state.height} · ${lastMs.toFixed(1)} ms · ${Math.round(state.zoom * 100)}%`;
}

new ResizeObserver(() => requestFrame()).observe(viewport);

/* ---------------- pan / zoom ---------------- */

let drag: { x: number; y: number; ox: number; oy: number } | null = null;
viewport.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, ox: state.offsetX, oy: state.offsetY };
  viewport.setPointerCapture(e.pointerId);
  viewport.classList.add('drag');
});
viewport.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.offsetX = drag.ox - (e.clientX - drag.x) / state.zoom;
  state.offsetY = drag.oy - (e.clientY - drag.y) / state.zoom;
  requestFrame();
});
const endDrag = () => {
  drag = null;
  viewport.classList.remove('drag');
};
viewport.addEventListener('pointerup', endDrag);
viewport.addEventListener('pointercancel', endDrag);
viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const mx = e.clientX - r.left - r.width / 2;
    const my = e.clientY - r.top - r.height / 2;
    const before = { x: state.offsetX + mx / state.zoom, y: state.offsetY + my / state.zoom };
    state.zoom = Math.min(16, Math.max(0.05, state.zoom * Math.exp(-e.deltaY * 0.0015)));
    state.offsetX = before.x - mx / state.zoom;
    state.offsetY = before.y - my / state.zoom;
    requestFrame();
  },
  { passive: false },
);
viewport.addEventListener('dblclick', () => {
  state.zoom = 1;
  state.offsetX = state.width / 2;
  state.offsetY = state.height / 2;
  requestFrame();
});

/* ---------------- left panel ---------------- */

const wInput = $<HTMLInputElement>('w');
const hInput = $<HTMLInputElement>('h');
const seedInput = $<HTMLInputElement>('seed');

function setSize(w: number, h: number) {
  state.width = Math.max(16, Math.min(16384, Math.round(w) || 16));
  state.height = Math.max(16, Math.min(16384, Math.round(h) || 16));
  wInput.value = String(state.width);
  hInput.value = String(state.height);
  renderSizeChips();
  writeHash();
  requestFrame(true);
}
wInput.addEventListener('change', () => setSize(+wInput.value, +hInput.value));
hInput.addEventListener('change', () => setSize(+wInput.value, +hInput.value));

function renderSizeChips() {
  const el = $('sizes');
  el.innerHTML = '';
  for (const s of SIZES) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.width === s && state.height === s ? ' on' : '');
    b.textContent = s >= 1024 ? `${s / 1024}K` : String(s);
    b.onclick = () => setSize(s, s);
    el.append(b);
  }
}

seedInput.addEventListener('input', () => update('seed', Math.max(0, Math.round(+seedInput.value || 0))));
$('dice').onclick = () => {
  const s = Math.floor(Math.random() * 100000);
  seedInput.value = String(s);
  update('seed', s);
};

function renderPresets() {
  const root = $('presets');
  root.innerHTML = '';
  const families = [...new Set(presets.map((p) => p.family))];
  for (const fam of families) {
    const t = document.createElement('div');
    t.className = 'family';
    t.textContent = FAMILY_LABEL[fam];
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const p of presets.filter((x) => x.family === fam)) {
      const b = document.createElement('button');
      b.className = 'swatch' + (p.id === state.presetId ? ' on' : '');
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.style.background = p.params.color.base;
      b.onclick = () => {
        const seed = state.params.seed;
        state.presetId = p.id;
        state.params = { ...buildParams(p.id), seed };
        renderPresets();
        renderControls();
        writeHash();
        requestFrame(true);
      };
      grid.append(b);
    }
    root.append(t, grid);
  }
  const cur = document.createElement('div');
  cur.className = 'current';
  cur.textContent = presets.find((p) => p.id === state.presetId)?.name ?? '';
  root.append(cur);
}

/* ---------------- toolbar ---------------- */

function renderModes() {
  const el = $('modes');
  el.innerHTML = '';
  for (const m of MODES) {
    const b = document.createElement('button');
    b.textContent = m.label;
    b.className = m.id === state.mode ? 'on' : '';
    b.onclick = () => {
      state.mode = m.id;
      renderModes();
      requestFrame(true);
    };
    el.append(b);
  }
}

$<HTMLInputElement>('seams').addEventListener('change', (e) => {
  state.seams = (e.target as HTMLInputElement).checked;
  requestFrame();
});
const blendColor = $<HTMLInputElement>('blendColor');
const syncBlend = () => {
  viewport.classList.toggle('blend', state.blend);
  $('blendbg').style.background = blendColor.value;
};
$<HTMLInputElement>('blend').addEventListener('change', (e) => {
  state.blend = (e.target as HTMLInputElement).checked;
  if (state.blend && state.mode !== 'overlay') {
    state.mode = 'overlay';
    renderModes();
    requestFrame(true);
  }
  syncBlend();
});
blendColor.addEventListener('input', syncBlend);

/* ---------------- parameter controls ---------------- */

const fieldPath = (group: string, f: ParamField) => (group ? `${group}.${f.key}` : f.key);
const openGroups = new Set(['color', 'grain', 'fibers', 'specks']);

function update(path: string, value: unknown) {
  state.params = setParam(state.params, path, value);
  if (path === 'seed') seedInput.value = String(value);
  writeHash();
  requestFrame(true);
}

function decimals(step: number) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function renderControls() {
  const root = $('controls');
  root.innerHTML = '';
  for (const g of paramSchema) {
    if (!g.key) continue; // seed/scale handled separately below
    root.append(groupEl(g.label, g.key, g.fields));
  }
  // scale lives in "General"
  const general = paramSchema.find((g) => g.key === '')!;
  root.prepend(groupEl('General', '', general.fields.filter((f) => f.key !== 'seed')));
  seedInput.value = String(state.params.seed);
}

function groupEl(label: string, key: string, fields: ParamField[]) {
  const d = document.createElement('details');
  d.className = 'group';
  d.open = openGroups.has(key) || key === '';
  d.addEventListener('toggle', () => (d.open ? openGroups.add(key) : openGroups.delete(key)));
  const s = document.createElement('summary');
  s.textContent = label;
  const box = document.createElement('div');
  box.className = 'fields';
  for (const f of fields) box.append(fieldEl(key, f));
  d.append(s, box);
  return d;
}

function fieldEl(group: string, f: ParamField): HTMLElement {
  const path = fieldPath(group, f);
  const val = getParam(state.params, path);
  const row = document.createElement('label');
  row.className = 'field';
  const name = document.createElement('span');
  name.textContent = f.label;
  row.append(name);

  if (f.type === 'number') {
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(f.min);
    range.max = String(f.max);
    range.step = String(f.step);
    range.value = String(val);
    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'num';
    num.step = String(f.step);
    const dp = decimals(f.step);
    num.value = Number(val).toFixed(dp);
    range.oninput = () => {
      num.value = Number(range.value).toFixed(dp);
      update(path, +range.value);
    };
    num.onchange = () => {
      range.value = num.value;
      update(path, +num.value);
    };
    row.append(range, num);
  } else if (f.type === 'color') {
    row.classList.add('color');
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = String(val);
    const hex = document.createElement('span');
    hex.className = 'hex';
    hex.textContent = String(val);
    inp.oninput = () => {
      hex.textContent = inp.value;
      update(path, inp.value);
    };
    row.append(inp, hex);
  } else if (f.type === 'select') {
    const sel = document.createElement('select');
    for (const o of f.options) sel.append(new Option(o, o, false, o === val));
    sel.onchange = () => update(path, sel.value);
    row.append(sel);
  } else {
    row.classList.add('bool');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(val);
    cb.onchange = () => update(path, cb.checked);
    row.append(cb);
  }
  return row;
}

/* ---------------- export ---------------- */

function renderExportChips() {
  const el = $('exportMaps');
  el.innerHTML = '';
  for (const m of MODES) {
    const b = document.createElement('button');
    b.className = 'chip' + (state.exportMaps.has(m.id) ? ' on' : '');
    b.textContent = m.label;
    b.onclick = () => {
      if (state.exportMaps.has(m.id)) {
        if (state.exportMaps.size > 1) state.exportMaps.delete(m.id);
      } else state.exportMaps.add(m.id);
      writeHash();
      renderExportChips();
    };
    el.append(b);
  }
}

function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout((toast as any).timer);
  (toast as any).timer = setTimeout(() => t.classList.remove('show'), 1600);
}

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('download').onclick = async () => {
  const btn = $<HTMLButtonElement>('download');
  btn.disabled = true;
  btn.textContent = 'Rendering…';
  await new Promise((r) => setTimeout(r, 20));
  try {
    const maps = [...state.exportMaps];
    const t0 = performance.now();
    const res = renderer.render(state.params, state.width, state.height, maps);
    const ms = performance.now() - t0;
    for (const m of maps) {
      const png = await encodePNG(res.maps[m]!, { grayscale: m === 'height' || m === 'overlay' });
      download(png, `paper-${state.presetId}-${state.params.seed}-${state.width}x${state.height}-${m}.png`);
    }
    toast(`Rendered ${maps.length} map${maps.length > 1 ? 's' : ''} in ${ms.toFixed(0)} ms`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download PNG';
    requestFrame(true); // export reuses GPU textures
  }
};

$('copyJson').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(state.params, null, 2));
  toast('Params copied');
};
$('copyCode').onclick = async () => {
  const o = diff(state.params, buildParams(state.presetId));
  const code = `import { generatePaper, toBlob } from 'procedural-paper';

const paper = await generatePaper({
  preset: '${state.presetId}',
  width: ${state.width},
  height: ${state.height},${Object.keys(o).length ? `\n  params: ${JSON.stringify(o, null, 2).replace(/\n/g, '\n  ')},` : ''}
  outputs: ['color', 'normal'],
});
const url = URL.createObjectURL(await toBlob(paper.maps.color!));
document.body.style.background = \`url(\${url}) repeat\`;
`;
  await navigator.clipboard.writeText(code);
  toast('Code copied');
};
$('copyLink').onclick = async () => {
  writeHash();
  await navigator.clipboard.writeText(shareURL());
  toast('Link copied');
};

/* ---------------- debug: GPU/CPU parity ---------------- */

$('parity').onclick = () => {
  const out = $('parityOut');
  const lines: string[] = [];
  const modes: OutputMode[] = ['color', 'height', 'normal'];
  const r = resolveParams(state.params, 256, 256);
  const gpu = renderer.gl!.render(r, modes);
  const cpu = renderCPU(r, modes);
  for (const m of modes) {
    let sum = 0;
    let max = 0;
    let over = 0;
    const a = gpu[m];
    const b = cpu[m];
    for (let i = 0; i < a.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a[i + c] - b[i + c]);
        sum += d;
        if (d > max) max = d;
        if (d > 2) over++;
      }
    }
    lines.push(`${m.padEnd(7)} mean ${(sum / ((a.length / 4) * 3)).toFixed(3)}  max ${max}  >2: ${((over / ((a.length / 4) * 3)) * 100).toFixed(2)}%`);
  }
  out.textContent = lines.join('\n');
  (window as any).__parity = lines;
  requestFrame(true);
};

/* ---------------- boot ---------------- */

readHash();
$<HTMLInputElement>('seams').checked = state.seams;
$<HTMLInputElement>('blend').checked = state.blend;
syncBlend();
wInput.value = String(state.width);
hInput.value = String(state.height);
renderSizeChips();
renderPresets();
renderModes();
renderControls();
renderExportChips();
requestFrame(true);

// handy for console tinkering
(window as any).paper = { state, renderer, update, presets };
export type { PaperParams };

$('downloadJson').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ preset: state.presetId, width: state.width, height: state.height, params: state.params, outputs: [...state.exportMaps] }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${state.presetId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
