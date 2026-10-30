/**
 * Debug timeline for the pickup motion. Records every engine frame of every
 * interaction (peel.ts `onSample`), plots the channels against time with the
 * state as coloured bands, and scrubs: dragging the playhead shows the card
 * exactly as it was at that frame. Canned gestures replay the same pointer
 * path on any card so holders and paper types can be compared, and a time
 * scale slows the physics down. Toggle with T or #dbg=1.
 */
import type { Body, Kind, Peel, Sample, State } from './peel';

export interface Recording {
  id: number;
  b: Body;
  label: string;
  kind: Kind;
  samples: Sample[];
}

interface Channel {
  key: keyof Sample | 'speed' | 'drot';
  label: string;
  color: string;
  /** Value range mapped to the plot height. */
  range: [number, number];
  get(s: Sample, first: Sample): number;
}

const CHANNELS: Channel[] = [
  { key: 'lift', label: 'lift', color: '#f0c75e', range: [-0.1, 1.1], get: (s) => s.lift },
  { key: 'peel', label: 'curl', color: '#e98b9a', range: [-0.1, 1.1], get: (s) => s.peel },
  { key: 'tiltX', label: 'tiltX°', color: '#8fc3e0', range: [-18, 18], get: (s) => s.tiltX },
  { key: 'tiltY', label: 'tiltY°', color: '#a9d3b0', range: [-18, 18], get: (s) => s.tiltY },
  { key: 'speed', label: 'pointer px/s', color: '#c7b3e3', range: [0, 2500], get: (s) => Math.hypot(s.pvx, s.pvy) },
  { key: 'drot', label: 'Δrot°', color: '#f3b48b', range: [-60, 60], get: (s, f) => s.rot - f.rot },
  { key: 'tape', label: 'tape', color: '#d8d0c4', range: [0.8, 1.3], get: (s) => s.tape },
];

const STATE_COLOR: Record<State, string> = { pressed: '#3a3a3a', held: '#5a4a2a', carry: '#2a4a5a', free: '#2a5a3a', falling: '#5a2a3a' };

/** Pointer paths: [dx, dy, ms] steps from a grab point (fractions of the card). */
export interface Gesture {
  id: string;
  label: string;
  grab: [number, number];
  path: [number, number, number][];
  /** Pause before release (ms). */
  hold?: number;
}

export const GESTURES: Gesture[] = [
  { id: 'corner', label: 'Corner peel, then carry', grab: [0.92, 0.9], path: [[16, 20, 500], [0, 0, 300], [90, 60, 500]] },
  { id: 'corner-slow', label: 'Corner peel, slow', grab: [0.92, 0.9], path: [[16, 20, 1500], [0, 0, 400], [60, 40, 1200]] },
  { id: 'corner-back', label: 'Corner peel and put back', grab: [0.92, 0.9], path: [[18, 22, 600], [-18, -22, 600]] },
  { id: 'bottom', label: 'Pull bottom edge down', grab: [0.5, 0.92], path: [[0, 40, 600], [0, 0, 300], [0, 80, 500]] },
  { id: 'carry', label: 'Carry and drop', grab: [0.5, 0.5], path: [[200, 80, 700]] },
  { id: 'flick', label: 'Flick', grab: [0.5, 0.5], path: [[0, 30, 250], [180, 40, 90]] },
  { id: 'wiggle', label: 'Wiggle', grab: [0.5, 0.5], path: [[80, 0, 180], [-80, 0, 180], [80, 0, 180], [-80, 0, 180]] },
  { id: 'side', label: 'Pull sideways (pivot / swing)', grab: [0.5, 0.9], path: [[50, 10, 500], [0, 0, 300], [40, 60, 500]] },
];

export interface TimelineOptions {
  peel: Peel;
  desk: HTMLElement;
  selected(): Body | null;
  describe(b: Body): string;
  /** Content motion of every card: scrub it, replay it. */
  motion?: { seek(p: number): void; replay(): void };
}

export interface Timeline {
  record(b: Body, s: Sample, kind: Kind): void;
  toggle(force?: boolean): void;
  readonly open: boolean;
  /** Newest first. */
  recordings(): Recording[];
  /** Run a canned gesture on a body (resolves when the pointer is released). */
  run(b: Body, gestureId: string): Promise<void>;
}

