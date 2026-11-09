# Mi Compra

Aplicación personal para organizar compras del hogar y comparar precios registrados manualmente en Panamá.

## Secciones principales

- **Comprar:** crear y administrar una lista, indicar supermercado, cantidad y precio; el total se actualiza automáticamente.
- **Comparar:** comparar el mismo producto y presentación entre supermercados utilizando los registros guardados.
- **Productos:** mantener un catálogo personal con nombre, presentación, categoría, unidad, supermercado, precio habitual y fotografía opcional.
- **Mis compras:** finalizar una compra, registrar la forma de pago, consultar el historial e imprimir comprobantes personales.
- **Ajustes:** administrar supermercados, moneda, apariencia, cuenta, copias de seguridad y preferencias.

La cuenta también dispone de herramientas personales de historial, gastos y despensa.

## Política de precios y fuentes

Mi Compra funciona en modo manual. La persona usuaria registra los productos y sus precios; también puede importar archivos CSV cuando corresponda. Los registros que requieren revisión deben aprobarse antes de considerarse datos verificados.

La aplicación no consulta páginas de supermercados ni extrae automáticamente sus catálogos o precios. El flujo de sincronización de precios de supermercados está deshabilitado por diseño. No debe habilitarse ningún conector de extracción sin autorización escrita y una fuente oficial cuyo uso esté permitido.

Las comparaciones solo son válidas cuando coinciden el producto y su presentación. Un total calculado a partir del catálogo no representa necesariamente una compra real. El comprobante generado por la aplicación es personal y no fiscal.

## Datos, cuenta y sincronización

- Supabase es el servicio de autenticación y almacenamiento central.
- El espacio personal sincroniza catálogo, lista, compras personales, despensa y preferencias entre dispositivos cuando hay una sesión autenticada y conexión disponible.
- Sin iniciar sesión, la información se conserva en el almacenamiento local del dispositivo.
- Configuración permite descargar una copia de seguridad JSON y restaurarla.
- No se deben borrar ni recrear tablas o datos de producción como parte de un rediseño visual.
- Las políticas RLS de Supabase deben permanecer activas.

La sincronización no sustituye las copias de seguridad. Antes de operaciones de mantenimiento o cambios de estructura, conserva una copia actualizada.

## Desarrollo local

1. Copia `.env.example` a `.env.local`.
2. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Instala las dependencias con `npm install`.
4. Ejecuta las pruebas con `npm test`.
5. Inicia el entorno local con `npm run dev`.
6. Genera la versión web de producción con `npm run build`.

No publiques claves secretas ni la clave `service_role` en el navegador. La aplicación cliente debe utilizar únicamente la clave publicable y las políticas RLS.

## Publicación web y Android

- El flujo `.github/workflows/deploy.yml` ejecuta pruebas, compila y publica en GitHub Pages al actualizar `main`.
- El flujo `.github/workflows/build.yml` ejecuta las pruebas y verifica la compilación.
- El flujo `.github/workflows/build-android.yml` compila un APK Android de depuración y lo publica como artefacto de GitHub Actions.

La publicación web o el APK solo deben considerarse listos cuando el flujo correspondiente termine correctamente. Una compilación exitosa no sustituye las pruebas de uso real en teléfono y tableta.

## Principios del proyecto

- Mantener la aplicación sencilla, rápida y priorizar el uso desde el teléfono.
- Conservar los datos existentes y preferir cambios compatibles con versiones anteriores.
- No introducir precios automáticos ni depender de páginas de supermercados.
- No procesar pagos reales: la aplicación registra la forma de pago declarada por la persona usuaria.
- Validar los datos antes de guardarlos y mostrar errores comprensibles.
- Evitar almacenar secretos en el código cliente.
- Desactivar productos del catálogo sin eliminar el historial de compras relacionado.
