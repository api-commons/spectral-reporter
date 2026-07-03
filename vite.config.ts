import { defineConfig } from 'vite';

// The hosted landing + live demo site for reporter.apicommons.org.
// Entry is the repo-root index.html; the demo imports the SAME shared
// src/render-report.js the CLI uses, so the live preview is byte-identical to a
// CI-generated report. Output goes to dist/, which the Pages workflow uploads.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
  },
});