export function createTimeline(opts: TimelineOptions): Timeline {
  const { peel, desk } = opts;
  const recs: Recording[] = [];
  let cur: Recording | null = null;
  let nextId = 1;
  let shown: Recording | null = null;
  let head = 0; // sample index
  let replaying: Body | null = null;
  let playing = 0;
  let hover: number | null = null;

  // ------------------------------------------------------------ dom
  const root = document.createElement('div');
  root.className = 'tl';
  root.hidden = true;
  root.innerHTML = `
    <div class="tl-side">
      <div class="tl-head"><b>Motion timeline</b><span class="tl-dim">T to hide</span></div>
      <div class="tl-list"></div>
    </div>
    <div class="tl-main">
      <div class="tl-bar">
        <button data-act="play" title="Replay the recording at the current time scale">Play</button>
        <button data-act="stop" title="Put the card back">Stop</button>
        <label>Time scale <input type="range" min="0.1" max="1" step="0.1" value="1" data-act="scale" /><output>1.0×</output></label>
        <label>Gesture <select data-act="gesture"></select></label>
        <button data-act="run" title="Run the gesture on the selected card (click a card first)">Run on selected</button>
        <button data-act="clear">Clear</button>
        <label>Motion <input type="range" min="0" max="1" step="0.002" value="1" data-act="motion" title="Scrub every card's content motion" /><output>1.00</output></label>
        <button data-act="replay" title="Replay every card's content motion (M)">Replay motion</button>
        <span class="tl-readout"></span>
      </div>
      <canvas class="tl-plot"></canvas>
      <div class="tl-legend"></div>
    </div>`;
  document.body.appendChild(root);
  const list = root.querySelector<HTMLElement>('.tl-list')!;
  const plot = root.querySelector<HTMLCanvasElement>('.tl-plot')!;
  const readout = root.querySelector<HTMLElement>('.tl-readout')!;
  const legend = root.querySelector<HTMLElement>('.tl-legend')!;
  const scale = root.querySelector<HTMLInputElement>('[data-act=scale]')!;
  const scaleOut = scale.nextElementSibling as HTMLOutputElement;
  const gestureSel = root.querySelector<HTMLSelectElement>('[data-act=gesture]')!;
  gestureSel.innerHTML = GESTURES.map((g) => `<option value="${g.id}">${g.label}</option>`).join('');
  legend.innerHTML =
    CHANNELS.map((c) => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('') +
    (Object.keys(STATE_COLOR) as State[]).map((k) => `<span><i style="background:${STATE_COLOR[k]};border-radius:2px"></i>${k}</span>`).join('');

  scale.oninput = () => {
    peel.timeScale = +scale.value;
    scaleOut.textContent = `${peel.timeScale.toFixed(1)}×`;
  };
  const motionIn = root.querySelector<HTMLInputElement>('[data-act=motion]')!;
  const motionOut = motionIn.nextElementSibling as HTMLOutputElement;
  motionIn.oninput = () => {
    opts.motion?.seek(+motionIn.value);
    motionOut.textContent = (+motionIn.value).toFixed(2);
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'play':
        play();
        break;
      case 'replay':
        motionIn.value = '1';
        motionOut.textContent = '1.00';
        opts.motion?.replay();
        break;
      case 'stop':
        stopReplay();
        break;
      case 'clear':
        recs.length = 0;
        shown = null;
        stopReplay();
        renderList();
        draw();
        break;
      case 'run':
        void runGesture();
        break;
    }
  });
  list.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (!row) return;
    show(recs.find((r) => r.id === +row.dataset.id!) ?? null);
  });

  // scrubbing
  const scrubTo = (clientX: number) => {
    if (!shown || shown.samples.length < 2) return;
    const r = plot.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left - PAD_L) / (r.width - PAD_L - PAD_R)));
    const s = shown.samples;
    const t0 = s[0].t, t1 = s[s.length - 1].t;
    const tt = t0 + t * (t1 - t0);
    let i = 0;
    while (i < s.length - 1 && s[i + 1].t <= tt) i++;
    setHead(i);
  };
  let scrubbing = false;
  plot.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    try {
      plot.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    stopPlaying();
    scrubTo(e.clientX);
  });
  plot.addEventListener('pointermove', (e) => {
    if (scrubbing) scrubTo(e.clientX);
    else {
      const r = plot.getBoundingClientRect();
      hover = e.clientX - r.left;
      draw();
    }
  });
  plot.addEventListener('pointerleave', () => {
    hover = null;
    draw();
  });
  plot.addEventListener('pointerup', () => (scrubbing = false));

  addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 't' || e.key === 'T') api.toggle();
    if (!root.hidden && shown && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      stopPlaying();
      setHead(Math.min(shown.samples.length - 1, Math.max(0, head + (e.key === 'ArrowLeft' ? -1 : 1))));
    }
    if (!root.hidden && e.key === ' ' && shown) {
      e.preventDefault();
      playing ? stopPlaying() : play();
    }
  });
  addEventListener('resize', draw);

  // ------------------------------------------------------------ recording

  function record(b: Body, s: Sample, kind: Kind) {
    if (!cur || cur.b !== b || s.state === 'pressed' && cur.samples.length && cur.samples[cur.samples.length - 1].state !== 'pressed') {
      // a new interaction: pressed after anything else, or another body
      if (cur && cur.b === b && cur.samples[cur.samples.length - 1]?.state === 'pressed' && s.state !== 'pressed') {
        // same press continuing
      } else {
        cur = { id: nextId++, b, label: opts.describe(b), kind, samples: [] };
        recs.unshift(cur);
        if (recs.length > 30) recs.pop();
        // a new interaction takes the stage (unless the user is replaying another one)
        if (!replaying && !playing) {
          shown = cur;
          head = 0;
        }
        if (!root.hidden) renderList();
      }
    }
    cur.samples.push(s);
    if (cur.samples.length > 2400) cur.samples.shift();
    // keep the row's duration and state list current while it records
    if (!root.hidden && cur.samples.length % 15 === 0) renderList();
    if (shown === cur && !root.hidden) {
      head = cur.samples.length - 1;
      draw();
    } else if (!shown && !root.hidden) show(cur);
  }

  function renderList() {
    list.innerHTML = recs
      .map((r) => {
        const dur = r.samples.length > 1 ? ((r.samples[r.samples.length - 1].t - r.samples[0].t) / 1000).toFixed(2) : '0.00';
        const states = [...new Set(r.samples.map((s) => s.state))].join(' › ');
        return `<div class="tl-row ${r === shown ? 'on' : ''}" data-id="${r.id}"><b>#${r.id} ${r.label}</b><span>${r.kind} · ${dur}s · ${states}</span></div>`;
      })
      .join('');
  }

  function show(r: Recording | null) {
    stopReplay();
    shown = r;
    head = r ? r.samples.length - 1 : 0;
    renderList();
    draw();
  }

  function setHead(i: number) {
    if (!shown) return;
    head = i;
    const s = shown.samples[i];
    if (s) {
      replaying = shown.b;
      peel.replay(shown.b, s);
    }
    draw();
  }

  function stopReplay() {
    stopPlaying();
    if (replaying) peel.endReplay(replaying);
    replaying = null;
  }

  function play() {
    if (!shown || shown.samples.length < 2) return;
    stopPlaying();
    const s = shown.samples;
    const start = performance.now();
    const from = head >= s.length - 1 ? 0 : head;
    const t0 = s[from].t;
    const tick = () => {
      const el = ((performance.now() - start) * peel.timeScale) / 1;
      let i = from;
      while (i < s.length - 1 && s[i + 1].t - t0 <= el) i++;
      setHead(i);
      if (i < s.length - 1) playing = requestAnimationFrame(tick);
      else playing = 0;
    };
    playing = requestAnimationFrame(tick);
  }

  function stopPlaying() {
    if (playing) cancelAnimationFrame(playing);
    playing = 0;
  }

  async function runGesture() {
    const b = opts.selected();
    if (!b) {
      readout.textContent = 'Click a card first';
      return;
    }
    await run(b, gestureSel.value);
  }

  /** Dispatch a gesture as synthetic pointer events on a card. */
  async function run(b: Body, gestureId: string) {
    const g = GESTURES.find((x) => x.id === gestureId);
    if (!g) return;
    stopReplay();
    const r = desk.getBoundingClientRect();
    const a = (b.rot * Math.PI) / 180, lx = b.w * g.grab[0], ly = b.h * g.grab[1];
    let x = r.left + b.x + Math.cos(a) * lx - Math.sin(a) * ly;
    let y = r.top + b.y + Math.sin(a) * lx + Math.cos(a) * ly;
    const ev = (type: string, cx: number, cy: number) =>
      b.el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 99, clientX: cx, clientY: cy, button: 0, buttons: 1, isPrimary: true }));
    ev('pointerdown', x, y);
    for (const [dx, dy, ms] of g.path) {
      const sx = x, sy = y, t0 = performance.now();
      await new Promise<void>((res) => {
        const f = () => {
          const t = Math.min(1, (performance.now() - t0) / ms);
          x = sx + dx * t;
          y = sy + dy * t;
          ev('pointermove', x, y);
          t < 1 ? requestAnimationFrame(f) : res();
        };
        f();
      });
    }
    if (g.hold) await new Promise((res) => setTimeout(res, g.hold));
    ev('pointerup', x, y);
  }

  // ------------------------------------------------------------ plot

  const PAD_L = 8, PAD_R = 8, PAD_T = 6, PAD_B = 16;

  function draw() {
    if (root.hidden) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = plot.clientWidth, H = plot.clientHeight;
    if (plot.width !== W * dpr || plot.height !== H * dpr) {
      plot.width = W * dpr;
      plot.height = H * dpr;
    }
    const ctx = plot.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const r = shown;
    if (!r || r.samples.length < 2) {
      ctx.fillStyle = '#777';
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.fillText('Drag a card (or run a gesture) to record its motion.', PAD_L + 4, 24);
      readout.textContent = '';
      return;
    }
    const s = r.samples;
    const t0 = s[0].t, t1 = s[s.length - 1].t, span = Math.max(1, t1 - t0);
    const px = (t: number) => PAD_L + ((t - t0) / span) * (W - PAD_L - PAD_R);
    const ph = H - PAD_T - PAD_B;
    // state bands
    let i0 = 0;
    for (let i = 1; i <= s.length; i++) {
      if (i === s.length || s[i].state !== s[i0].state) {
        ctx.fillStyle = STATE_COLOR[s[i0].state];
        const a = px(s[i0].t), b = px(i < s.length ? s[i].t : t1);
        ctx.fillRect(a, PAD_T, Math.max(1, b - a), ph);
        i0 = i;
      }
    }
    // time grid every 250 ms
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#999';
    ctx.font = '10px JetBrains Mono, ui-monospace, monospace';
    for (let t = 0; t <= span; t += 250) {
      const x = px(t0 + t);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, PAD_T + ph);
      ctx.stroke();
      ctx.fillText(`${(t / 1000).toFixed(2)}`, x + 2, H - 4);
    }
    // zero / mid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T + ph / 2);
    ctx.lineTo(W - PAD_R, PAD_T + ph / 2);
    ctx.stroke();
    // channels
    const first = s[0];
    for (const c of CHANNELS) {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = c.key === 'lift' || c.key === 'peel' ? 2 : 1.2;
      ctx.beginPath();
      s.forEach((sm, i) => {
        const v = (c.get(sm, first) - c.range[0]) / (c.range[1] - c.range[0]);
        const y = PAD_T + ph - Math.min(1, Math.max(0, v)) * ph;
        i ? ctx.lineTo(px(sm.t), y) : ctx.moveTo(px(sm.t), y);
      });
      ctx.stroke();
    }
    // frame gaps (dropped frames show as wide steps)
    ctx.fillStyle = 'rgba(255,80,80,0.5)';
    for (let i = 1; i < s.length; i++) if (s[i].t - s[i - 1].t > 34) ctx.fillRect(px(s[i - 1].t), PAD_T, px(s[i].t) - px(s[i - 1].t), 3);
    // playhead
    const hs = s[head];
    if (hs) {
      const x = px(hs.t);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, PAD_T + ph);
      ctx.stroke();
      readout.textContent =
        `${((hs.t - t0) / 1000).toFixed(3)}s · ${hs.state} · lift ${hs.lift.toFixed(2)} · curl ${hs.peel.toFixed(2)} · tilt ${hs.tiltX.toFixed(1)}/${hs.tiltY.toFixed(1)}° · ` +
        `pos ${hs.x.toFixed(0)},${hs.y.toFixed(0)} · rot ${hs.rot.toFixed(1)}° · ptr ${Math.hypot(hs.pvx, hs.pvy).toFixed(0)}px/s · v ${Math.hypot(hs.vx, hs.vy).toFixed(0)}px/s ${hs.vr.toFixed(0)}°/s`;
    }
    if (hover !== null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(hover, PAD_T);
      ctx.lineTo(hover, PAD_T + ph);
      ctx.stroke();
    }
  }

  const api: Timeline = {
    record,
    toggle(force) {
      root.hidden = force === undefined ? !root.hidden : !force;
      if (root.hidden) stopReplay();
      else {
        renderList();
        draw();
      }
    },
    get open() {
      return !root.hidden;
    },
    recordings: () => recs,
    run,
  };
  return api;
}
