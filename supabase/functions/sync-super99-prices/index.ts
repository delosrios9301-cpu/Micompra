import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseSuper99ProductPage } from "./parser.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const { data: claimed, error: claimError } = await supabase.rpc("claim_super99_price_sync");
  if (claimError) return json({ error: "No se pudo reservar la ejecución", detail: claimError.message }, 500);
  if (!claimed) return json({ ok: true, skipped: true, reason: "La sincronización ya se ejecutó recientemente o hay otra en curso." }, 202);

  const stats = { checked: 0, saved: 0, unchanged: 0, skipped: 0, errors: [] as string[] };
  try {
    const { data: listings, error } = await supabase
      .from("store_products")
      .select("id,source_product_name,source_product_url,source_sku,package_description")
      .not("source_product_url", "is", null)
      .not("source_sku", "is", null)
      .eq("supermarkets.name", "Super 99")
      .select("id,source_product_name,source_product_url,source_sku,package_description,supermarkets!inner(name)")
      .order("source_product_name")
      .limit(100);

    if (error) throw error;

    for (const listing of listings || []) {
      stats.checked++;
      const url = listing.source_product_url;
      try {
        const response = await fetch(url, {
          headers: {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "MiCompraPersonal/1.0 (price freshness check)"
          },
          signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) {
          stats.skipped++;
          stats.errors.push(listing.source_sku + ": HTTP " + response.status);
          continue;
        }
        const html = await response.text();
        const parsed = parseSuper99ProductPage(html, listing.source_sku, listing.package_description || "");
        if (!parsed.ok) {
          stats.skipped++;
          stats.errors.push(listing.source_sku + ": " + parsed.reason);
          continue;
        }

        const { data: latest, error: latestError } = await supabase
          .from("price_observations")
          .select("price,observed_at,review_status,is_verified")
          .eq("store_product_id", listing.id)
          .order("observed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestError) throw latestError;

        const isSameRecent = latest
          && latest.is_verified
          && latest.review_status === "approved"
          && Number(latest.price) === parsed.price
          && Date.now() - new Date(latest.observed_at).getTime() < 6 * 60 * 60 * 1000;

        await supabase.from("store_products")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", listing.id);

        if (isSameRecent) {
          stats.unchanged++;
          continue;
        }

        const reviewNote = parsed.priceType === "online_unit_price_per_kg"
          ? "Captura automática de ficha oficial de Super 99. Precio publicado en línea por kilogramo; el importe final depende del peso."
          : "Captura automática de ficha oficial de Super 99. Precio publicado exclusivamente para compras en línea.";

        const { error: insertError } = await supabase.from("price_observations").insert({
          store_product_id: listing.id,
          price: parsed.price,
          currency: "USD",
          source_url: url,
          observed_at: new Date().toISOString(),
          is_verified: true,
          review_status: "approved",
          reviewed_at: new Date().toISOString(),
          reviewed_by: null,
          review_note: reviewNote,
          availability: parsed.priceType
        });
        if (insertError) throw insertError;
        stats.saved++;
      } catch (error) {
        stats.skipped++;
        stats.errors.push(listing.source_sku + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }

    await supabase.from("price_sync_control")
      .update({ last_run_at: new Date().toISOString(), lock_until: null })
      .eq("id", 1);

    return json({ ok: true, source: "Super 99", ...stats, completed_at: new Date().toISOString() });
  } catch (error) {
    await supabase.from("price_sync_control").update({ lock_until: null }).eq("id", 1);
    return json({ error: error instanceof Error ? error.message : String(error), ...stats }, 500);
  }
});
