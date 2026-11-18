import { defineConfig } from 'vite';

export default defineConfig({
  // SPA: every unknown path falls back to index.html (dev + preview).
  appType: 'spa',
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // The WebGL garment engine and the owner dashboard get their own chunks.
        manualChunks(id) {
          if (id.includes('/src/gl/')) return 'garments';
          if (id.includes('/src/admin/')) return 'admin';
        },
      },
    },
  },
  // `npm run dev` + `npm run api`: the API runs on :3001 and Vite forwards /api to it,
  // so the browser sees one site (cookies and CSRF checks work as in production).
  server: {
    port: 5173,
    open: true,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } },
  },
});
