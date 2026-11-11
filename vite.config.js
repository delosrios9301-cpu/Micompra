import { defineConfig } from 'vite';

// GitHub Pages publica en /Micompra/; Firebase Hosting publica en la raíz.
const base = process.env.VITE_BASE_PATH
  || (process.env.CAPACITOR_BUILD === 'true' ? './' : '/Micompra/');

export default defineConfig({
  base,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/@firebase/auth/')) return 'firebase-auth';
          if (id.includes('/@firebase/firestore/')) return 'firebase-firestore';
          if (id.includes('/@firebase/app/')) return 'firebase-app';
          if (id.includes('/@firebase/')) return 'firebase-core';
          if (id.includes('/firebase/')) return 'firebase-sdk';
        }
      }
    },
    chunkSizeWarningLimit: 650
  }
});
