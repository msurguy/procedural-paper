import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  base: process.env.DEMO_BASE ?? './',
  resolve: { alias: [
    { find: 'procedural-paper/composition.css', replacement: local('../../packages/paper/src/composition.css') },
    { find: 'procedural-paper/composition/react', replacement: local('../../packages/paper/src/composition/react.ts') },
    { find: 'procedural-paper/composition', replacement: local('../../packages/paper/src/composition/index.ts') },
    { find: 'procedural-paper/dom', replacement: local('../../packages/paper/src/dom.ts') },
    { find: 'procedural-paper', replacement: local('../../packages/paper/src/index.ts') },
  ] },
  optimizeDeps: { exclude: ['tegaki'] },
  build: { rollupOptions: { input: {
    main: local('./index.html'), components: local('./components.html'), exporter: local('./exporter/index.html'), desk: local('./desk/index.html'),
  } } },
});
