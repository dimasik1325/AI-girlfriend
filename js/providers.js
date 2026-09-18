/**
 * Провайдеры нейросетей + автоматический выбор доступного ключа.
 * Порядок выбора: ключ на сервере (server.js + .env) -> ключ в браузере
 * (localStorage или ?key=...) -> встроенный офлайн-движок.
 */

export const PROVIDERS = [
  {
    id: 'openai',
    title: 'OpenAI (ChatGPT)',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    placeholder: 'sk-...',
    hint: 'Ключ с platform.openai.com/api-keys',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  },
  {
    id: 'openrouter',
    title: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    placeholder: 'sk-or-...',
    hint: 'Ключ с openrouter.ai/keys, внутри есть и бесплатные модели',
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-haiku',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat-v3-0324:free',
    ],
  },
  {
    id: 'groq',
    title: 'Groq (быстро и бесплатно)',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    placeholder: 'gsk_...',
    hint: 'Ключ с console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
];

export const LOCAL_PROVIDER = { id: 'local', title: 'Встроенная (офлайн, без ключа)', models: ['local'] };

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

export function modelList(providerId) {
  const p = providerById(providerId);
  return p ? p.models : [LOCAL_PROVIDER.models[0]];
}

function readStorage(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return '';
    const v = String(raw).trim();
    return v;
  } catch {
    return '';
  }
}

/**
 * Собирает все найденные ключи.
 * @param {{server?: {providerId, model}, storage?: Storage, query?: URLSearchParams,
 *          urlKeyProvider?: string}} env
 * @returns {{id: string, key: string, source: string, model?: string}[]}
 */
export function detectProviders(env = {}) {
  const found = [];
  const server = env.server;
  if (server && server.providerId && server.providerId !== 'local') {
    found.push({ id: server.providerId, key: '', source: 'server', model: server.model || '' });
  }
  const storage = env.storage;
  if (storage) {
    for (const p of PROVIDERS) {
      const key = readStorage(storage, 'aigf.key.' + p.id);
      if (key) found.push({ id: p.id, key, source: 'browser' });
    }
  }
  const query = env.query;
  if (query) {
    const key = (query.get('key') || '').trim();
    if (key) {
      const pid = (query.get('provider') || '').trim();
      found.push({ id: pid || guessProvider(key), key, source: 'url' });
    }
  }
  // без дублей: один провайдер — одна запись, приоритет у первого найденного источника
  const seen = new Set();
  const unique = [];
  for (const item of found) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  // встроенный движок — всегда последний запасной вариант
  unique.push({ id: 'local', key: '', source: 'offline' });
  return unique;
}

/** По формату ключа угадывает провайдера. */
export function guessProvider(key = '') {
  const k = String(key).trim();
  if (/^sk-or-/i.test(k)) return 'openrouter';
  if (/^gsk_/i.test(k)) return 'groq';
  if (/^sk-/i.test(k)) return 'openai';
  return PROVIDERS[0].id;
}

/** Тело запроса одинаковое у всех трёх провайдеров — это OpenAI-совместимый API. */
export function buildChatRequest({ model, messages, temperature = 0.9 }) {
  return { model, messages, temperature, max_tokens: 300 };
}

export function requestHeaders({ providerId, key }) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  if (providerId === 'openrouter') {
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://ai-girlfriend.local';
    headers['X-Title'] = 'AI Girlfriend';
  }
  return headers;
}

export function extractText(payload) {
  const choice = payload && payload.choices && payload.choices[0];
  const msg = choice && (choice.message || choice.delta);
  if (msg && typeof msg.content === 'string') return msg.content;
  if (msg && Array.isArray(msg.content)) {
    return msg.content.map((part) => (part && part.text) || '').join('');
  }
  return '';
}

export function extractError(payload, fallback = 'Неизвестная ошибка провайдера') {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  if (payload.error) {
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error.message) return payload.error.message;
  }
  if (payload.message) return payload.message;
  return fallback;
}

function isNetworkFailure(err) {
  if (!err) return false;
  const name = err.name || '';
  return name === 'TypeError' || name === 'AbortError' || /network|fetch|failed/i.test(String(err.message || ''));
}

/**
 * Пытается отправить сообщение.
 * Режимы: 'server' (POST /api/chat на нашем сервере), 'direct' (браузер -> провайдер).
 * @returns {Promise<{ok: boolean, mode: string, text?: string, error?: string, network?: boolean}>}
 */
export async function chatOnce({ providerId, key, model, messages, mode = 'direct', temperature, fetchImpl }) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, mode, error: 'В этом окружении нет fetch', network: false };
  const provider = providerById(providerId);
  if (!provider) return { ok: false, mode, error: 'Неизвестный провайдер: ' + providerId };

  const body = buildChatRequest({ model, messages, temperature });
  const url = mode === 'server' ? '/api/chat' : provider.endpoint;
  const headers = mode === 'server' ? { 'Content-Type': 'application/json' } : requestHeaders({ providerId, key });

  try {
    const res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok) {
      return { ok: false, mode, error: extractError(payload, 'HTTP ' + res.status), network: false };
    }
    const text = extractText(payload);
    if (!text.trim()) return { ok: false, mode, error: 'Пустой ответ модели', network: false };
    return { ok: true, mode, text };
  } catch (err) {
    const network = isNetworkFailure(err);
    return { ok: false, mode, error: String((err && err.message) || err), network };
  }
}

/**
 * Автоматический выбор рабочего провайдера: перебирает найденные ключи и режимы
 * (сервер -> прямой запрос из браузера) и возвращает первый, который ответил.
 * @returns {Promise<{providerId: string, key: string, mode: string, model: string, source: string,
 *                    tried: {providerId: string, mode: string, error?: string}[]}>}
 */
export async function pickWorkingProvider({ candidates, preferredModel, fetchImpl }) {
  const tried = [];
  for (const cand of candidates) {
    if (cand.id === 'local') {
      return {
        providerId: 'local',
        key: '',
        mode: 'local',
        model: LOCAL_PROVIDER.models[0],
        source: cand.source || 'offline',
        tried,
      };
    }
    if (!cand.key && cand.source !== 'server') {
      tried.push({ providerId: cand.id, mode: 'skip', error: 'нет ключа' });
      continue;
    }
    const available = modelList(cand.id);
    const model = preferredModel && available.includes(preferredModel) ? preferredModel : available[0];
    const probe = [{ role: 'user', content: 'Привет' }];

    const viaServer = await chatOnce({
      providerId: cand.id,
      key: cand.key,
      model,
      messages: probe,
      mode: 'server',
      temperature: 0.3,
      fetchImpl,
    });
    if (viaServer.ok) {
      return { providerId: cand.id, key: cand.key, mode: 'server', model, source: cand.source, tried };
    }
    tried.push({ providerId: cand.id, mode: 'server', error: viaServer.error });

    if (cand.key) {
      const direct = await chatOnce({
        providerId: cand.id,
        key: cand.key,
        model,
        messages: probe,
        mode: 'direct',
        temperature: 0.3,
        fetchImpl,
      });
      if (direct.ok) {
        return { providerId: cand.id, key: cand.key, mode: 'direct', model, source: cand.source, tried };
      }
      tried.push({ providerId: cand.id, mode: 'direct', error: direct.error });
    }
  }
  return { providerId: 'local', key: '', mode: 'local', model: LOCAL_PROVIDER.models[0], source: 'offline', tried };
}
