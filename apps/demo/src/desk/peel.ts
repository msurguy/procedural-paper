/**
 * Picking paper up and putting it down.
 *
 * Every card is held by something (see render.ts `Holder`): nothing, a glue
 * strip, tape, pins, magnets, or a clip / cord it hangs from. The holder
 * decides how the card comes off (corner peel, hinge, stretch-and-rip,
 * pivot-and-pop, slide, swing), how it is carried (lift, tilt, flutter) and
 * how it goes back on (slide and settle, press, push-in, snap, fall).
 *
 * Performance: nothing here re-renders pixels. One rAF loop runs only while
 * something moves, integrates a few springs, and writes `transform` /
 * `opacity` on the card, its shadow and sheen layers and the attachment
 * sprite involved. Layout is never read during a drag.
 */
import type { Mount } from './cards';
import type { PropKind } from './props';
import { shadowDir, type BuiltCard, type BuiltProp, type HolderKind, type HolderPoint } from './render';
import { buildCurl, sheetCopy, type Curl } from './curl';

export interface Body {
  el: HTMLElement;
  /** Rest pose: top-left (desk px, before rotation) and rotation. */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  built?: BuiltCard;
  propBuilt?: BuiltProp;
  propKind?: PropKind;
}

export interface Surface {
  mount: Mount;
  /** 0..1: felt grips, a cutting mat lets paper glide. */
  friction: number;
}

/** One frame of an interaction, for the debug timeline (timeline.ts). */
export interface Sample {
  t: number;
  state: State;
  x: number;
  y: number;
  rot: number;
  lift: number;
  peel: number;
  tiltX: number;
  tiltY: number;
  tape: number;
  lagX: number;
  lagY: number;
  /** Pointer position and velocity. */
  px: number;
  py: number;
  pvx: number;
  pvy: number;
  /** Momentum. */
  vx: number;
  vy: number;
  vr: number;
}

/** A pin on the desk (loose, or holding another card) that a carried card can pass over. */
export interface PinRef {
  owner: Body;
  /** The pin sprite to lift. */
  el: HTMLElement;
  /** Extra element that shows the lifted state (a loose prop's shadow holder). */
  holder?: HTMLElement;
  pos(): [number, number];
}

export interface PeelOptions {
  surface(): Surface;
  /** Every pin on the desk right now. */
  pins(): PinRef[];
  bodyOf(target: EventTarget | null): Body | null;
  /** The body was grabbed: raise it above the others. */
  onGrab(b: Body): void;
  /** Click without a drag (null: the bare desk). */
  onTap(b: Body | null): void;
  /** The body came to rest after an interaction (its x, y and rot are final). */
  onRest?(b: Body): void;
  /** Debug: every engine frame of an interaction. */
  onSample?(b: Body, s: Sample, kind: Kind): void;
}

export type Kind = HolderKind | 'prop';
export type State = 'pressed' | 'held' | 'carry' | 'free' | 'falling';

/** Full lift height (CSS px) of a carried sheet: shadow offset and softness scale with it. */
const LIFT_PX = 26;
const SLOP = 3;
const GRAVITY = 2600;

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rotv = (x: number, y: number, d: number): [number, number] => {
  const a = rad(d), c = Math.cos(a), s = Math.sin(a);
  return [c * x - s * y, s * x + c * y];
};

class Spring {
  vel = 0;
  target: number;
  constructor(public v = 0, public k = 300, public c = 25) {
    this.target = v;
  }
  set(v: number) {
    this.v = this.target = v;
    this.vel = 0;
    return this;
  }
  step(dt: number) {
    // two semi-implicit Euler half-steps keep stiff springs stable at 20 fps
    for (let i = 0; i < 2; i++) {
      const h = dt / 2;
      this.vel += (this.k * (this.target - this.v) - this.c * this.vel) * h;
      this.v += this.vel * h;
    }
  }
  get quiet() {
    // sub-pixel / sub-degree: nothing visible is still moving
    return Math.abs(this.v - this.target) < 0.03 && Math.abs(this.vel) < 0.3;
  }
}

interface PointerSample {
  t: number;
  x: number;
  y: number;
}

interface Live {
  b: Body;
  kind: Kind;
  state: State;
  thin: boolean;
  thick: boolean;
  /** Pointer at grab and now (desk px). */
  p0: [number, number];
  p: [number, number];
  samples: PointerSample[];
  /** Pointer velocity (px/s), smoothed. */
  pv: [number, number];
  /** Grab point in card-local px (unrotated frame). */
  g: [number, number];
  /** Rest pose at grab. */
  start: [number, number, number];
  /** Pose springs. */
  px: Spring;
  py: Spring;
  rotS: Spring;
  lift: Spring;
  tiltX: Spring;
  tiltY: Spring;
  /** Peel hinge: card-local point, rotation axis (unit, xy); `peel` is the bend amount 0..1. */
  hinge: [number, number];
  axis: [number, number];
  peel: Spring;
  /** Strip copy that bends during the pickup (free / adhesive, once its bitmaps are ready). */
  curl: Curl | null;
  curlSpec: { d: [number, number]; inset: number; extent?: number } | null;
  /** Where the body ended up (for restoring after a replay). */
  rest: [number, number, number] | null;
  sheenOn: boolean;
  /** Momentum after release. */
  v: [number, number];
  vr: number;
  /** Holder specifics. */
  points: HolderPoint[];
  popped: boolean;
  tape: Spring;
  lag: [Spring, Spring];
  swing: boolean;
  landed: boolean;
  /** Pins currently lifted out of the way of this card, by sprite. */
  over: Map<HTMLElement, PinRef>;
  bounds: { W: number; H: number; top: number };
  release: boolean;
  done: boolean;
}

