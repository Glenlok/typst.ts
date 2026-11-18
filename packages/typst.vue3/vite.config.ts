import { defineConfig } from 'vite';
import type { RollupOptions } from 'rollup';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export const rollupOptions: RollupOptions = {
  // make sure to externalize deps that shouldn't be bundled
  // into your library
  external: ['vue', '@myriaddreamin/typst.ts'],
  output: {
    // Provide global variables to use in the UMD build
    // for externalized deps
    globals: {
      vue: 'Vue',
      '@myriaddreamin/typst.ts': 'TypstTs',
    },
    compact: true,
    inlineDynamicImports: true,
  },
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isUmdBuild = mode === 'umd';
  const isFontsBuild = mode === 'fonts';

  return {
    base: './',
    plugins: [vue()],
    build: {
      emptyOutDir: !isUmdBuild && !isFontsBuild,
      lib: {
        entry: resolve(
          __dirname,
          isFontsBuild ? 'src/libertinus.ts' : isUmdBuild ? 'src/index.umd.ts' : 'src/index.ts',
        ),
        name: 'Typst',
        fileName: format => (isFontsBuild ? 'libertinus.js' : `index.${format}.js`),
        formats: [isUmdBuild ? 'umd' : 'es'],
      },
      rollupOptions,
    },
  };
});
