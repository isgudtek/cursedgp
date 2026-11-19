import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (GitHub Pages, Vercel, itch.io...).
export default defineConfig({
  base: './',
  server: { port: 5173 },
  preview: { port: 5180, allowedHosts: ['tappo.mycrab.space'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
