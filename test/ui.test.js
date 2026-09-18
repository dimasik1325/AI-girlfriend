import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => readFile(join(ROOT, rel), 'utf8');

/**
 * Статическая проверка связки: все селекторы из js/app.js должны существовать
 * в index.html (id/class) или создаваться самим приложением.
 */
const DYNAMIC_IDS = new Set(['typing-msg']);
const DYNAMIC_CLASSES = new Set(['msg', 'bubble', 'meta', 'action', 'typing-dots', 'selected', 'ok', 'active', 'done']);

test('все ID из app.js есть в index.html', async () => {
  const app = await read('js/app.js');
  const html = await read('index.html');
  const ids = new Set([...app.matchAll(/[$(]\('#([a-z0-9-]+)'\)/gi)].map((m) => m[1]));
  assert.ok(ids.size > 20, 'ожидалось много селекторов, найдено ' + ids.size);
  const missing = [...ids].filter((id) => !html.includes('id="' + id + '"') && !DYNAMIC_IDS.has(id));
  assert.deepEqual(missing, [], 'в index.html нет элементов: ' + missing.join(', '));
});

test('все классы из app.js есть в index.html или styles.css', async () => {
  const app = await read('js/app.js');
  const html = await read('index.html');
  const css = await read('styles.css');
  const classes = new Set(
    [...app.matchAll(/className = '([a-z0-9- ]+)'/gi)]
      .flatMap((m) => m[1].split(/\s+/))
      .concat([...app.matchAll(/classList\.(?:add|toggle|remove)\('([a-z0-9-]+)'/gi)].map((m) => m[1]))
      .filter(Boolean)
  );
  const missing = [...classes].filter(
    (cls) => !html.includes(cls) && !css.includes('.' + cls) && !DYNAMIC_CLASSES.has(cls)
  );
  assert.deepEqual(missing, [], 'классы без оформления: ' + missing.join(', '));
});

test('все обработчики навешиваются на существующие кнопки', async () => {
  const app = await read('js/app.js');
  const html = await read('index.html');
  const handlers = [...app.matchAll(/\$\('#(btn-[a-z0-9-]+)'\)\.addEventListener/gi)].map((m) => m[1]);
  assert.ok(handlers.length >= 8, 'мало обработчиков: ' + handlers.length);
  for (const id of handlers) {
    assert.ok(html.includes('id="' + id + '"'), 'нет кнопки #' + id);
  }
});

test('app.js использует все четыре настроения аватара', async () => {
  const app = await read('js/app.js');
  assert.match(app, /assets\/her\/'\s*\+\s*safe\s*\+\s*'.jpg/);
  for (const mood of ['smile', 'shy', 'flirt', 'sad']) {
    await readFile(join(ROOT, 'assets/her', mood + '.jpg'));
    assert.ok(mood.length > 0);
  }
});

test('в шагах мастера ровно четыре экрана и они переключаются по data-step', async () => {
  const html = await read('index.html');
  const steps = [...html.matchAll(/<div class="step" data-step="(\d)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(steps, [0, 1, 2, 3]);
  const dots = [...html.matchAll(/<li data-step="(\d)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(dots, [0, 1, 2, 3]);
  assert.match(html, /hidden>\s*<h2>Придумай ей имя</);
});
