/** Locally bundled CC0 scans; paper stocks still use the procedural renderer. */
import { paperTexture, type Tex } from './papers';

const scans: Record<string, number> = {
  oak: 1400,
  walnut: 1400,
  plywood: 1600,
  concrete: 1200,
};
const loaded = new Map<string, Promise<Tex>>();

export function deskTexture(key: string, zoom = 1.6): Promise<Tex> {
  if (!Object.hasOwn(scans, key)) return paperTexture(key, 0, 512, zoom);
  let texture = loaded.get(key);
  if (!texture) {
    const url = `${new URL("../", location.href).pathname}textures/${key}.webp`;
    const image = new Image();
    image.src = url;
    texture = image.decode().then(() => ({ url, size: scans[key] })).catch(() => {
      // Keep the desk usable if an asset is unavailable, and allow a later retry.
      loaded.delete(key);
      return paperTexture(key, 0, 512, zoom);
    });
    loaded.set(key, texture);
  }
  return texture;
}
