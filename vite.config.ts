import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AcornAccess',
      formats: ['iife', 'es'],
      fileName: (format) => {
        if (format === 'iife') return 'acorn-access.min.js';
        return 'acorn-access.es.js';
      },
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: true,
    cssCodeSplit: false,
    assetsInlineLimit: 1024 * 1024,
  },
  server: {
    open: '/demo/index.html',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
