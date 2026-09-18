/**
 * Провайдеры нейросетей + автоматический выбор доступного ключа.
 * Порядок выбора: ключ на сервере (server.js + .env) -> ключ в браузере
 * (localStorage или ?key=...) -> встроенный офлайн-движок.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else {
    root.AIGF = root.AIGF || {};
    root.AIGF.providers = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PROVIDERS = [
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

  var LOCAL_PROVIDER = { id: 'local', title: 'Встроенная (офлайн, без ключа)', models: ['local'] };

  function providerById(id) {
    for (var i = 0; i < PROVIDERS.length; i += 1) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i];
    }
    return null;
  }

  function modelList(providerId) {
    var p = providerById(providerId);
    return p ? p.models : LOCAL_PROVIDER.models.slice();
  }

  function readStorage(storage, key) {
    try {
      var raw = storage.getItem(key);
      return raw ? String(raw).trim() : '';
    } catch (e) {
      return '';
    }
  }

  /** По формату ключа угадывает провайдера. */
  function guessProvider(key) {
    var k = String(key || '').trim();
    if (/^sk-or-/i.test(k)) return 'openrouter';
    if (/^gsk_/i.test(k)) return 'groq';
    return 'openai';
  }

  /**
   * Собирает все найденные ключи.
   * env: { server: {providerId, model}, storage, query: URLSearchParams }
   */
  function detectProviders(env) {
    var e = env || {};
    var found = [];
    if (e.server && e.server.providerId && e.server.providerId !== 'local') {
      found.push({ id: e.server.providerId, key: '', source: 'server', model: e.server.model || '' });
    }
    if (e.storage) {
      for (var i = 0; i < PROVIDERS.length; i += 1) {
        var key = readStorage(e.storage, 'aigf.key.' + PROVIDERS[i].id);
        if (key) found.push({ id: PROVIDERS[i].id, key: key, source: 'browser' });
      }
    }
    if (e.query) {
      var qk = (e.query.get('key') || '').trim();
      if (qk) {
        var pid = ((e.query.get('provider') || '') + '').trim();
        found.push({ id: pid || guessProvider(qk), key: qk, source: 'url' });
      }
    }
    // без дублей: один провайдер — одна запись, приоритет у первого найденного источника
    var seen = {};
    var unique = [];
    for (var j = 0; j < found.length; j += 1) {
      if (seen[found[j].id]) continue;
      seen[found[j].id] = true;
      unique.push(found[j]);
    }
    // встроенный движок — всегда последний запасной вариант
    unique.push({ id: 'local', key: '', source: 'offline' });
    return unique;
  }

  /** Тело запроса одинаковое у всех трёх провайдеров — это OpenAI-совместимый API. */
  function buildChatRequest(opts) {
    return {
      model: opts.model,
      messages: opts.messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.9,
      max_tokens: 300,
    };
  }

  function requestHeaders(opts) {
    var headers = { 'Content-Type': 'application/json' };
    if (opts.key) headers.Authorization = 'Bearer ' + opts.key;
    if (opts.providerId === 'openrouter') {
      headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://ai-girlfriend.local';
      headers['X-Title'] = 'AI Girlfriend';
    }
    return headers;
  }

  function extractText(payload) {
    var choice = payload && payload.choices && payload.choices[0];
    var msg = choice && (choice.message || choice.delta);
    if (msg && typeof msg.content === 'string') return msg.content;
    if (msg && Array.isArray(msg.content)) {
      return msg.content
        .map(function (part) {
          return (part && part.text) || '';
        })
        .join('');
    }
    return '';
  }

  function extractError(payload, fallback) {
    var def = fallback || 'Неизвестная ошибка провайдера';
    if (!payload) return def;
    if (typeof payload === 'string') return payload;
    if (payload.error) {
      if (typeof payload.error === 'string') return payload.error;
      if (payload.error.message) return payload.error.message;
    }
    if (payload.message) return payload.message;
    return def;
  }

  function isNetworkFailure(err) {
    if (!err) return false;
    var name = err.name || '';
    return name === 'TypeError' || name === 'AbortError' || /network|fetch|failed/i.test(String(err.message || ''));
  }

  /**
   * Пытается отправить сообщение. mode: 'server' (POST /api/chat) или 'direct'.
   * opts: { providerId, key, model, messages, mode, temperature, fetchImpl }
   */
  async function chatOnce(opts) {
    var doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return { ok: false, mode: opts.mode, error: 'В этом окружении нет fetch', network: false };
    var provider = providerById(opts.providerId);
    if (!provider) return { ok: false, mode: opts.mode, error: 'Неизвестный провайдер: ' + opts.providerId, network: false };

    var body = buildChatRequest(opts);
    var url = opts.mode === 'server' ? '/api/chat' : provider.endpoint;
    var headers = opts.mode === 'server' ? { 'Content-Type': 'application/json' } : requestHeaders(opts);

    try {
      var res = await doFetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
      var payload = null;
      try {
        payload = await res.json();
      } catch (e) {
        payload = null;
      }
      if (!res.ok) {
        return { ok: false, mode: opts.mode, error: extractError(payload, 'HTTP ' + res.status), network: false };
      }
      var text = extractText(payload);
      if (!text.trim()) return { ok: false, mode: opts.mode, error: 'Пустой ответ модели', network: false };
      return { ok: true, mode: opts.mode, text: text };
    } catch (err) {
      return { ok: false, mode: opts.mode, error: String((err && err.message) || err), network: isNetworkFailure(err) };
    }
  }

  /**
   * Автоматический выбор рабочего провайдера: перебирает найденные ключи и режимы
   * (сервер -> прямой запрос из браузера) и возвращает первый, который ответил.
   * opts: { candidates, preferredModel, fetchImpl }
   */
  async function pickWorkingProvider(opts) {
    var candidates = opts.candidates || [];
    var tried = [];
    for (var i = 0; i < candidates.length; i += 1) {
      var cand = candidates[i];
      if (cand.id === 'local') {
        return {
          providerId: 'local',
          key: '',
          mode: 'local',
          model: LOCAL_PROVIDER.models[0],
          source: cand.source || 'offline',
          tried: tried,
        };
      }
      if (!cand.key && cand.source !== 'server') {
        tried.push({ providerId: cand.id, mode: 'skip', error: 'нет ключа' });
        continue;
      }
      var available = modelList(cand.id);
      var model =
        opts.preferredModel && available.indexOf(opts.preferredModel) !== -1 ? opts.preferredModel : available[0];
      var probe = [{ role: 'user', content: 'Привет' }];

      var viaServer = await chatOnce({
        providerId: cand.id,
        key: cand.key,
        model: model,
        messages: probe,
        mode: 'server',
        temperature: 0.3,
        fetchImpl: opts.fetchImpl,
      });
      if (viaServer.ok) {
        return { providerId: cand.id, key: cand.key, mode: 'server', model: model, source: cand.source, tried: tried };
      }
      tried.push({ providerId: cand.id, mode: 'server', error: viaServer.error });

      if (cand.key) {
        var direct = await chatOnce({
          providerId: cand.id,
          key: cand.key,
          model: model,
          messages: probe,
          mode: 'direct',
          temperature: 0.3,
          fetchImpl: opts.fetchImpl,
        });
        if (direct.ok) {
          return { providerId: cand.id, key: cand.key, mode: 'direct', model: model, source: cand.source, tried: tried };
        }
        tried.push({ providerId: cand.id, mode: 'direct', error: direct.error });
      }
    }
    return { providerId: 'local', key: '', mode: 'local', model: LOCAL_PROVIDER.models[0], source: 'offline', tried: tried };
  }

  return {
    PROVIDERS: PROVIDERS,
    LOCAL_PROVIDER: LOCAL_PROVIDER,
    providerById: providerById,
    modelList: modelList,
    guessProvider: guessProvider,
    detectProviders: detectProviders,
    buildChatRequest: buildChatRequest,
    requestHeaders: requestHeaders,
    extractText: extractText,
    extractError: extractError,
    chatOnce: chatOnce,
    pickWorkingProvider: pickWorkingProvider,
  };
});
