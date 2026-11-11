import { defineConfig } from 'vite';

// GitHub Pages publica en /Micompra/; Firebase Hosting publica en la raíz.
const base = process.env.VITE_BASE_PATH
  || (process.env.CAPACITOR_BUILD === 'true' ? './' : '/Micompra/');

export default defineConfig({ base });
