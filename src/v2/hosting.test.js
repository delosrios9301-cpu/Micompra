import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Firebase Hosting utiliza la raíz del dominio y GitHub Pages su subcarpeta', async () => {
  const vite = await read('../../vite.config.js');
  const firebase = await read('../../.github/workflows/firebase-hosting.yml');
  const pages = await read('../../.github/workflows/deploy.yml');
  assert.match(vite, /CAPACITOR_BUILD === 'true' \? '\.\/' : '\/'/);
  assert.match(firebase, /Build Vite for production \(Firebase root\)[\s\S]*?VITE_BASE_PATH: \//);
  assert.match(firebase, /Verify that all application scripts use Firebase root paths/);
  assert.match(pages, /VITE_BASE_PATH: \/Micompra\//);
});

test('HTML contiene indicador de inicio visible incluso si falla el JavaScript', async () => {
  const html = await read('../../index.html');
  assert.match(html, /<div id="app"[^>]*>[\s\S]*?Iniciando la aplicación…/);
  assert.match(html, /Recargar Mi Compra/);
  assert.match(html, /<script type="module" src="\/src\/v2\/app\.js"><\/script>/);
});
