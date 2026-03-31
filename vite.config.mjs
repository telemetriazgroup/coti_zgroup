import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ./ = raíz (IP:3000 o dev). /coti_zgroup/ = subruta detrás de Apache (debe coincidir con PUBLIC_BASE_PATH en Node).
const viteBase = process.env.VITE_BASE_PATH || './';

export default defineConfig({
  base: viteBase,
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
