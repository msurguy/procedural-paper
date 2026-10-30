/**
 * A bendable copy of a card for the pickup: the sheet is cut into strips
 * (each a clone of the card's layers, sharing the same bitmaps) and the strips
 * are laid along a cylinder with per-strip 3D transforms. Nothing is
 * re-rendered: canvases become <img> once per card, strips are clones, and a
 * frame only writes `transform` / `opacity` on each strip.
 *
 * The strip grid is rotated so the bend axis is perpendicular to the pull
 * direction; inside each strip the content is rotated back, so it lines up
 * with the flat card exactly when the curl is zero.
 */

const STRIPS = 16;
const urls = new WeakMap<HTMLCanvasElement, Promise<string>>();

function canvasUrl(c: HTMLCanvasElement): Promise<string> {
  let p = urls.get(c);
  if (!p) {
    p = new Promise((ok, err) => c.toBlob((b) => (b ? ok(URL.createObjectURL(b)) : err(new Error('toBlob failed')))));
    urls.set(c, p);
  }
  return p;
}

/** A copy of the card's layers (back, paper, front) with every canvas replaced by an <img>. */
export async function sheetCopy(card: HTMLElement): Promise<HTMLElement> {
  const copy = document.createElement('div');
  copy.className = 'sheet-copy';
  const jobs: Promise<void>[] = [];
  for (const layer of card.querySelectorAll<HTMLElement>(':scope > .back, :scope > .paper, :scope > .front')) {
    const clone = layer.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.sheen').forEach((s) => s.remove());
    const srcCanvases = layer.querySelectorAll('canvas');
    const dstCanvases = clone.querySelectorAll('canvas');
    srcCanvases.forEach((src, i) => {
      const dst = dstCanvases[i];
      const img = document.createElement('img');
      img.className = src.className;
      img.style.cssText = src.style.cssText;
      img.draggable = false;
      jobs.push(canvasUrl(src).then((u) => void (img.src = u)));
      dst.replaceWith(img);
    });
    copy.appendChild(clone);
  }
  await Promise.all(jobs);
  return copy;
}

export interface Curl {
  el: HTMLElement;
  /** Strip pitch, container size. */
  sh: number;
  D: number;
  /** Positions along the pull direction (container px) of the hinge side and the lifted edge. */
  sHinge: number;
  sEdge: number;
  /** Set the bend: amount 0..1. Returns the lift (px) of the far edge and how far it has pulled back along the pull direction. */
  set(amount: number): { lift: number; retreat: number };
  dispose(): void;
}

/**
 * Build the strips for a card of size w x h. `d` is the unit pull direction
 * (card-local, unrotated) from the hinge towards the lifted edge; `hingeInset`
 * (px) keeps that much of the sheet flat on the hinge side (glue strips).
 */
export function buildCurl(copy: HTMLElement, w: number, h: number, d: [number, number], hingeInset = 0, mask?: CSSStyleDeclaration, extent?: number): Curl {
  const D = Math.ceil(Math.hypot(w, h)) + 2;
  const sh = D / STRIPS;
  // rotation that maps local +y onto d
  const a = Math.atan2(-d[0], d[1]);
  const half = (w / 2) * Math.abs(d[0]) + (h / 2) * Math.abs(d[1]);
  const sEdge = D / 2 + half;
  const sHinge = D / 2 - half + hingeInset;

  const el = document.createElement('div');
  el.className = 'curl';
  el.style.width = el.style.height = `${D}px`;
  el.style.left = `${(w - D) / 2}px`;
  el.style.top = `${(h - D) / 2}px`;
  el.style.transform = `rotate(${(a * 180) / Math.PI}deg)`;
  const rows: HTMLElement[] = [];
  const lights: HTMLElement[] = [];
  for (let i = 0; i < STRIPS; i++) {
    const row = document.createElement('div');
    row.className = 'strip';
    row.style.top = `${i * sh}px`;
    row.style.height = `${sh + 1}px`;
    const inner = document.createElement('div');
    inner.className = 'strip-in';
    inner.style.transform = `translateY(${-i * sh}px)`;
    const content = copy.cloneNode(true) as HTMLElement;
    content.style.width = `${w}px`;
    content.style.height = `${h}px`;
    content.style.left = `${(D - w) / 2}px`;
    content.style.top = `${(D - h) / 2}px`;
    content.style.transform = `rotate(${(-a * 180) / Math.PI}deg)`;
    const light = document.createElement('div');
    light.className = 'strip-light';
    if (mask) {
      const ls = light.style;
      ls.maskImage = ls.webkitMaskImage = mask.maskImage || mask.webkitMaskImage;
      ls.maskPosition = ls.webkitMaskPosition = mask.maskPosition || mask.webkitMaskPosition;
      ls.maskSize = ls.webkitMaskSize = mask.maskSize || mask.webkitMaskSize;
      ls.maskRepeat = ls.webkitMaskRepeat = 'no-repeat';
    }
    content.appendChild(light);
    inner.append(content);
    row.append(inner);
    el.appendChild(row);
    rows.push(row);
    lights.push(light);
  }

  // how much of the sheet (from the lifted edge) takes part in the bend: a corner curl
  // is local, a glue-strip hinge bends everything up to the strip
  const L = Math.min(sEdge - sHinge, extent ?? Infinity);
  const R = 0.7 * L;
  return {
    el,
    sh,
    D,
    sHinge,
    sEdge,
    set(amount) {
      const c = Math.max(0, Math.min(1, amount));
      const s0 = sEdge - c * L;
      let lift = 0;
      const phiEdge = Math.max(0, sEdge - s0) / R;
      const retreat = c <= 0.002 ? 0 : sEdge - (s0 + R * Math.sin(phiEdge));
      for (let i = 0; i < STRIPS; i++) {
        const s = i * sh;
        if (c <= 0.002 || s + sh <= s0) {
          rows[i].style.transform = '';
          lights[i].style.opacity = '0';
          continue;
        }
        // strips that start before the curl stay where they are (only their tail bends)
        const phi = Math.max(0, s - s0) / R;
        const y = s <= s0 ? s : s0 + R * Math.sin(phi);
        const z = R * (1 - Math.cos(phi));
        rows[i].style.transform = `translate3d(0, ${(y - s).toFixed(2)}px, ${z.toFixed(2)}px) rotateX(${phi.toFixed(4)}rad)`;
        // the bent face turns towards the light: a little brighter, then darker as it folds over
        const shade = Math.sin(phi) * 0.3 - Math.max(0, phi - 1.1) * 0.45;
        lights[i].style.background = shade >= 0 ? '#fff' : '#000';
        lights[i].style.opacity = Math.abs(shade).toFixed(3);
        lift = z;
      }
      return { lift, retreat };
    },
    dispose() {
      el.remove();
    },
  };
}
