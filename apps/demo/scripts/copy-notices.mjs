import { cpSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
mkdirSync('dist/licenses', { recursive: true });
cpSync('../../licenses', 'dist/licenses', { recursive: true });
copyFileSync('../../LICENSE', 'dist/LICENSE');
copyFileSync('../../THIRD_PARTY_NOTICES.md', 'dist/THIRD_PARTY_NOTICES.md');
for (const font of readdirSync('src/desk/pen-fonts')) {
  mkdirSync(`dist/licenses/${font}`, { recursive: true });
  for (const file of readdirSync(`src/desk/pen-fonts/${font}`)) {
    if (/LICENSE|OFL/.test(file)) copyFileSync(`src/desk/pen-fonts/${font}/${file}`, `dist/licenses/${font}/${file}`);
  }
}
for (const [from, name] of [
  ['node_modules/tegaki/LICENSE', 'Tegaki-LICENSE'],
  ['node_modules/tegaki/FONTS-LICENSE.md', 'Tegaki-FONTS-LICENSE.md'],
  ['node_modules/@chenglou/pretext/LICENSE', 'Pretext-LICENSE'],
  ['node_modules/brushmark/vendor/p5.brush/LICENSE.md', 'p5.brush-LICENSE.md'],
]) copyFileSync(from, `dist/licenses/${name}`);
