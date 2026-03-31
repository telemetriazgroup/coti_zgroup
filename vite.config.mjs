import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Rutas relativas (./assets/...) para que JS/CSS sigan el mismo esquema que la página (http vs https).
  // Evita que el navegador pida https:// en despliegues solo-HTTP por IP (Chrome HTTPS-First / orígenes mixtos).
  base: './',
  root: path.join(__dirname, 'client'),
  resolve: {
    alias: {
      '@shared': path.join(__dirname, 'shared'),
    },
  },
  plugins: [react()],
  build: {
    outDir: path.join(__dirname, 'client/dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    fs: {
      allow: [path.join(__dirname), path.join(__dirname, 'shared')],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
