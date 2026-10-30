import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(), packageDir = resolve('packages/paper');
const temp = mkdtempSync(join(tmpdir(), 'procedural-paper-pack-'));
const packing = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temp], { cwd: packageDir, encoding: 'utf8' }));
const packed = Array.isArray(packing) ? packing[0] : packing.files ? packing : packing['procedural-paper'];
if (!packed.files) throw new Error('Unexpected pack output: ' + JSON.stringify(packing));
const names = packed.files.map(f => f.path);
for (const entry of ['dist/composition/index.js', 'dist/composition/react.js', 'dist/composition/motion.js', 'dist/composition.css', 'dist/composition/index.d.ts', 'dist/index.js', 'dist/dom.js', 'dist/react.js', 'dist/styles.css', 'dist/index.d.ts', 'dist/dom.d.ts', 'dist/react.d.ts', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/Apache-2.0.txt']) assert(names.includes(entry), `Missing ${entry}`);
assert(!names.some(p => /\.(webp|png|jpe?g|otf|ttf|woff2?)$|(^|\/)(apps|archive|private|references|originals)\//i.test(p)), 'Private/demo assets in package');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e => ['node_modules', 'dist', '.git', 'archive', '.pnpm-store', 'test-results', 'playwright-report', 'coverage'].includes(e.name) ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const allow = new Set(JSON.parse(readFileSync('scripts/demo-assets.json', 'utf8')));
for (const path of walk('.')) {
  if (/\.(webp|png|jpe?g|gif|avif|tiff?|heic)$/i.test(path)) assert(allow.has(path), `Unreviewed source image: ${path}`);
}
for (const path of allow) assert(existsSync(path), `Missing attributed asset: ${path}`);
const modules = join(temp, 'node_modules'); mkdirSync(modules);
execFileSync('tar', ['-xzf', join(temp, packed.filename), '-C', temp]);
symlinkSync(join(temp, 'package'), join(modules, 'procedural-paper'));
for (const dep of ['react', 'react-dom', 'jsdom', '@chenglou/pretext', 'brushmark', 'tegaki']) {
  if(dep.includes('/')) mkdirSync(join(modules,dep.split('/')[0]),{recursive:true});
  symlinkSync(resolve(packageDir, 'node_modules', dep), join(modules, dep));
}
writeFileSync(join(temp, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { generatePaper, encodePNG, cardPresetIds } from 'procedural-paper';
import { createPaperCard } from 'procedural-paper/dom';
import { PaperCard } from 'procedural-paper/react';
import { createPaperComposition } from 'procedural-paper/composition';
import { PaperComposition } from 'procedural-paper/composition/react';
assert.equal(typeof createPaperComposition, 'function');
assert(PaperComposition);
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
const paper = await generatePaper({ preset: 'kraft', width: 16, backend: 'cpu' });
assert((await encodePNG(paper.maps.color)).length > 50);
assert.equal(cardPresetIds.length, 25);
assert(renderToString(createElement(PaperCard, { preset: 'sticky' }, 'SSR content')).includes('SSR content'));
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
const card = createPaperCard({ preset: 'sticky' });
card.slots.content.textContent = 'Vanilla'; card.update({ seed: 3 });
assert.equal(card.slots.content.textContent, 'Vanilla'); card.dispose();
console.log('Packed Node, vanilla and React SSR imports passed');
`);
execFileSync(process.execPath, [join(temp, 'consumer.mjs')], { cwd: root, stdio: 'inherit' });
console.log(`Package audited: ${names.length} files; ${allow.size} attributed demo images excluded. Tarball: ${join(temp, packed.filename)}`);
