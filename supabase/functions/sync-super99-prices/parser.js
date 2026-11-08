export function parseSuper99ProductPage(html, expectedSku, packageDescription = '') {
  if (typeof html !== 'string' || !html) return { ok: false, reason: 'Página vacía' };
  const sku = String(expectedSku || '').trim();
  if (!sku) return { ok: false, reason: 'SKU no configurado' };

  const skuPattern = new RegExp('\\bSKU\\s*(?:[:#-]\\s*)?' + sku.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\b', 'i');
  if (!skuPattern.test(html.replace(/<[^>]*>/g, ' '))) {
    return { ok: false, reason: 'El SKU de la página no coincide' };
  }

  const titleMatch = html.match(/<h1\\b[^>]*>([\\s\\S]*?)<\\/h1>/i);
  const title = titleMatch ? decodeText(titleMatch[1]) : '';
  if (!title) return { ok: false, reason: 'La ficha no contiene un nombre de producto' };

  const weighted = /\\b(por\\s*kilo|kilogram|\\bkg\\b|peso)\\b/i.test(title + ' ' + packageDescription);
  let price = null;
  let priceType = 'online_product_price';

  if (weighted) {
    const unitMatch = html.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ')
      .match(/Precio\\s*\\/\\s*Kilogramo[\\s\\S]{0,180}?\\$\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)/i);
    if (!unitMatch) return { ok: false, reason: 'No se encontró un precio por kilogramo verificable', title, sku };
    price = toNumber(unitMatch[1]);
    priceType = 'online_unit_price_per_kg';
  } else {
    price = findFinalPrice(html);
    if (price === null) {
      const skuIndex = html.search(skuPattern);
      const nearProduct = html.slice(skuIndex, skuIndex + 7000);
      const visiblePrices = [...nearProduct.matchAll(/\\$\\s*([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)/g)];
      if (visiblePrices.length) price = toNumber(visiblePrices[0][1]);
    }
  }

  if (!Number.isFinite(price) || price <= 0 || price > 10000) {
    return { ok: false, reason: 'No se pudo extraer un precio válido', title, sku };
  }
  return { ok: true, title, sku, price: Number(price.toFixed(2)), priceType };
}

function findFinalPrice(html) {
  const tags = html.match(/<span\\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/data-price-type\\s*=\\s*["']finalPrice["']/i.test(tag)) continue;
    const amount = tag.match(/data-price-amount\\s*=\\s*["']([0-9.,]+)["']/i);
    if (amount) return toNumber(amount[1]);
  }

  const metas = html.match(/<meta\\b[^>]*>/gi) || [];
  for (const tag of metas) {
    if (!/(?:product:price:amount|og:price:amount)/i.test(tag)) continue;
    const content = tag.match(/content\\s*=\\s*["']([0-9.,]+)["']/i);
    if (content) return toNumber(content[1]);
  }

  const scripts = [...html.matchAll(/<script[^>]*type=["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi)];
  for (const script of scripts) {
    try {
      const data = JSON.parse(script[1]);
      const candidates = Array.isArray(data) ? data : [data];
      for (const item of candidates) {
        const offers = Array.isArray(item?.offers) ? item.offers : [item?.offers];
        for (const offer of offers) {
          const value = Number(offer?.price ?? offer?.lowPrice);
          if (Number.isFinite(value) && value > 0) return value;
        }
      }
    } catch { /* Ignora bloques JSON-LD incompletos. */ }
  }
  return null;
}

function toNumber(value) {
  const normalized = String(value).replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeText(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\s+/g, ' ')
    .trim();
}
