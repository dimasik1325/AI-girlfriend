import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PORT = '0';
const { server, ROOT } = await import('../server.js');

async function listen() {
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  return 'http://127.0.0.1:' + port;
}

const base = await listen();

/**
 * Клиентские запросы к нашему серверу ходят настоящим fetch:
 * в тестах прокси мы подменяем globalThis.fetch, чтобы перехватить уход к LLM.
 */
const clientFetch = globalThis.fetch;

test.after(() => server.close());

test('GET /api/health отвечает ok', async () => {
  const res = await clientFetch(base + '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, name: 'AI Girlfriend' });
});

test('GET / отдаёт главную страницу с мастером и чатом', async () => {
  const res = await clientFetch(base + '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /AI Girlfriend/);
  assert.match(html, /id="screen-setup"/);
  assert.match(html, /id="screen-chat"/);
  assert.match(html, /id="sliders"/);
  assert.match(html, /Настрой её характер/);
  assert.match(html, /Придумай ей имя/);
  assert.match(html, /Как тебя зовут\?/);
});

test('GET /styles.css и /js/app.js отдаются со своими MIME', async () => {
  const css = await clientFetch(base + '/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const js = await clientFetch(base + '/js/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('GET /assets/her/*.jpg отдаёт аватары настроений', async () => {
  for (const mood of ['smile', 'shy', 'flirt', 'sad']) {
    const res = await clientFetch(base + '/assets/her/' + mood + '.jpg');
    assert.equal(res.status, 200, 'нет аватара ' + mood);
    assert.match(res.headers.get('content-type'), /image\/jpeg/);
  }
});

test('статика не даёт выйти за пределы папки проекта', async () => {
  const res = await clientFetch(base + '/..%2f..%2fpackage.json');
  assert.ok(res.status === 404 || res.status === 403, 'ожидали 404/403, получили ' + res.status);
  const inside = await clientFetch(base + '/server.js');
  assert.equal(inside.status, 200);
});

test('без ключа сервер честно говорит, что ключ не настроен', async () => {
  delete process.env.LLM_API_KEY;
  const cfg = await clientFetch(base + '/api/config');
  const cfgBody = await cfg.json();
  assert.equal(cfgBody.serverKey, false);
  assert.deepEqual(cfgBody.providers, ['openai', 'openrouter', 'groq']);

  const res = await clientFetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'привет' }] }),
  });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.match(body.error.message, /LLM_API_KEY/);
});

test('с ключом сервер проксирует запрос к провайдеру', async (t) => {
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_API_KEY = 'sk-server-test';
  process.env.LLM_MODEL = 'gpt-4o-mini';

  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    seen.push({ url, opts });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Привет, Дима' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const cfgBody = await (await clientFetch(base + '/api/config')).json();
  assert.equal(cfgBody.serverKey, true);
  assert.equal(cfgBody.providerId, 'openai');

  const res = await clientFetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'привет' }] }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { choices: [{ message: { content: 'Привет, Дима' } }] });
  assert.equal(seen[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(seen[0].opts.headers.Authorization, 'Bearer sk-server-test');
});

test('сервер отклоняет пустой список сообщений', async () => {
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_API_KEY = 'sk-server-test';
  const res = await clientFetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] }),
  });
  assert.equal(res.status, 400);
});

test('все файлы из index.html реально лежат на диске', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:css|js|png|jpg))"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4, 'ожидались ссылки на ресурсы: ' + JSON.stringify(refs));
  assert.ok(refs.includes('styles.css'));
  assert.ok(refs.includes('js/app.js'));
  for (const ref of refs) {
    if (/^https?:/.test(ref)) continue;
    await readFile(join(ROOT, ref));
  }
});

test('index.html ссылается на все модули js/', async () => {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /js\/app\.js/);
  const app = await readFile(join(ROOT, 'js/app.js'), 'utf8');
  for (const mod of ['./store.js', './providers.js', './prompt.js', './local.js']) {
    assert.ok(app.includes(mod), 'app.js не импортирует ' + mod);
  }
});

test('в репозитории нет файла с реальным ключом', async () => {
  const files = ['server.js', 'js/providers.js', 'js/app.js'];
  for (const f of files) {
    const src = await readFile(join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /sk-[A-Za-z0-9]{20,}/, 'похоже на настоящий ключ в ' + f);
  }
});
