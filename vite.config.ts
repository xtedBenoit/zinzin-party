import { defineConfig } from 'vite';

const SERVER = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    host: true, // accessible depuis les téléphones du réseau local
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/socket.io': { target: SERVER, ws: true },
    },
  },
});
