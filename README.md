# Mi Compra 2.0

Mi Compra 2.0 es una aplicación nueva para organizar las compras del hogar, registrar importes reales, controlar existencias y administrar presupuestos.

## Experiencia principal

- **Inicio:** resumen financiero, presupuesto, listas activas, alertas de inventario y actividad reciente.
- **Planificar:** listas, cantidades, fechas, prioridades y presupuestos estimados.
- **Comprar:** captura manual de artículos y precios reales, descuentos, total y registro de pago.
- **Inventario:** existencias, ubicaciones, mínimos, vencimientos y movimientos de entrada/salida.
- **Finanzas:** presupuesto mensual y gastos adicionales sin contabilizar dos veces las compras.
- **Actividad:** historial centralizado de las operaciones.
- **Herramientas:** catálogo, establecimientos, reportes y configuración.

Las pantallas y la navegación de la versión anterior dejan de ser el punto de entrada de la aplicación. El código anterior permanece en el repositorio como respaldo técnico; no se importa desde el nuevo punto de entrada.

## Datos y sincronización

- Supabase Auth mantiene la sesión del usuario.
- Los datos de Mi Compra 2.0 se guardan bajo la propiedad miCompraV2 dentro del campo JSONB data de personal_workspace.
- La versión 2.0 conserva la información raíz anterior de esa fila y no la reemplaza completa.
- Las políticas RLS de personal_workspace deben seguir activas.
- Con sesión autenticada se sincroniza con la nube y Realtime; sin conexión se conserva una copia local temporal.
- No se eliminan tablas ni se migran automáticamente las listas antiguas a la nueva estructura.
- Antes de futuras migraciones se recomienda descargar un respaldo desde Configuración.

## Política de precios

Los precios se registran manualmente por la persona usuaria. No hay scraping, consultas de catálogos de supermercados ni actualización automática de precios.

## Desarrollo

1. Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY mediante variables de entorno.
2. Ejecuta npm install.
3. Ejecuta npm test.
4. Ejecuta npm run build.
5. Ejecuta npm run dev para desarrollo local.

No incluyas claves secretas ni claves service_role en el navegador. Utiliza una clave publishable con RLS correctamente configurado.

## Publicación

Los flujos de GitHub Actions existentes ejecutan pruebas, compilación y despliegue web. La aplicación Android usa el flujo de construcción separado.
