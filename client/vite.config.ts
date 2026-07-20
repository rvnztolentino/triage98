import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    // 98.css@0.1.21 ships a malformed `@media (not(hover))` query that the default
    // lightningcss minifier rejects. esbuild's CSS minifier is lenient and leaves it
    // intact, so we keep minification without patching a third-party stylesheet.
    cssMinify: 'esbuild',
  },
});
