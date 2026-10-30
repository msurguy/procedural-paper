import { defineConfig } from 'vitest/config';
export default defineConfig({
  build: {
    lib: { entry: { index: 'src/index.ts', dom: 'src/dom.ts', react: 'src/react.ts', 'composition/index': 'src/composition/index.ts', 'composition/react': 'src/composition/react.ts', 'composition/motion': 'src/composition/motion.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    rollupOptions: { external: (id) => /^(react(?:-dom)?(?:\/|$)|@chenglou\/pretext|brushmark|tegaki)/.test(id), output: { banner: (chunk) => chunk.name.endsWith('react') ? "'use client';" : '' } },
    sourcemap: true,
    target: 'es2022',
  },
  test: { environment: 'node' },
});
