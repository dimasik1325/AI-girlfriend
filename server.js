/**
 * Мини-сервер без зависимостей: раздаёт статику и проксирует запросы к LLM,
 * чтобы ключ можно было держать в .env на сервере, а не в браузере.
 *
 *   PORT=3000 LLM_PROVIDER=openai LLM_API_KEY=sk-... node server.js
 *
 * Режим start.bat: AUTO_EXIT=1 — страница сама держит SSE-соединение /api/live,
 * и когда вкладку закрывают, сервер завершается, а консольное окно гаснет.
 */

'use strict';

const http = require('node:http');
const { exec } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const { extname, join, normalize, resolve } = require('node:path');

const ROOT = resolve(__dirname);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const PROVIDERS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serverProvider() {
  const id = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
  const key = (process.env.LLM_API_KEY || '').trim();
  if (!id || !key || !PROVIDERS[id]) return null;
  return { id, key, model: (process.env.LLM_MODEL || '').trim() };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Слишком большое тело запроса');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не найдено');
  }
}

/* --------------------------------------------------------------- live */
/* Страница держит SSE-соединение, пока открыта. Закрыли вкладку — соединение
   оборвалось; если больше никто не смотрит, в режиме AUTO_EXIT гасим сервер. */

let liveConnections = 0;
let everLive = false;
let exitTimer = null;

function liveOpen(res) {
  liveConnections += 1;
  everLive = true;
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = null;
  }
  res.on('close', liveClose);
}

function liveClose() {
  liveConnections = Math.max(0, liveConnections - 1);
  if (liveConnections === 0 && everLive && process.env.AUTO_EXIT) {
    // даём пару секунд на перезагрузку страницы, потом гасим консоль
    exitTimer = setTimeout(() => {
      console.log('Страница закрыта — завершаюсь.');
      process.exit(0);
    }, 5000);
  }
}

function handleLive(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* клиент уже ушёл */
    }
  }, 10000);
  res.on('close', () => clearInterval(ping));
  liveOpen(res);
}

/* ------------------------------------------------------------- router */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === '/api/health') {
    json(res, 200, { ok: true, name: 'AI Girlfriend' });
    return;
  }

  if (url.pathname === '/api/live') {
    handleLive(req, res);
    return;
  }

  if (url.pathname === '/api/config') {
    const p = serverProvider();
    json(res, 200, {
      serverKey: Boolean(p),
      providerId: p ? p.id : null,
      model: p ? p.model || null : null,
      providers: Object.keys(PROVIDERS),
    });
    return;
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const p = serverProvider();
    if (!p) {
      json(res, 503, { error: { message: 'Ключ нейросети на сервере не настроен (LLM_API_KEY в .env)' } });
      return;
    }
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch (err) {
      json(res, 400, { error: { message: 'Некорректный JSON: ' + err.message } });
      return;
    }
    const payload = {
      model: body.model || p.model || 'gpt-4o-mini',
      messages: Array.isArray(body.messages) ? body.messages : [],
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.9,
      max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 300,
    };
    if (!payload.messages.length) {
      json(res, 400, { error: { message: 'Пустой список сообщений' } });
      return;
    }
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key };
    if (p.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://ai-girlfriend.local';
      headers['X-Title'] = 'AI Girlfriend';
    }
    try {
      const upstream = await fetch(PROVIDERS[p.id], {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(text);
    } catch (err) {
      json(res, 502, { error: { message: 'Не удалось достучаться до ' + p.id + ': ' + err.message } });
    }
    return;
  }

  if (req.method === 'GET') {
    await serveStatic(req, res, url.pathname);
    return;
  }
  res.writeHead(404).end('Не найдено');
});

server.on('error', (err) => {
  console.error('Не удалось запустить сервер:', err.message);
  process.exit(1);
});

/* -------------------------------------------------------- автозапуск */

function openBrowser(url) {
  const cmd =
    process.platform === 'win32'
      ? 'start "" "' + url + '"'
      : process.platform === 'darwin'
        ? 'open "' + url + '"'
        : 'xdg-open "' + url + '"';
  exec(cmd, () => {
    /* если браузера нет — просто откроешь руками */
  });
}

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const p = serverProvider();
    const url = 'http://localhost:' + PORT;
    console.log('AI Girlfriend: ' + url);
    console.log(
      p
        ? 'Ключ сервера: ' + p.id + ' (' + (p.model || 'модель по умолчанию') + ')'
        : 'Ключ сервера не задан — сайт сам спросит ключ в браузере или включит офлайн-режим'
    );
    if (process.env.NO_OPEN !== '1') openBrowser(url);
  });
}

module.exports = { server, serverProvider, ROOT };
