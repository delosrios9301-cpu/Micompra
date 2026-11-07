# Mi Compra

Aplicación web para listas de compras y comparación verificable de precios publicados por supermercados de Panamá.

## Estado
- Supabase contiene siete tablas base: supermercados, productos, productos por tienda, observaciones de precios, listas, artículos y ejecuciones de sincronización.
- Esta primera entrega prepara la interfaz; todavía no hay precios importados ni conectores de extracción activos.
- Todo precio debe conservar URL de origen y fecha de observación. No se inventarán precios.

## Desarrollo
1. Copia .env.example a .env.local.
2. Completa VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.
3. Ejecuta npm install y npm run dev.

No publiques claves secretas ni service_role en el navegador. Las integraciones se conectarán tienda por tienda respetando sus condiciones de acceso.