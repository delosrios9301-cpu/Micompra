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
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase-vendor';
          if (id.includes('/@supabase/')) return 'legacy-supabase';
        }
      }
    },
    chunkSizeWarningLimit: 650
  }
});
