# Mi Compra 2.0

Aplicación web progresiva para organizar compras del hogar, registrar precios reales, controlar existencias y administrar presupuestos.

## Módulos
- **Inicio:** resumen financiero, listas activas, alertas y actividad reciente.
- **Planificar:** listas, cantidades, fechas, prioridades y presupuestos estimados.
- **Comprar:** captura de artículos, precios, descuentos, total y registro de pago.
- **Inventario:** existencias, ubicaciones, mínimos, vencimientos y movimientos.
- **Finanzas:** presupuesto mensual y gastos adicionales.
- **Actividad:** historial centralizado.
- **Herramientas:** catálogo, establecimientos, reportes y configuración.

## Arquitectura y datos
- Firebase Authentication administra las sesiones.
- Cloud Firestore almacena el documento compartido en `userWorkspaces` y las membresías en `workspaceAccess`.
- La cuenta propietaria es la única que puede invitar miembros, restablecer el espacio y restaurar respaldos.
- Los miembros autenticados pueden trabajar con los datos del espacio, pero no cambiar la identidad del propietario ni ejecutar el restablecimiento total.
- Las escrituras usan transacciones; los cambios locales pendientes se preservan al recibir instantáneas remotas.
- Las eliminaciones se propagan mediante tombstones por registro (incluidos artículos dentro de listas), para que un dispositivo atrasado no restaure datos borrados.
- El restablecimiento completo es transaccional y escribe tombstones antes de vaciar el espacio.
- La sesión escucha en tiempo real la membresía y la lista de revocaciones; al revocarse el acceso, cierra sesión y limpia el estado cargado.
- El importador de Supabase se carga de forma diferida y las dependencias Firebase/Supabase se separan en chunks para mejorar caché y carga.
- Supabase JS permanece únicamente como importador de datos heredados, si las variables antiguas están configuradas.

## Seguridad
Las reglas de `firestore.rules` deben publicarse junto con cada despliegue. No incluyas claves privadas ni cuentas de servicio en el navegador. La autorización crítica se valida en la aplicación y también en las reglas de Firestore.

## Instalar en el teléfono
Mi Compra 2.0 incluye manifest y service worker para instalación como aplicación web progresiva (PWA). Abre `https://mi-compra-d9717.web.app` en Chrome Android, inicia sesión y usa el menú ⋮ → **Instalar aplicación** o **Agregar a pantalla principal**. Si no aparece, actualiza la página después del despliegue y vuelve a abrirla desde Chrome.

## Desarrollo
1. Instala dependencias con `npm install`.
2. Ejecuta pruebas con `npm test`.
3. Compila con `npm run build`.
4. Ejecuta localmente con `npm run dev`.

## Publicación
GitHub Actions ejecuta las pruebas, construye la aplicación, publica las reglas de Firestore y despliega Firebase Hosting.
