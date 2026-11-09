import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Permanently disabled: Mi Compra records prices manually.
 * This endpoint intentionally performs no outbound requests and does not
 * access Supabase or write price observations.
 */
Deno.serve((req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }

  return new Response(JSON.stringify({
    ok: false,
    disabled: true,
    reason: "Mi Compra funciona con precios ingresados manualmente. La sincronización automática de supermercados está deshabilitada."
  }), {
    status: 410,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
});
