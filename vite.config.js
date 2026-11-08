import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages necesita la ruta del repositorio; Capacitor necesita rutas relativas.
  base: process.env.CAPACITOR_BUILD === 'true' ? './' : '/Micompra/'
});
