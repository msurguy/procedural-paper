import { copyFileSync, cpSync } from 'node:fs';
copyFileSync('src/styles.css', 'dist/styles.css');
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) copyFileSync(`../../${file}`, file);
copyFileSync('../../docs/library.md', 'README.md');
cpSync('../../licenses', 'licenses', { recursive: true });

copyFileSync('src/composition.css', 'dist/composition.css');
