# Mi Compra

Aplicación web personal para organizar compras del hogar y comparar precios publicados por supermercados de Panamá.

## Datos y estado del proyecto

- Supabase es la fuente central de datos en la nube.
- El catálogo central tiene 61 productos activos en la última revisión.
- Hay 24 asociaciones de productos con supermercados: Super 99 (17), Xtra (4), Riba Smith (2) y El Machetazo (1).
- Jumbo y El Rey siguen en investigación; no se crean asociaciones sin una ficha individual suficientemente identificable.
- La base registra 22 observaciones de precios aprobadas y verificadas dentro de las últimas 24 horas al 8 de noviembre de 2026. Cada observación conserva supermercado, sucursal cuando corresponde, URL de origen, moneda, fecha de observación y estado de verificación.
- Un precio solo se considera actual si está aprobado, verificado, es positivo y fue observado dentro de las últimas 24 horas.
- Una comparación por tienda solo se considera completa cuando todos los artículos pendientes tienen precio válido de esa misma tienda. No se inventan ni se extrapolan precios.

Las cifras anteriores son una fotografía de la revisión del 8 de noviembre de 2026 y pueden cambiar.

## Desarrollo local

1. Copia `.env.example` a `.env.local`.
2. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Ejecuta `npm install`.
4. Ejecuta `npm test` para validar la lógica.
5. Ejecuta `npm run dev` para desarrollo.
6. Ejecuta `npm run build` para compilar producción.

Nunca publiques claves secretas ni `service_role` en el navegador. La aplicación usa exclusivamente la clave pública/publishable con políticas RLS en Supabase.

## Publicación gratuita con GitHub Pages

El flujo `.github/workflows/deploy.yml` ejecuta pruebas, compilación y despliegue al hacer push a `main`.

Primera habilitación requerida en GitHub:
1. Abre **Settings** del repositorio.
2. Entra en **Pages**.
3. En **Build and deployment**, selecciona **GitHub Actions** como fuente.
4. Guarda el cambio. El flujo volverá a ejecutarse automáticamente en el siguiente push.

La publicación no se considera completada hasta que el flujo termine en verde y la URL pública cargue correctamente.

## Principios

- Aplicación personal, sin funciones de punto de venta ni inventario comercial.
- Sin servicios externos de pago ni OCR remoto.
- Precios trazables, recientes y verificables.
- No almacenar secretos en el cliente.
- No borrar historial de compras al desactivar productos del catálogo.
