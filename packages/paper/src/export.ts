/** Output helpers that work in browsers, workers and Node 18+. */

export interface PixelMap {
  width: number;
  height: number;
  /** RGBA8, rows top to bottom. */
  data: Uint8ClampedArray;
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Uint8Array, start: number, end: number): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encode a map as PNG bytes. Grayscale maps (height/overlay) are written as
 * 8-bit gray, others as RGB (paper is always opaque).
 */
export async function encodePNG(map: PixelMap, opts: { grayscale?: boolean } = {}): Promise<Uint8Array> {
  const { width: W, height: H, data } = map;
  const gray = opts.grayscale ?? isGray(data);
  const ch = gray ? 1 : 3;
  const stride = W * ch + 1;
  const raw = new Uint8Array(stride * H);
  for (let y = 0; y < H; y++) {
    const row = y * stride;
    raw[row] = 1; // "Sub" filter: compresses noise-like images a little better than none
    let px = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < ch; c++) {
        const v = data[i + c];
        const left = x > 0 ? data[i - 4 + c] : 0;
        raw[row + 1 + px++] = (v - left) & 255;
      }
    }
  }
  const idat = await zlibDeflate(raw);
  const chunks: [string, Uint8Array][] = [
    ['IHDR', ihdr(W, H, gray ? 0 : 2)],
    ['IDAT', idat],
    ['IEND', new Uint8Array(0)],
  ];
  let total = 8;
  for (const [, d] of chunks) total += 12 + d.length;
  const out = new Uint8Array(total);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const dv = new DataView(out.buffer);
  let o = 8;
  for (const [type, d] of chunks) {
    dv.setUint32(o, d.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(d, o + 8);
    dv.setUint32(o + 8 + d.length, crc32(out, o + 4, o + 8 + d.length));
    o += 12 + d.length;
  }
  return out;
}

function ihdr(w: number, h: number, colorType: number) {
  const b = new Uint8Array(13);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  b[8] = 8; // bit depth
  b[9] = colorType;
  return b;
}

function isGray(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false;
  return true;
}

export async function toBlob(map: PixelMap): Promise<Blob> {
  return new Blob([(await encodePNG(map)) as BlobPart], { type: 'image/png' });
}

export async function toDataURL(map: PixelMap): Promise<string> {
  const bytes = await encodePNG(map);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(bin);
}

export function toImageData(map: PixelMap): ImageData {
  return new ImageData(map.data as Uint8ClampedArray<ArrayBuffer>, map.width, map.height);
}

export function toCanvas(map: PixelMap, canvas?: HTMLCanvasElement): HTMLCanvasElement {
  const c = canvas ?? document.createElement('canvas');
  c.width = map.width;
  c.height = map.height;
  c.getContext('2d')!.putImageData(toImageData(map), 0, 0);
  return c;
}

/** CSS `background` value for a tiling paper (uses a blob: URL; revoke when done). */
export async function toCSSBackground(map: PixelMap, displayScale = 1): Promise<string> {
  const url = URL.createObjectURL(await toBlob(map));
  return `url(${url}) repeat 0 0 / ${map.width / displayScale}px ${map.height / displayScale}px`;
}
