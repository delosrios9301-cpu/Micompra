import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('./app-refresh.css', import.meta.url), 'utf8');

test('the five primary destinations match the product design', () => {
  const block = main.match(/const navItems=\[([\s\S]*?)\];/);
  assert.ok(block, 'primary navigation declaration exists');
  const ids = [...block[1].matchAll(/\{id:'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(ids, ['inicio', 'comprar', 'comparar', 'historial', 'mas']);
});

test('home and secondary modules have independent screens', () => {
  for (const marker of [
    'panels.inicio.innerHTML=',
    'panels.mas.innerHTML=',
    'panels.compras.appendChild(purchaseLedger)',
    'panels.despensa.innerHTML=',
    'panels.gastos.innerHTML=',
    'panels.configuracion.innerHTML=',
    'panels.catalogo.innerHTML='
  ]) assert.ok(main.includes(marker), 'missing screen marker: ' + marker);
});

test('secondary screens can return to More without changing the main navigation', () => {
  assert.ok(main.includes('back.dataset.returnMore='));
  assert.ok(main.includes("openView('mas','mas')"));
  assert.ok(main.includes("openView(target,navKey)"));
});

test('local purchase receipts live in history, not in the checkout panel', () => {
  assert.ok(main.includes('id="local-purchase-history"'));
  assert.ok(main.includes('historyHost.innerHTML='));
  assert.ok(main.includes("historyHost?.querySelectorAll('[data-print-purchase]')"));
  assert.ok(main.includes("historyHost?.querySelectorAll('[data-add-purchase-inventory]')"));
  assert.ok(!main.includes('details class="purchase-history"'));
});

test('the visual system covers home, More, phone navigation and desktop sidebar', () => {
  for (const marker of [
    '.home-welcome',
    '.home-quick-grid',
    '.more-module-grid',
    '@media (min-width: 900px)',
    '@media (max-width: 760px)',
    'position: fixed'
  ]) assert.ok(styles.includes(marker), 'missing responsive design rule: ' + marker);
});

test('legacy links do not point to removed primary destinations', () => {
  assert.ok(!main.includes('[data-nav-key="compras"]'));
  assert.ok(!main.includes('[data-open-view="catalogo"]'));
  assert.ok(!main.includes('data-more-view="cuenta"'));
});
