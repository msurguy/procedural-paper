// Refresh explicitly reviewed, self-hosted demo font assets. Not run during install/build.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = readFileSync('apps/demo/src/desk/fonts.ts', 'utf8');
const families = [...source.matchAll(/family: '([^']+)'[^\n]+?(?:weight: ':wght@([^']+)')?[^\n]*\}/g)].map(m => ({ family: m[1], weights: /weight: ':wght@([^']+)'/.exec(m[0])?.[1] ?? '400' }));
families.push({ family: 'Inter', weights: '400;500;600' });
const dir = 'apps/demo/public/fonts'; mkdirSync(dir, { recursive: true });
const assets = [];
for (const { family, weights } of families) {
  const slug = family.toLowerCase().replace(/ /g, '');
  const cssUrl = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weights}&display=swap`;
  const response = await fetch(cssUrl, { headers: { 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' } });
  if (!response.ok) throw new Error(`${family}: ${response.status}`);
  const css = await response.text();
  let license;
  for (const path of [`ofl/${slug}/OFL.txt`, `apache/${slug}/LICENSE.txt`]) {
    const r = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${path}`);
    if (r.ok) { license = await r.text(); break; }
  }
  if (!license) throw new Error(`Missing license for ${family}`);
  const licenseFile = `fonts/${slug}-LICENSE.txt`; writeFileSync(`apps/demo/public/${licenseFile}`, license);
  let index = 0;
  for (const [, body] of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const url = /url\(([^)]+)\)/.exec(body)?.[1]; if (!url) continue;
    const r = await fetch(url); if (!r.ok) throw new Error(`Font failed: ${url}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    const file = `fonts/${slug}-${hash.slice(0, 12)}.woff2`; writeFileSync(`apps/demo/public/${file}`, bytes);
    assets.push({ id: `font-${slug}-${index++}`, kind: 'font', file, family,
      descriptors: { weight: /font-weight:\s*([^;]+)/.exec(body)?.[1] ?? '400', style: /font-style:\s*([^;]+)/.exec(body)?.[1] ?? 'normal', unicodeRange: /unicode-range:\s*([^;]+)/.exec(body)?.[1] ?? 'U+0-10FFFF' },
      credits: `${family}: Google Fonts; see accompanying font license.`, licenseFiles: [licenseFile], sourceUrl: url, sha256: hash });
  }
  console.log(`${family}: ${index} faces`);
}
writeFileSync('apps/demo/src/desk/font-assets.json', JSON.stringify(assets, null, 2)+'\n');
