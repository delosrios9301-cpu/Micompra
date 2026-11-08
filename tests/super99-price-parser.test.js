import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSuper99ProductPage } from '../supabase/functions/sync-super99-prices/parser.js';

test('extrae precio final y valida SKU desde la ficha oficial', () => {
  const html = '<h1>Ketchup Maggi 397 g</h1><div>SKU 10087928</div><span data-price-amount="1.85" data-price-type="finalPrice">$1.85</span>';
  assert.deepEqual(parseSuper99ProductPage(html, '10087928'), {
    ok: true, title: 'Ketchup Maggi 397 g', sku: '10087928', price: 1.85, priceType: 'online_product_price'
  });
});

test('usa el precio por kilogramo para productos vendidos por peso', () => {
  const html = '<h1>Lechuga Americana por Kilo</h1><div>SKU 10154530</div><div>$4.29</div><div>Precio/Kilogramo</div><div>$2.15</div>';
  const result = parseSuper99ProductPage(html, '10154530', 'Por kilo; peso final por confirmar');
  assert.equal(result.ok, true);
  assert.equal(result.price, 2.15);
  assert.equal(result.priceType, 'online_unit_price_per_kg');
});

test('rechaza fichas cuyo SKU no coincide', () => {
  const html = '<h1>Producto equivocado</h1><div>SKU 99999999</div><span data-price-amount="2.50" data-price-type="finalPrice">$2.50</span>';
  assert.equal(parseSuper99ProductPage(html, '10000000').ok, false);
});

test('no inventa precio si la ficha no publica uno', () => {
  const html = '<h1>Producto sin precio</h1><div>SKU 10000000</div>';
  assert.equal(parseSuper99ProductPage(html, '10000000').ok, false);
});
