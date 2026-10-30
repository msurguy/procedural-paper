import type { AssetResolver, CompositionAsset } from './model';
import type { PenContext } from './pen';
import type { TegakiBundle } from 'tegaki/core';

/** Font faces are shared with reference counting; unmounting one instance cannot break another. */
const fonts = new Map<string, { count: number; face: FontFace; ready: Promise<FontFace> }>();
export async function loadCompositionAssets(assets: CompositionAsset[], resolve: AssetResolver, pen: boolean) {
  const urls = new Map<string, string>();
  const releases: (() => void)[] = [];
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; releases.forEach(release => release()); };
  try {
    for (const asset of assets) urls.set(asset.id, await resolve(asset));
    await Promise.all(assets.filter(a => a.kind === 'font').map(async asset => {
      const url = urls.get(asset.id)!;
      if (!asset.family) throw new Error(`Missing font family for ${asset.id}`);
      const key = JSON.stringify([asset.family, asset.descriptors, url]);
      let entry = fonts.get(key);
      if (!entry) {
        const face = new FontFace(asset.family, `url(${JSON.stringify(url)})`, asset.descriptors);
        entry = { count: 0, face, ready: face.load() }; fonts.set(key, entry);
      }
      entry.count++;
      const current = entry;
      releases.push(() => { if (--current.count === 0) { document.fonts.delete(current.face); fonts.delete(key); } });
      await current.ready; if (!disposed) document.fonts.add(current.face);
    }));
    let penContext: PenContext | undefined;
    if (pen) {
      const penAssets = assets.filter(a => a.kind === 'pen');
      if (penAssets.length) {
        const { TegakiEngine } = await import('tegaki/core');
        const bundles = new Map<string, TegakiBundle>();
        for (const asset of penAssets) {
          const response = await fetch(urls.get(asset.id)!);
          if (!response.ok) throw new Error(`Unable to load pen data ${asset.id}`);
          const data = await response.json();
          const font = assets.find(a => a.kind === 'font' && a.family === asset.family);
          if (!font) throw new Error(`Missing pen font ${asset.family}`);
          const bundle = { ...data, fontUrl: urls.get(font.id), fontFaceCSS: undefined } as TegakiBundle;
          await TegakiEngine.preload(bundle);
          bundles.set(bundle.family.toLowerCase(), bundle);
          if (asset.matches) bundles.set(asset.matches.toLowerCase(), bundle);
        }
        penContext = { Engine: TegakiEngine, bundleFor: family => bundles.get(family.split(',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase()) };
      }
    }
    return { urls, penContext, dispose };
  } catch (error) { dispose(); throw error; }
}
