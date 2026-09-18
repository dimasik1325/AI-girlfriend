import test from 'node:test';
import assert from 'node:assert/strict';

import { memoryStorage } from './helpers.js';
import {
  PROVIDERS,
  detectProviders,
  guessProvider,
  modelList,
  buildChatRequest,
  requestHeaders,
  extractText,
  extractError,
  chatOnce,
  pickWorkingProvider,
} from '../js/providers.js';

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('detectProviders: сервер -> браузер -> ссылка -> офлайн, без дублей', () => {
  const storage = memoryStorage({ 'aigf.key.openrouter': 'sk-or-test' });
  const found = detectProviders({
    server: { providerId: 'openai', model: 'gpt-4o-mini' },
    storage,
    query: new URLSearchParams('provider=groq&key=gsk_test'),
  });
  assert.deepEqual(found.map((f) => f.id), ['openai', 'openrouter', 'groq', 'local']);
  assert.equal(found[0].source, 'server');
  assert.equal(found[1].source, 'browser');
  assert.equal(found[2].source, 'url');
  assert.equal(found[3].source, 'offline');
});

test('detectProviders без ключей оставляет только встроенный движок', () => {
  const found = detectProviders({ storage: memoryStorage(), query: new URLSearchParams('') });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'local');
});

test('detectProviders берёт ключ из localStorage и не падает на битом хранилище', () => {
  const broken = {
    getItem: () => {
      throw new Error('SecurityError');
    },
  };
  const found = detectProviders({ storage: broken });
  assert.deepEqual(found.map((f) => f.id), ['local']);
});

test('guessProvider угадывает по префиксу ключа', () => {
  assert.equal(guessProvider('sk-or-abc'), 'openrouter');
  assert.equal(guessProvider('gsk_abc'), 'groq');
  assert.equal(guessProvider('sk-abc'), 'openai');
  assert.equal(guessProvider('whatever'), 'openai');
});

test('modelList отдаёт модели провайдера и дефолт для локального', () => {
  assert.ok(modelList('openai').length > 0);
  assert.deepEqual(modelList('local'), ['local']);
  assert.ok(PROVIDERS.length === 3);
});

test('buildChatRequest и заголовки OpenRouter', () => {
  const body = buildChatRequest({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(body.model, 'gpt-4o-mini');
  assert.equal(body.max_tokens, 300);
  const headers = requestHeaders({ providerId: 'openrouter', key: 'sk-or-x' });
  assert.equal(headers.Authorization, 'Bearer sk-or-x');
  assert.equal(headers['X-Title'], 'AI Girlfriend');
  assert.equal(requestHeaders({ providerId: 'openai', key: 'sk-x' })['X-Title'], undefined);
});

test('extractText и extractError разбирают ответы провайдеров', () => {
  assert.equal(extractText({ choices: [{ message: { content: 'привет' } }] }), 'привет');
  assert.equal(extractText({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(extractText({}), '');
  assert.equal(extractError({ error: { message: 'нет ключа' } }), 'нет ключа');
  assert.equal(extractError({ error: 'упс' }), 'упс');
  assert.equal(extractError(null, 'fallback'), 'fallback');
});

test('chatOnce: успех через серверный прокси', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return jsonResponse(200, { choices: [{ message: { content: 'Привет, любимый' } }] });
  };
  const res = await chatOnce({
    providerId: 'openai',
    key: '',
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'привет' }],
    mode: 'server',
    fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(res.text, 'Привет, любимый');
  assert.equal(calls[0].url, '/api/chat');
  assert.equal(calls[0].opts.headers.Authorization, undefined);
});

test('chatOnce: ошибка 401 возвращается текстом, а сеть помечается флагом', async () => {
  const unauthorized = await chatOnce({
    providerId: 'openai',
    key: 'sk-bad',
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'привет' }],
    mode: 'direct',
    fetchImpl: async () => jsonResponse(401, { error: { message: 'Incorrect API key provided' } }),
  });
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.error, /Incorrect API key/);
  assert.equal(unauthorized.network, false);

  const offline = await chatOnce({
    providerId: 'groq',
    key: 'gsk_x',
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: 'привет' }],
    mode: 'direct',
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(offline.ok, false);
  assert.equal(offline.network, true);
});

test('pickWorkingProvider предпочитает сервер, при отказе идёт напрямую', async () => {
  const fetchImpl = async (url) => {
    if (url === '/api/chat') return jsonResponse(503, { error: { message: 'ключ не настроен' } });
    return jsonResponse(200, { choices: [{ message: { content: 'ок' } }] });
  };
  const pick = await pickWorkingProvider({
    candidates: detectProviders({ storage: memoryStorage({ 'aigf.key.openai': 'sk-test' }) }),
    fetchImpl,
  });
  assert.equal(pick.providerId, 'openai');
  assert.equal(pick.mode, 'direct');
  assert.equal(pick.model, 'gpt-4o-mini');
  assert.equal(pick.tried.length, 1);
  assert.match(pick.tried[0].error, /ключ не настроен/);
});

test('pickWorkingProvider падает на встроенный движок, когда все ключи мертвы', async () => {
  const pick = await pickWorkingProvider({
    candidates: detectProviders({ storage: memoryStorage({ 'aigf.key.openai': 'sk-dead' }) }),
    fetchImpl: async () => jsonResponse(401, { error: { message: 'bad key' } }),
  });
  assert.equal(pick.providerId, 'local');
  assert.equal(pick.mode, 'local');
  assert.equal(pick.tried.length, 2); // server + direct
});

test('pickWorkingProvider без ключей сразу выбирает офлайн', async () => {
  let called = 0;
  const pick = await pickWorkingProvider({
    candidates: detectProviders({ storage: memoryStorage() }),
    fetchImpl: async () => {
      called += 1;
      return jsonResponse(200, {});
    },
  });
  assert.equal(pick.providerId, 'local');
  assert.equal(called, 0);
});

test('pickWorkingProvider уважает предпочитаемую модель', async () => {
  const seen = [];
  const pick = await pickWorkingProvider({
    candidates: detectProviders({ storage: memoryStorage({ 'aigf.key.openai': 'sk-test' }) }),
    preferredModel: 'gpt-4o',
    fetchImpl: async (url, opts) => {
      seen.push(JSON.parse(opts.body).model);
      return jsonResponse(200, { choices: [{ message: { content: 'ок' } }] });
    },
  });
  assert.deepEqual(seen, ['gpt-4o']);
  assert.equal(pick.model, 'gpt-4o');
});