export interface Peel {
  /** Place a body at its rest pose (layout code calls this instead of writing transforms). */
  setRest(b: Body, x: number, y: number, rot: number): void;
  /** Stop every animation and forget desk marks (new desk). */
  reset(): void;
  /** Finish anything in flight right now (before a layout change). */
  settleAll(): void;
  /** Debug: force one holder kind on every card. */
  force: Kind | null;
  /** Debug: slows the physics (0.1 = ten times slower). Pointer input is not slowed. */
  timeScale: number;
  /** Debug: show the body as it was at a recorded frame. Call `endReplay` to put it back. */
  replay(b: Body, s: Sample): void;
  endReplay(b: Body): void;
}

export function createPeel(desk: HTMLElement, opts: PeelOptions): Peel {
  const lives = new Map<Body, Live>();
  /** Last interaction of each body, kept for the timeline's replay. */
  const history = new WeakMap<Body, Live>();
  let raf = 0;
  let last = 0;
  let holes = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const simple = () => reduced.matches;
  const sdir = shadowDir();
  const api: Peel = {
    force: null,
    timeScale: 1,
    replay(b, s) {
      const L = history.get(b);
      if (!L || lives.has(b)) return;
      if (!L.curl && L.curlSpec && b.built) {
        // the strips were dropped when the card settled: rebuild them for the replay
        L.curl = buildCurl(curlCopy(b.built), b.w, b.h, L.curlSpec.d, L.curlSpec.inset, b.built.sheen.style, L.curlSpec.extent);
        b.el.appendChild(L.curl.el);
      }
      b.el.classList.add('live');
      b.x = s.x;
      b.y = s.y;
      b.rot = s.rot;
      L.state = s.state;
      L.lift.v = s.lift;
      L.peel.v = s.peel;
      L.tiltX.v = s.tiltX;
      L.tiltY.v = s.tiltY;
      L.tape.v = s.tape;
      L.lag[0].v = s.lagX;
      L.lag[1].v = s.lagY;
      apply(L);
    },
    endReplay(b) {
      const L = history.get(b);
      if (!L || lives.has(b) || !L.rest) return;
      [b.x, b.y, b.rot] = L.rest;
      L.state = 'free';
      bake(L);
    },
    setRest(b, x, y, rot) {
      b.x = x;
      b.y = y;
      b.rot = rot;
      if (!lives.has(b)) {
        b.el.style.left = `${x}px`;
        b.el.style.top = `${y}px`;
        b.el.style.transform = `rotate(${rot}deg)`;
      }
    },
    reset() {
      lives.clear();
      holes = 0;
      cancelAnimationFrame(raf);
      raf = 0;
    },
    settleAll() {
      for (const L of lives.values()) finish(L);
    },
  };

  // ------------------------------------------------------------ geometry

  /** Card-local point to desk px for the body's current pose. */
  const toWorld = (b: Body, x: number, y: number): [number, number] => {
    const [rx, ry] = rotv(x, y, b.rot);
    return [b.x + rx, b.y + ry];
  };

  const dist = (L: Live) => Math.hypot(L.p[0] - L.p0[0], L.p[1] - L.p0[1]);

  /** Carry: keep the grab point under the pointer whatever the rotation. */
  function follow(L: Live) {
    const [qx, qy] = rotv(L.g[0], L.g[1], L.rotS.v);
    L.px.target = L.p[0] - qx;
    L.py.target = L.p[1] - qy;
  }

  function updateVelocity(L: Live, now: number) {
    const s = L.samples;
    while (s.length > 1 && now - s[0].t > 90) s.shift();
    if (s.length < 2) {
      L.pv = [L.pv[0] * 0.8, L.pv[1] * 0.8];
      return;
    }
    const a = s[0], z = s[s.length - 1];
    const dt = Math.max(8, z.t - a.t) / 1000;
    L.pv = [(z.x - a.x) / dt, (z.y - a.y) / dt];
  }

  // ------------------------------------------------------------ marks on the desk

  function mark(cls: string, x: number, y: number, rot = 0, child?: HTMLElement) {
    const m = document.createElement('div');
    m.className = `mark ${cls}`;
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
    m.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    if (child) m.appendChild(child);
    desk.appendChild(m);
    return m;
  }

  function pinHole(L: Live, pt: HolderPoint) {
    if (opts.surface().mount === 'table' || holes >= 40) return;
    holes++;
    const [x, y] = toWorld(L.b, pt.x, pt.y);
    mark('hole', x, y);
  }

  function mugRing(L: Live) {
    const p = L.b.propBuilt!;
    const r = 28 + Math.random() * 8;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', `${r * 2 + 20}`);
    svg.setAttribute('height', `${r * 2 + 20}`);
    svg.style.filter = 'url(#f-stain)';
    svg.innerHTML = `<circle cx="${r + 10}" cy="${r + 10}" r="${r}" fill="rgba(140,90,40,0.05)" stroke="rgba(120,72,30,0.28)" stroke-width="${2 + Math.random() * 1.5}" stroke-dasharray="${r * 5.4} ${r * 0.9}" transform="rotate(${Math.random() * 360} ${r + 10} ${r + 10})"/>`;
    const wrap = document.createElement('div');
    wrap.appendChild(svg);
    mark('ring', L.b.x + p.ox, L.b.y + p.oy + 10, 0, wrap);
  }

  // ------------------------------------------------------------ pointer

  desk.addEventListener('pointerdown', (e) => {
    const b = opts.bodyOf(e.target);
    if (!b || e.button !== 0) {
      if (!b) opts.onTap(null);
      return;
    }
    e.preventDefault();
    const el = b.el;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no pointer to capture */
    }
    const old = lives.get(b);
    if (old) finish(old);
    opts.onGrab(b);
    const L = grab(b, e);
    lives.set(b, L);
    history.set(b, L);
    el.classList.add('live');
    // the desk's screen position is read once; scrolling during a drag refreshes it
    let r = desk.getBoundingClientRect();
    const onScroll = () => (r = desk.getBoundingClientRect());
    addEventListener('scroll', onScroll, { passive: true });
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      L.p = [ev.clientX - r.left, ev.clientY - r.top];
      L.samples.push({ t: ev.timeStamp, x: L.p[0], y: L.p[1] });
      if (L.samples.length > 8) L.samples.shift();
      if (L.state === 'pressed' && dist(L) > SLOP) begin(L);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      removeEventListener('scroll', onScroll);
      if (L.state === 'pressed') {
        finish(L);
        opts.onTap(b);
        return;
      }
      L.release = true;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    run();
  });

  function grab(b: Body, e: PointerEvent): Live {
    const r = desk.getBoundingClientRect();
    const p: [number, number] = [e.clientX - r.left, e.clientY - r.top];
    // grab point in the card's own frame
    const [lx, ly] = rotv(p[0] - b.x, p[1] - b.y, -b.rot);
    const kind: Kind = b.propBuilt ? 'prop' : (api.force && b.built ? api.force : b.built?.holder.kind) ?? 'free';
    const thickness = b.built?.thickness ?? 'thick';
    const thin = thickness === 'thin', thick = thickness === 'thick';
    const heavy = (b.propBuilt?.height ?? 0) > 30;
    const L: Live = {
      b,
      kind,
      state: 'pressed',
      thin,
      thick,
      p0: p,
      p: [...p] as [number, number],
      samples: [{ t: e.timeStamp, x: p[0], y: p[1] }],
      pv: [0, 0],
      g: [lx, ly],
      start: [b.x, b.y, b.rot],
      px: new Spring(b.x, 900, 48),
      py: new Spring(b.y, 900, 48),
      rotS: new Spring(b.rot, 140, 14),
      lift: new Spring(0, heavy ? 70 : thick ? 260 : 320, heavy ? 12 : 26),
      tiltX: new Spring(0, 160, thin ? 18 : 26),
      tiltY: new Spring(0, 160, thin ? 18 : 26),
      hinge: [b.w / 2, b.h / 2],
      axis: [1, 0],
      peel: new Spring(0, 220, 26),
      curl: null,
      curlSpec: null,
      rest: null,
      sheenOn: false,
      v: [0, 0],
      vr: 0,
      points: b.built?.holder.points ?? [],
      popped: false,
      tape: new Spring(1, 500, 12),
      lag: [new Spring(0, 90, 10), new Spring(0, 90, 10)],
      swing: false,
      landed: false,
      over: new Map(),
      bounds: { W: desk.clientWidth, H: desk.clientHeight, top: 0 },
      release: false,
      done: false,
    };
    if (kind === 'magnetic') {
      L.px.k = L.py.k = 170;
      L.px.c = L.py.c = 22;
    }
    // the bendable copy takes a frame or two (canvas -> blob): start it now so it is ready at the first move
    if (b.built && (kind === 'free' || kind === 'adhesive') && !simple()) b.built.copy ??= sheetCopy(b.el);
    // press: a hint of squash before anything moves
    L.lift.set(0);
    L.lift.vel = -0.4;
    apply(L);
    return L;
  }

  /** The pointer moved past the slop: the holder decides how the card comes off. */
  function begin(L: Live) {
    const { b } = L;
    L.state = 'held';
    const [cx, cy] = [b.w / 2, b.h / 2];
    switch (L.kind) {
      case 'free': {
        // hinge on the far side of the grab point; the grabbed corner lifts first.
        // Grabbed near the middle there is no corner to roll: the sheet just lifts.
        const dx = L.g[0] - cx, dy = L.g[1] - cy;
        const l = Math.hypot(dx, dy);
        if (l < 0.3 * Math.min(b.w, b.h)) break;
        const d: [number, number] = [dx / l, dy / l];
        L.hinge = [cx - dx, cy - dy];
        L.axis = [d[1], -d[0]];
        L.sheenOn = true;
        sheenAngle(L, d);
        // only the grabbed corner (or edge) rolls up: about a third of the sheet along the pull
        const along = Math.abs(d[0]) * b.w + Math.abs(d[1]) * b.h;
        makeCurl(L, d, 0, clamp(along * 0.38, 50, 140));
        break;
      }
      case 'adhesive': {
        // the grabbed corner (or edge) rolls up, like any sheet; the glue strip at the top never bends.
        // Grabbed on the strip itself there is nothing to roll: it just resists and comes off.
        const dx = L.g[0] - cx, dy = Math.max(L.g[1] - cy, 0);
        const l = Math.hypot(dx, dy);
        const d: [number, number] = l < 1 ? [0, 1] : [dx / l, dy / l];
        L.hinge = [cx - dx, cy - dy];
        L.axis = [d[1], -d[0]];
        L.peel.k = 160;
        L.peel.c = 22;
        L.sheenOn = true;
        sheenAngle(L, d);
        if (L.g[1] > b.h * 0.25) {
          // a sticky note rolls up a long way before the glue lets go
          const along = Math.abs(d[0]) * b.w + Math.abs(d[1]) * b.h;
          makeCurl(L, d, 0, clamp(along * 0.7, 90, 220));
        }
        break;
      }
      case 'taped':
        break;
      case 'pinned':
        break;
      case 'magnetic':
        break;
      case 'hung': {
        // lying on a desk the card does not hang; it swings about the clip when the hand changes direction
        L.swing = true;
        L.rotS.k = 80;
        L.rotS.c = 14;
        L.rotS.set(b.rot);
        L.lift.target = 1;
        L.state = 'carry';
        break;
      }
      case 'prop':
        if (b.propKind === 'mug') mugRing(L);
        L.lift.target = 1;
        L.state = 'carry';
        break;
    }
    if (simple()) {
      L.state = 'carry';
      L.lift.target = 1;
      L.sheenOn = false;
    }
  }

  const copies = new WeakMap<BuiltCard, HTMLElement>();
  const curlCopy = (built: BuiltCard) => copies.get(built) ?? document.createElement('div');

  /** Attach the strip copy once its bitmaps are ready (unless the drag is already over). */
  function makeCurl(L: Live, d: [number, number], hingeInset: number, extent?: number) {
    const built = L.b.built;
    if (!built?.copy) return;
    L.curlSpec = { d, inset: hingeInset, extent };
    void built.copy.then((copy) => {
      copies.set(built, copy);
      if (L.done || L.curl) return;
      L.curl = buildCurl(copy, L.b.w, L.b.h, d, hingeInset, built.sheen.style, extent);
      L.b.el.appendChild(L.curl.el);
    });
  }

  function sheenAngle(L: Live, d: [number, number]) {
    const s = L.b.built?.sheen;
    if (!s) return;
    // CSS gradient angle: 0deg points up, clockwise; `d` points from hinge to the lifted edge
    const a = deg(Math.atan2(d[0], -d[1]));
    s.style.background = `linear-gradient(${a}deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0) 42%, rgba(255,255,255,0.32) 72%, rgba(255,255,255,0.55) 100%)`;
  }

  // ------------------------------------------------------------ loop

  function run() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function tick(now: number) {
    raf = 0;
    const dt = clamp((now - last) / 1000, 0.001, 0.05) * api.timeScale;
    last = now;
    for (const L of lives.values()) {
      if (L.done) continue;
      updateVelocity(L, now);
      if (L.release) {
        L.release = false;
        release(L);
      }
      step(L, dt);
      apply(L);
      if (L.b.built) pinsUnder(L);
      opts.onSample?.(L.b, sampleOf(L, now), L.kind);
      if (settled(L)) finish(L);
    }
    for (const [b, L] of lives) if (L.done) lives.delete(b);
    if (lives.size) raf = requestAnimationFrame(tick);
  }

  function step(L: Live, dt: number) {
    const { b } = L;
    const d: [number, number] = [L.p[0] - L.p0[0], L.p[1] - L.p0[1]];
    const n = Math.hypot(d[0], d[1]);
    const held = L.state === 'held', carry = L.state === 'carry';

    if (held || carry) {
      switch (L.kind) {
        case 'free': {
          // 1. the grabbed corner rolls up (the sheet stays put), 2. only then does the sheet
          // come off the table, 3. the bend relaxes once it is in the air
          const curlT = L.curlSpec ? clamp(n / 30, 0, 1) : 1;
          const liftT = curlT < 1 ? 0 : clamp((n - (L.curlSpec ? 30 : 0)) / 45, 0, 1);
          L.lift.target = liftT;
          if (held) L.peel.target = L.curlSpec ? curlT : 0;
          else {
            L.peel.target = 0;
            L.peel.k = 45;
            L.peel.c = 13;
          }
          L.px.target = L.start[0] + d[0] * liftT;
          L.py.target = L.start[1] + d[1] * liftT;
          if (held && liftT >= 1) L.state = 'carry';
          break;
        }
        case 'adhesive': {
          if (held) {
            // the curl is complete at ~50 px of pull; the glue only gives after that
            L.peel.target = clamp(n / 50, 0, 1);
            L.lift.target = 0.25 * clamp(n / 50, 0, 1);
            L.px.target = L.start[0] + d[0] * 0.1;
            L.py.target = L.start[1] + d[1] * 0.1;
            if (n > 68) {
              L.state = 'carry';
              L.peel.target = 0;
              L.peel.k = 120;
              L.peel.c = 20;
              L.peel.vel = -1.5;
              L.lift.target = 1;
            }
          } else follow(L);
          break;
        }
        case 'taped': {
          if (held) {
            const s = clamp(n / 40, 0, 1);
            L.tape.set(1 + 0.07 * s);
            const k = Math.min(1, 12 / Math.max(n, 1));
            L.px.target = L.start[0] + d[0] * k;
            L.py.target = L.start[1] + d[1] * k;
            L.lift.target = 0.15 * s;
            if (n > 40) {
              L.state = 'carry';
              L.popped = true;
              L.lift.target = 1;
              L.tape.target = 1;
              L.tape.vel = -3;
            }
          } else follow(L);
          break;
        }
        case 'pinned': {
          if (held) {
            // the pin holds: the card gives a few px, then the pin pops out
            const k = Math.min(1, 8 / Math.max(n, 1));
            L.px.target = L.start[0] + d[0] * k;
            L.py.target = L.start[1] + d[1] * k;
            L.lift.target = 0.1;
            if (n > 26) popPins(L);
          } else follow(L);
          break;
        }
        case 'magnetic': {
          L.px.target = L.start[0] + d[0];
          L.py.target = L.start[1] + d[1];
          L.lag[0].target = clamp(-L.px.vel * 0.025, -14, 14);
          L.lag[1].target = clamp(-L.py.vel * 0.025, -14, 14);
          if (held) L.state = 'carry';
          break;
        }
        case 'hung': {
          // the grab point is the pivot; the card trails the hand, leaning against the motion
          follow(L);
          const [ux, uy] = rotv(b.w / 2 - L.g[0], b.h / 2 - L.g[1], L.start[2]);
          const lean = clamp((ux * L.pv[1] - uy * L.pv[0]) * 1.3e-4, -10, 10);
          L.rotS.target = L.start[2] + lean;
          break;
        }
        case 'prop':
          follow(L);
          break;
      }
      if (L.state === 'carry' && L.kind !== 'magnetic' && L.kind !== 'pinned') L.lift.target = Math.max(L.lift.target, 1);
      if (L.state === 'carry' && L.kind === 'pinned') L.lift.target = 1;
      // carried paper tilts into its motion; thin paper flutters
      const tk = L.thick ? 0.006 : L.thin ? 0.016 : 0.011;
      const lim = L.thin ? 11 : L.thick ? 5 : 8;
      const amt = L.kind === 'magnetic' ? 0 : L.lift.v;
      L.tiltY.target = clamp(L.pv[0] * tk, -lim, lim) * amt;
      L.tiltX.target = clamp(-L.pv[1] * tk, -lim, lim) * amt;
    }

    if (L.state === 'free') {
      const f = opts.surface().friction;
      const decel = (L.kind === 'adhesive' ? 6 : L.kind === 'prop' && (b.propBuilt?.height ?? 0) > 30 ? 5 : 1.4 + f * 1.6) * 2200;
      const sp = Math.hypot(L.v[0], L.v[1]);
      if (sp > 0) {
        const ns = Math.max(0, sp - decel * dt);
        L.v = [(L.v[0] / sp) * ns, (L.v[1] / sp) * ns];
        if (ns < 12) L.v = [0, 0];
      }
      L.vr *= Math.exp(-dt * (5 + f * 5));
      if (Math.abs(L.vr) < 2) L.vr = 0;
      slide(L, dt);
      L.tiltX.target = L.tiltY.target = 0;
      if (L.kind === 'magnetic') {
        L.lag[0].target = L.lag[1].target = 0;
      }
    }

    if (L.state === 'falling') {
      L.v[1] += GRAVITY * dt;
      L.v[0] *= Math.exp(-dt * 1.5);
      L.vr *= Math.exp(-dt * 0.6);
      slide(L, dt);
      const floor = L.bounds.H - b.h - 8;
      if (L.py.v >= floor) {
        L.py.set(floor);
        if (L.v[1] > 160) {
          L.v[1] = -L.v[1] * 0.22;
          L.vr *= 0.5;
        } else {
          L.v = [0, 0];
          L.vr = 0;
          L.state = 'free';
          L.lift.target = 0;
          land(L);
        }
      }
      L.tiltX.target = clamp(-L.v[1] * 0.004, -10, 10);
    }

    L.px.step(dt);
    L.py.step(dt);
    L.rotS.step(dt);
    L.lift.step(dt);
    L.tiltX.step(dt);
    L.tiltY.step(dt);
    L.peel.step(dt);
    L.tape.step(dt);
    L.lag[0].step(dt);
    L.lag[1].step(dt);
    b.x = L.px.v;
    b.y = L.py.v;
    b.rot = L.rotS.v;
  }

  /** Momentum moves the rest pose directly (the springs just track it). */
  function slide(L: Live, dt: number) {
    const { b } = L;
    let x = L.px.target + L.v[0] * dt;
    let y = L.py.target + L.v[1] * dt;
    const { W, H, top } = L.bounds;
    const minX = -b.w * 0.35, maxX = W - b.w * 0.65, minY = top - b.h * 0.2, maxY = H - b.h * 0.3;
    if (x < minX || x > maxX) {
      x = clamp(x, minX, maxX);
      L.v[0] = 0;
      L.v[1] *= 0.5;
    }
    if (y < minY || y > maxY) {
      y = clamp(y, minY, maxY);
      L.v[1] = L.state === 'falling' ? L.v[1] : 0;
      L.v[0] *= 0.5;
    }
    L.px.target = x;
    L.py.target = y;
    L.rotS.target += L.vr * dt;
    if (L.state === 'falling') {
      L.px.set(x);
      L.py.set(y);
      L.rotS.set(L.rotS.target);
    }
  }

  /** Pins in the way of a carried card lift up; they go back down once the card has passed or is put down. */
  function pinsUnder(L: Live) {
    const { b } = L;
    // once let go, the pins under the card stay up until it has settled (then they go in through it)
    if (L.state === 'free') return;
    const carried = L.state === 'carry' || L.state === 'falling';
    const now = new Map<HTMLElement, PinRef>();
    if (carried) {
      for (const pin of opts.pins()) {
        if (pin.owner === b) continue;
        const [px, py] = pin.pos();
        const [lx, ly] = rotv(px - b.x, py - b.y, -b.rot);
        if (lx > -6 && ly > -6 && lx < b.w + 6 && ly < b.h + 6) now.set(pin.el, pin);
      }
    }
    for (const [el, pin] of now) {
      if (L.over.has(el)) continue;
      pin.el.classList.remove('push');
      pin.el.classList.add('up');
      pin.holder?.classList.add('up');
      raise(pin);
    }
    for (const [el, pin] of L.over) {
      if (now.has(el)) continue;
      pin.el.classList.remove('up');
      pin.holder?.classList.remove('up');
      lower(pin);
      pin.el.classList.add('push');
    }
    L.over = now;
  }

  // A lifted pin must draw above the card passing over it. Loose pins get a higher z-index;
  // a pin that belongs to another card is moved out of that card into a desk-level layer
  // (same bitmap, placed at its desk position) and put back when it goes down.
  let pinLayer: HTMLElement | null = null;
  const home = new WeakMap<HTMLElement, { parent: HTMLElement; next: Node | null; left: string; top: string; z: string }>();

  function raise(pin: PinRef) {
    const el = pin.el;
    if (pin.holder) {
      home.set(el, { parent: pin.holder, next: null, left: '', top: '', z: pin.holder.style.zIndex });
      pin.holder.style.zIndex = '95000';
      return;
    }
    if (!pinLayer || !pinLayer.isConnected) {
      pinLayer = document.createElement('div');
      pinLayer.className = 'pins-up';
      desk.appendChild(pinLayer);
    }
    home.set(el, { parent: el.parentElement!, next: el.nextSibling, left: el.style.left, top: el.style.top, z: '' });
    const [ox, oy] = el.style.transformOrigin.split(' ').map(parseFloat);
    const [wx, wy] = pin.pos();
    el.style.left = `${wx - (ox || 0)}px`;
    el.style.top = `${wy - (oy || 0)}px`;
    el.style.rotate = `${pin.owner.rot}deg`;
    pinLayer.appendChild(el);
  }

  /** A pin pushed in through a card that was dropped on it: it moves from its old card to this one. */
  function adopt(L: Live, pin: PinRef) {
    const { b } = L;
    const el = pin.el;
    const [wx, wy] = pin.pos();
    if (pin.holder) {
      // a loose pin stays where it is, above the card it now holds
      home.delete(el);
      pin.holder.style.zIndex = '94000';
      return;
    }
    const h = home.get(el);
    home.delete(el);
    const front = b.el.querySelector<HTMLElement>(':scope > .front');
    if (!b.built || !front) {
      if (h) lower(pin);
      return;
    }
    const [lx, ly] = rotv(wx - b.x, wy - b.y, -b.rot);
    const [ox, oy] = el.style.transformOrigin.split(' ').map(parseFloat);
    el.style.left = `${lx - (ox || 0)}px`;
    el.style.top = `${ly - (oy || 0)}px`;
    // the sprite was lit for its old card's angle: keep it at that screen angle
    el.style.rotate = `${pin.owner.rot - b.rot}deg`;
    front.appendChild(el);
    const from = pin.owner.built?.holder;
    if (from) {
      from.points = from.points.filter((pt) => pt.el !== el);
      if (!from.points.length && from.kind === 'pinned') from.kind = 'free';
    }
    const to = b.built.holder;
    if (to.kind !== 'pinned') {
      to.kind = 'pinned';
      to.points = [];
    }
    to.points.push({ x: lx, y: ly, el });
  }

  function lower(pin: PinRef) {
    const el = pin.el;
    const h = home.get(el);
    if (!h) return;
    home.delete(el);
    if (pin.holder) {
      pin.holder.style.zIndex = h.z;
      return;
    }
    el.style.left = h.left;
    el.style.top = h.top;
    el.style.rotate = '';
    if (h.parent.isConnected) h.parent.insertBefore(el, h.next && h.next.parentNode === h.parent ? h.next : null);
    else el.remove();
  }

  function popPins(L: Live) {
    L.popped = true;
    L.state = 'carry';
    L.lift.target = 1;
    L.rotS.target = L.rotS.v;
    L.rotS.k = 220;
    L.rotS.c = 20;
    L.px.set(L.b.x);
    L.py.set(L.b.y);
    L.points.forEach((pt, i) => {
      setTimeout(() => {
        pt.el?.classList.remove('push');
        pt.el?.classList.add('popped');
        pinHole(L, pt);
      }, i * 60);
    });
  }

  function release(L: Live) {
    const { b } = L;
    // momentum only if the hand was still moving when it let go; a sheet of paper
    // slides a hand's width at most, not across the desk
    const lastMove = L.samples[L.samples.length - 1]?.t ?? 0;
    const stale = performance.now() - lastMove > 80;
    let sp = stale ? 0 : Math.hypot(L.pv[0], L.pv[1]);
    const cap = 1300;
    const scaleV = sp > cap ? cap / sp : 1;
    sp *= scaleV;
    L.v = stale ? [0, 0] : [L.pv[0] * scaleV, L.pv[1] * scaleV];
    // off-centre grabs spin the sheet as it is let go
    const [rx, ry] = rotv(L.g[0] - b.w / 2, L.g[1] - b.h / 2, b.rot);
    const inertia = (b.w * b.w + b.h * b.h) / 12;
    L.vr = sp > 350 ? clamp(deg((rx * L.v[1] - ry * L.v[0]) / inertia) * 0.04, -120, 120) : 0;
    if (L.kind === 'hung') {
      // let go: it stops leaning and settles at the angle it was picked up at
      L.rotS.target = L.start[2];
      L.rotS.c = 14;
      L.vr = 0;
    }
    if (L.state === 'held') {
      // never came off: settle back where it was held
      L.state = 'free';
      L.v = [0, 0];
      L.vr = 0;
      L.lift.target = 0;
      L.lift.c = 2 * Math.sqrt(L.lift.k);
      L.peel.target = 0;
      L.tape.target = 1;
      if (L.kind === 'pinned') L.rotS.c = 12;
      else {
        L.px.target = L.start[0];
        L.py.target = L.start[1];
      }
      return;
    }
    L.state = 'free';
    L.lift.target = 0;
    // a bend left in the sheet flattens as it lands
    L.peel.target = 0;
    L.peel.k = 160;
    L.peel.c = 25;
    // settle onto the desk: heavier things drop faster, thin paper floats; never below the surface
    const k = L.kind === 'prop' ? (sp > 0 ? 160 : 110) : L.thick ? 240 : L.thin ? 90 : 130;
    L.lift.k = k;
    L.lift.c = 2 * Math.sqrt(k);
    land(L);
  }

  /** The card is going back on: press, push pins in, snap magnets, tape down. */
  function land(L: Live) {
    if (L.landed) return;
    L.landed = true;
    switch (L.kind) {
      case 'adhesive':
        L.peel.k = 420;
        L.peel.c = 20;
        L.peel.set(0.22);
        L.peel.target = 0;
        break;
      case 'taped':
        if (L.popped) {
          L.tape.set(1.04);
          L.tape.target = 1;
        }
        break;
      case 'pinned':
        if (L.popped) {
          L.points.forEach((pt, i) =>
            setTimeout(() => {
              pt.el?.classList.remove('popped');
              pt.el?.classList.add('push');
            }, 120 + i * 70),
          );
        }
        break;
    }
  }

  function settled(L: Live): boolean {
    if (L.state !== 'free') return false;
    if (L.v[0] || L.v[1] || L.vr) return false;
    return L.px.quiet && L.py.quiet && L.rotS.quiet && L.lift.quiet && L.tiltX.quiet && L.tiltY.quiet && L.peel.quiet && L.tape.quiet && L.lag[0].quiet && L.lag[1].quiet;
  }

  function sampleOf(L: Live, t: number): Sample {
    const { b } = L;
    return {
      t,
      state: L.state,
      x: b.x,
      y: b.y,
      rot: b.rot,
      lift: L.lift.v,
      peel: L.peel.v,
      tiltX: L.tiltX.v,
      tiltY: L.tiltY.v,
      tape: L.tape.v,
      lagX: L.lag[0].v,
      lagY: L.lag[1].v,
      px: L.p[0],
      py: L.p[1],
      pvx: L.pv[0],
      pvy: L.pv[1],
      vx: L.v[0],
      vy: L.v[1],
      vr: L.vr,
    };
  }

  /** Bake the pose into left/top + rotate and release the layers. */
  function finish(L: Live) {
    if (L.done) return;
    L.done = true;
    const { b } = L;
    b.x = L.state === 'pressed' ? L.start[0] : L.px.target;
    b.y = L.state === 'pressed' ? L.start[1] : L.py.target;
    b.rot = L.state === 'pressed' ? L.start[2] : L.rotS.target;
    L.rest = [b.x, b.y, b.rot];
    bake(L);
    if (L.state !== 'pressed') opts.onRest?.(b);
    lives.delete(b);
  }

  /** Write the rest pose and clear every per-frame style. */
  function bake(L: Live) {
    const { b } = L;
    // put down on top of lifted pins: they go in through this card and now hold it
    for (const pin of L.over.values()) {
      pin.el.classList.remove('up');
      pin.holder?.classList.remove('up');
      if (L.state === 'pressed') lower(pin);
      else adopt(L, pin);
      pin.el.classList.add('push');
    }
    L.over.clear();
    const s = b.el.style;
    s.left = `${b.x}px`;
    s.top = `${b.y}px`;
    s.transform = `rotate(${b.rot}deg)`;
    const sh = b.built?.shadow ?? b.propBuilt?.shadow;
    if (sh) {
      sh.style.transform = '';
      for (const c of sh.children as HTMLCollectionOf<HTMLElement>) c.style.opacity = c.classList.contains('lifted') ? '0' : '1';
    }
    if (b.built) b.built.sheen.style.opacity = '0';
    L.curl?.dispose();
    L.curl = null;
    b.el.classList.remove('curling');
    for (const pt of L.points) {
      if (!pt.el) continue;
      if (L.kind === 'taped') pt.el.style.transform = `rotate(${pt.angle ?? 0}deg)`;
      if (L.kind === 'magnetic') pt.el.style.transform = '';
    }
    // flush with transitions still off, then let them back on
    void b.el.offsetWidth;
    setTimeout(() => {
      if (!lives.has(b)) b.el.classList.remove('live');
    }, 320);
  }

  // ------------------------------------------------------------ paint

  function apply(L: Live) {
    const { b } = L;
    const s = b.el.style;
    const tx = b.x - L.start[0], ty = b.y - L.start[1];
    let t = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotate(${b.rot.toFixed(3)}deg)`;
    const lift = Math.max(0, L.lift.v);
    const press = L.lift.v < 0 ? L.lift.v : 0;
    if (!simple() && L.kind !== 'magnetic') {
      const cx = b.w / 2, cy = b.h / 2;
      const sc = 1 + lift * (L.kind === 'prop' ? 0.04 : 0.018) + press * 0.01;
      // the card itself is never tilted or skewed: the lift is a small scale and the shadow,
      // and bending is only ever shown by the strip copy
      t += ` translate(${cx}px, ${cy}px) scale(${sc.toFixed(4)}) translate(${-cx}px, ${-cy}px)`;
      const bend = Math.max(0, L.peel.v);
      if (L.curl) {
        // the strip copy bends; the card itself stays flat but slides a little towards the hand,
        // since the rolled-up corner has pulled back from it
        const on = bend > 0.004;
        b.el.classList.toggle('curling', on);
        const { retreat } = L.curl.set(on ? bend : 0);
        if (retreat > 0 && L.curlSpec) {
          const [rx, ry] = rotv(L.curlSpec.d[0] * retreat * 0.25, L.curlSpec.d[1] * retreat * 0.25, b.rot);
          t = `translate(${rx.toFixed(2)}px, ${ry.toFixed(2)}px) ` + t;
        }
      }
    }
    s.transform = t;

    // shadow: slides away from the light and softens as the sheet rises
    const sh = b.built?.shadow ?? b.propBuilt?.shadow;
    if (sh) {
      const [dx, dy] = rotv(sdir[0], sdir[1], -b.rot);
      const h = L.kind === 'prop' ? lift * (8 + (b.propBuilt?.height ?? 4) * 0.2) : lift * LIFT_PX + Math.max(0, L.peel.v) * 6;
      sh.style.transform = `translate(${(dx * h).toFixed(2)}px, ${(dy * h).toFixed(2)}px) scale(${(1 + lift * 0.025).toFixed(4)})`;
      const k = clamp(lift + Math.max(0, L.peel.v) * 0.5, 0, 1);
      for (const c of sh.children as HTMLCollectionOf<HTMLElement>) {
        const isLifted = c.classList.contains('lifted');
        c.style.opacity = isLifted ? (L.kind === 'prop' ? 0.6 * k : 0.9 * k).toFixed(3) : (1 - k).toFixed(3);
      }
    }
    if (b.built) b.built.sheen.style.opacity = L.sheenOn && !L.curl ? clamp(L.peel.v, 0, 0.9).toFixed(3) : '0';

    // attachment sprites
    if (L.kind === 'taped' && Math.abs(L.tape.v - 1) > 0.001) {
      for (const pt of L.points) if (pt.el) pt.el.style.transform = `rotate(${pt.angle ?? 0}deg) scaleX(${L.tape.v.toFixed(4)})`;
    }
    if (L.kind === 'magnetic') {
      const [lx, ly] = rotv(L.lag[0].v, L.lag[1].v, -b.rot);
      for (const pt of L.points) if (pt.el) pt.el.style.transform = `translate(${lx.toFixed(2)}px, ${ly.toFixed(2)}px)`;
    }
  }

  return api;
}
