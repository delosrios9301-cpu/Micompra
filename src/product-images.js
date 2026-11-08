const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

export function buildProductImageSearchUrl(term) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: 'filetype:bitmap ' + String(term || '').trim(),
    gsrnamespace: '6',
    gsrlimit: '8',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '480',
    format: 'json',
    origin: '*'
  });
  return COMMONS_API + '?' + params.toString();
}

export function normalizeProductImageResults(payload) {
  const pages = Object.values(payload?.query?.pages || {});
  return pages
    .map(page => ({
      title: String(page.title || '').replace(/^File:/i, ''),
      url: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url || ''
    }))
    .filter(item => /^https:\/\//i.test(item.url) && item.title)
    .slice(0, 8);
}

export async function searchProductImages(term, { fetchImpl = globalThis.fetch } = {}) {
  const query = String(term || '').trim();
  if (query.length < 2) return [];
  if (typeof fetchImpl !== 'function') throw new Error('La búsqueda de imágenes no está disponible.');
  const response = await fetchImpl(buildProductImageSearchUrl(query), {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('No se pudo consultar Wikimedia Commons.');
  return normalizeProductImageResults(await response.json());
}
