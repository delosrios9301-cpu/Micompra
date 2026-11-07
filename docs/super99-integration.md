# Integración de Super 99

Fuente oficial: https://www.super99.com/nuestra-tienda-en-linea
Términos oficiales: https://www.super99.com/terminos-y-condiciones

## Hallazgos verificados
- La tienda en línea publica catálogo, ofertas y precios.
- La disponibilidad depende de inventario de sucursal; los términos enumeran Brisas del Golf, Costa del Este, San Francisco y Transístmica para retiro/entrega.
- Los precios publicados no incluyen ITBMS.
- Los precios de productos vendidos por kilogramo pueden ser aproximados.
- Los precios y contenidos pueden cambiar.
- Los términos restringen copiar, reproducir, reutilizar, explotar o distribuir contenido del sitio para fines públicos o comerciales sin autorización expresa y por escrito.

## Regla de integración
No desplegar scraping ni reutilización automatizada del catálogo/precios hasta obtener autorización escrita de Super 99 o confirmar un mecanismo oficial/API con licencia que permita este uso.

## Camino seguro
1. Solicitar permiso y especificaciones de API/feed a Super 99.
2. Si autorizan, implementar con límite de frecuencia, atribución, URL de producto, fecha/hora, sucursal, precio regular/promocional y tratamiento de ITBMS.
3. Si no autorizan, dejar el conector como pendiente y admitir precios ingresados por el usuario con comprobante/enlace, sin presentarlos como feed automático.
4. No comparar productos por peso o tamaño sin normalizar unidad y presentación.

Estado actual: fuente oficial localizada; automatización no autorizada ni implementada.