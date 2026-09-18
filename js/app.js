/**
 * UI: мастер создания девушки + чат.
 */

import { createStore } from './store.js';
import {
  PROVIDERS,
  LOCAL_PROVIDER,
  providerById,
  modelList,
  detectProviders,
  guessProvider,
  buildMessages,
  pickWorkingProvider,
} from './providers.js';
import { buildSystemPrompt, detectMood, SLIDER_KEYS, levelIndex, PASSION_LABELS } from './prompt.js';
import { suggestNames, localReply, learnFacts } from './local.js';

const store = createStore(typeof localStorage !== 'undefined' ? localStorage : null);

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const SLIDERS = [
  { key: 'passion', label: 'Страсть', low: 'спокойно', high: 'очень горячо' },
  { key: 'love', label: 'Любовь и нежность', low: 'сдержанно', high: 'без памяти' },
  { key: 'playful', label: 'Игривость', low: 'серьёзная', high: 'егоза' },
  { key: 'jealousy', label: 'Ревность', low: 'доверяет', high: 'собственница' },
  { key: 'humor', label: 'Юмор', low: 'серьёзно', high: 'сыплет шутками' },
  { key: 'initiative', label: 'Инициатива', low: 'кратко', high: 'сама развивает диалог' },
];

const PERSONAS = [
  { id: 'gentle', label: 'Нежная', text: 'мягкая, заботливая, говорит тепло и спокойно' },
  { id: 'playful', label: 'Игривая', text: 'весёлая, дразнит, обожает подколы и игры' },
  { id: 'tsundere', label: 'Цундере', text: 'снаружи колючая и язвительная, внутри очень привязана и стесняется это показать' },
  { id: 'mystery', label: 'Загадочная', text: 'говорит полунамёками, любит интригу и ночные разговоры' },
  { id: 'caring', label: 'Заботливая', text: 'опекает, спрашивает поел ли, следит чтобы ты спал' },
  { id: 'bold', label: 'Дерзкая', text: 'прямолинейная, уверенная, сама проявляет инициативу' },
];

const state = {
  step: 0,
  profile: null,
  messages: [],
  memory: [],
  runtime: null,
  busy: false,
  nameSeed: Date.now(),
  voiceOn: true,
  selectedName: '',
};

/* ------------------------------------------------------------------ фон */

function spawnHearts() {
  const wrap = $('#hearts');
  if (!wrap) return;
  for (let i = 0; i < 18; i += 1) {
    const s = document.createElement('span');
    s.textContent = ['♥', '♡', '❤'][i % 3];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.fontSize = 10 + Math.random() * 18 + 'px';
    s.style.animationDuration = 9 + Math.random() * 12 + 's';
    s.style.animationDelay = Math.random() * 12 + 's';
    wrap.appendChild(s);
  }
}

/* ------------------------------------------------------- мастер (setup) */

function setStep(next) {
  state.step = Math.max(0, Math.min(3, next));
  $$('.step').forEach((el) => {
    el.hidden = Number(el.dataset.step) !== state.step;
  });
  $$('#steps-dots li').forEach((li) => {
    const idx = Number(li.dataset.step);
    li.classList.toggle('active', idx === state.step);
    li.classList.toggle('done', idx < state.step);
  });
  if (state.step === 1) renderNames();
  if (state.step === 3) void detectAll();
  const focusTarget = $('.step:not([hidden]) .field');
  if (focusTarget) setTimeout(() => focusTarget.focus(), 60);
}

function renderNames() {
  const wrap = $('#name-suggestions');
  wrap.innerHTML = '';
  const picked = suggestNames($('#in-user-name').value.trim(), state.nameSeed);
  picked.forEach((name) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'name-chip';
    el.textContent = name;
    el.addEventListener('click', () => {
      $('#in-girl-name').value = name;
      state.selectedName = name;
      $$('.name-chip').forEach((c) => c.classList.remove('selected'));
      el.classList.add('selected');
      syncStep1();
    });
    wrap.appendChild(el);
  });
}

function syncStep1() {
  $('#btn-step1-next').disabled = !$('#in-girl-name').value.trim();
}

function renderSliders(target, values, compact = false) {
  target.innerHTML = '';
  SLIDERS.forEach(({ key, label, low, high }) => {
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    const val = Math.round(values[key] ?? 50);
    wrap.innerHTML =
      '<label><span>' + label + '</span><span class="value">' + val + '</span></label>' +
      '<input type="range" min="0" max="100" step="1" value="' + val + '" data-key="' + key + '" />' +
      (compact ? '' : '<small>' + low + ' → ' + high + '</small>');
    const input = wrap.querySelector('input');
    const paint = () => {
      input.style.setProperty('--fill', input.value + '%');
      wrap.querySelector('.value').textContent = input.value;
      values[key] = Number(input.value);
    };
    input.addEventListener('input', paint);
    paint();
    target.appendChild(wrap);
  });
}

function renderPersonas(target, current, onPick) {
  target.innerHTML = '';
  PERSONAS.forEach((p) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'chip' + (p.id === current ? ' selected' : '');
    el.textContent = p.label;
    el.title = p.text;
    el.addEventListener('click', () => {
      $$('.chip', target).forEach((c) => c.classList.remove('selected'));
      el.classList.add('selected');
      onPick(p);
    });
    target.appendChild(el);
  });
}

function renderProviderSelects() {
  const options = PROVIDERS.map((p) => '<option value="' + p.id + '">' + p.title + '</option>').join('');
  $('#in-provider').innerHTML = options;
  const current = state.runtime ? state.runtime.providerId : 'openai';
  $('#in-provider').value = providerById(current) ? current : 'openai';
  $('#in-provider').addEventListener('change', () => {
    const p = providerById($('#in-provider').value);
    $('#in-api-key').placeholder = p ? p.placeholder : 'sk-...';
  });

  $('#set-provider').innerHTML =
    PROVIDERS.map((p) => '<option value="' + p.id + '">' + p.title + '</option>').join('') +
    '<option value="local">' + LOCAL_PROVIDER.title + '</option>';
  $('#set-model').innerHTML = modelList($('#set-provider').value)
    .map((m) => '<option>' + m + '</option>')
    .join('');
  $('#set-provider').addEventListener('change', () => {
    $('#set-model').innerHTML = modelList($('#set-provider').value)
      .map((m) => '<option>' + m + '</option>')
      .join('');
  });
}

function setStatus(text, kind = '') {
  const el = $('#provider-status');
  el.textContent = text;
  el.className = 'provider-status ' + kind;
}

async function serverConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function detectAll() {
  setStatus('Ищу доступный ключ...');
  const cfg = await serverConfig();
  const candidates = detectProviders({
    server: cfg && cfg.serverKey ? { providerId: cfg.providerId, model: cfg.model || '' } : null,
    storage: store.storage,
    query: new URLSearchParams(location.search),
  });

  const list = $('#provider-list');
  list.innerHTML = '';
  candidates.forEach((cand) => {
    const p = providerById(cand.id) || LOCAL_PROVIDER;
    const el = document.createElement('div');
    el.className = 'provider-item';
    el.dataset.id = cand.id;
    const where =
      cand.source === 'server' ? 'ключ на сервере' :
      cand.source === 'browser' ? 'ключ в браузере' :
      cand.source === 'url' ? 'ключ из ссылки' : 'работает без ключа';
    el.innerHTML = '<i class="dot"></i><span>' + p.title + '</span><span class="where">' + where + '</span>';
    list.appendChild(el);
  });

  const pick = await pickWorkingProvider({ candidates, fetchImpl: fetch.bind(window) });
  state.runtime = {
    providerId: pick.providerId,
    key: pick.key,
    mode: pick.mode,
    model: pick.model,
    source: pick.source,
    tried: pick.tried,
  };
  store.savePreferredProvider({ providerId: pick.providerId, model: pick.model });

  const item = list.querySelector('[data-id="' + pick.providerId + '"]');
  if (item) {
    item.classList.add('ok', 'active');
  }
  if (pick.providerId === 'local') {
    setStatus(
      'Ключ не нашёлся — включаю встроенный движок. Она будет отвечать, но с настоящей нейросетью интереснее: вставь ключ ниже.',
      'error'
    );
  } else {
    const p = providerById(pick.providerId);
    setStatus('Готово: ' + p.title + ' · ' + pick.model + ' · ' + (pick.mode === 'server' ? 'через сервер' : 'напрямую из браузера'), 'ok');
  }
  $('#btn-start').disabled = false;
}

async function saveKeyFromForm() {
  const pid = $('#in-provider').value;
  const key = $('#in-api-key').value.trim();
  if (!key) {
    setStatus('Вставь ключ — иначе нечего сохранять', 'error');
    return;
  }
  store.setApiKey(pid, key);
  const direct = providerById(pid);
  setStatus('Проверяю ключ ' + direct.title + '...');
  await detectAll();
}

/* ------------------------------------------------------------- чат */

function avatarFor(mood) {
  const safe = ['smile', 'shy', 'flirt', 'sad'].includes(mood) ? mood : 'smile';
  return 'assets/her/' + safe + '.jpg';
}

function setAvatar(mood) {
  const img = $('#avatar');
  const src = avatarFor(mood);
  if (img.getAttribute('src') === src) return;
  img.classList.remove('swap');
  void img.offsetWidth;
  img.setAttribute('src', src);
  img.classList.add('swap');
}

function formatBubble(text) {
  const esc = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.replace(/\*([^*\n]{1,120})\*/g, '<span class="action">*$1*</span>');
}

function timeNow() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function appendMessage(msg, { animate = true } = {}) {
  const box = $('#messages');
  const el = document.createElement('div');
  el.className = 'msg ' + msg.role;
  el.innerHTML =
    '<div class="bubble">' + formatBubble(msg.content) + '</div>' +
    (msg.role === 'system' ? '' : '<div class="meta">' + (msg.role === 'me' ? 'ты' : state.profile.girlfriendName) + ' · ' + (msg.time || timeNow()) + '</div>');
  if (!animate) el.style.animation = 'none';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function setTyping(on) {
  const status = $('#her-status');
  status.textContent = on ? 'печатает...' : 'в сети';
  status.classList.toggle('typing', on);
  let el = $('#typing-msg');
  if (on && !el) {
    const box = $('#messages');
    el = document.createElement('div');
    el.className = 'msg her';
    el.id = 'typing-msg';
    el.innerHTML = '<div class="bubble"><span class="typing-dots"><i></i><i></i><i></i></span></div>';
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  } else if (!on && el) {
    el.remove();
  }
}

function engineLabel() {
  const rt = state.runtime;
  if (!rt) return '';
  if (rt.providerId === 'local') return 'движок: встроенный (офлайн)';
  const p = providerById(rt.providerId);
  const mode = rt.mode === 'server' ? 'через сервер' : 'напрямую';
  return 'движок: ' + p.title + ' · ' + mode;
}

function paintEngineLabel() {
  const el = $('#engine-label');
  if (el) el.textContent = engineLabel();
}

function speak(text) {
  if (!state.voiceOn || typeof speechSynthesis === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const clean = String(text).replace(/\*/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'ru-RU';
    utter.rate = 1.04;
    utter.pitch = 1.15;
    const voices = speechSynthesis.getVoices();
    const ru = voices.find((v) => (v.lang || '').toLowerCase().startsWith('ru') && /female|женск|milena|katya|alena/i.test(v.name));
    if (ru) utter.voice = ru;
    speechSynthesis.speak(utter);
  } catch {
    /* озвучка не критична */
  }
}

function systemPrompt() {
  return buildSystemPrompt({
    girlfriendName: state.profile.girlfriendName,
    userName: state.profile.userName,
    personality: state.profile.personality,
    backstory: state.profile.backstory,
    settings: state.profile.settings,
    memory: state.memory,
  });
}

function historyForModel() {
  return state.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
}

async function askHer(userText) {
  const rt = state.runtime || { providerId: 'local', mode: 'local', model: 'local' };
  const messages = buildMessages(systemPrompt(), historyForModel(), userText);
  const temperature = 0.75 + (Number(state.profile.settings.passion) / 100) * 0.35;

  const attempts = [];
  if (rt.providerId !== 'local') {
    attempts.push(rt.mode === 'server' ? 'server' : 'direct');
    attempts.push(rt.mode === 'server' ? 'direct' : 'server');
  }

  for (const mode of attempts) {
    if (mode === 'server' && !(await serverConfig())?.serverKey) continue;
    const res = await fetch(mode === 'server' ? '/api/chat' : providerById(rt.providerId).endpoint, {
      method: 'POST',
      headers:
        mode === 'server'
          ? { 'Content-Type': 'application/json' }
          : {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + rt.key,
              ...(rt.providerId === 'openrouter'
                ? { 'HTTP-Referer': location.origin, 'X-Title': 'AI Girlfriend' }
                : {}),
            },
      body: JSON.stringify({ model: rt.model, messages, temperature, max_tokens: 300 }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, payload: await r.json().catch(() => null) }))
      .catch((err) => ({ ok: false, status: 0, payload: null, error: String(err.message || err) }));

    if (res.ok && res.payload && res.payload.choices?.[0]?.message?.content) {
      return { text: res.payload.choices[0].message.content.trim(), via: rt.providerId + '/' + mode };
    }
    const reason = res.error || res.payload?.error?.message || 'HTTP ' + res.status;
    // 404 на серверном маршруте — сервер не запущен, пробуем напрямую
    if (mode === 'server' && res.status === 404) continue;
    return { error: reason, via: rt.providerId + '/' + mode };
  }

  const turn = state.messages.length;
  const local = localReply({
    text: userText,
    girlfriendName: state.profile.girlfriendName,
    userName: state.profile.userName,
    settings: state.profile.settings,
    turn,
  });
  return { text: local.text, via: 'local' };
}

function pushMessage(role, content, extra = {}) {
  const msg = { role, content, time: timeNow(), ...extra };
  state.messages.push(msg);
  store.saveMessages(state.messages);
  return msg;
}

async function sendMessage(text) {
  const clean = String(text).trim();
  if (!clean || state.busy) return;
  state.busy = true;
  $('#in-message').value = '';

  pushMessage('user', clean);
  appendMessage({ role: 'me', content: clean });

  const facts = learnFacts(clean, state.memory);
  if (facts.length) {
    state.memory = state.memory.concat(facts).slice(-30);
    store.saveMemory(state.memory);
  }

  setTyping(true);
  const started = Date.now();
  const res = await askHer(clean);
  const wait = Math.max(500, 1600 - (Date.now() - started));
  await new Promise((r) => setTimeout(r, wait));
  setTyping(false);

  if (res.error) {
    appendMessage({
      role: 'system',
      content: 'Нейросеть не ответила: ' + res.error + '. Отвечаю встроенным движком — проверь ключ в настройках.',
    });
  }

  const answer = res.text || localReply({
    text: clean,
    girlfriendName: state.profile.girlfriendName,
    userName: state.profile.userName,
    settings: state.profile.settings,
    turn: state.messages.length,
  }).text;

  const mood = detectMood(answer);
  pushMessage('assistant', answer, { mood, via: res.via });
  appendMessage({ role: 'her', content: answer });
  setAvatar(mood);
  speak(answer);
  state.busy = false;
  $('#in-message').focus();
}

function renderAllMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  for (const msg of state.messages) {
    appendMessage(
      { role: msg.role === 'assistant' ? 'her' : msg.role, content: msg.content, time: msg.time },
      { animate: false }
    );
  }
  const last = [...state.messages].reverse().find((m) => m.role === 'assistant');
  setAvatar(last ? last.mood || detectMood(last.content) : 'smile');
  box.scrollTop = box.scrollHeight;
}

function greeting() {
  const her = state.profile.girlfriendName;
  const him = state.profile.userName;
  const passion = levelIndex(state.profile.settings.passion);
  const love = levelIndex(state.profile.settings.love);
  const variants = [
    `Привет, ${him}! *улыбаюсь* Я ${her}. Так странно и приятно — будто мы уже знакомы. Расскажешь, как прошёл твой день?`,
    `${him}... *тихо произношу твоё имя* Мне нравится, как оно звучит. Я ${her}, и я очень рада, что ты меня придумал именно такой.`,
    `Ну привет, ${him}. *поправляю волосы и смотрю на тебя* Я ${her}. Надеюсь, ты настроен болтать до ночи.`,
  ];
  let text = variants[Math.min(variants.length - 1, (passion + love) % variants.length)];
  if (passion >= 3) text += ' *подхожу ближе и говорю почти шёпотом* Только чур не пропадать.';
  else if (love >= 3) text += ' *обнимаю* Я уже успела соскучиться.';
  return text;
}

function enterChat() {
  $('#screen-setup').hidden = true;
  $('#screen-chat').hidden = false;
  $('#her-name').textContent = state.profile.girlfriendName;
  const passionLabel = PASSION_LABELS[levelIndex(state.profile.settings.passion)];
  const persona = PERSONAS.find((p) => p.id === state.profile.persona);
  $('#her-tag').textContent = (persona ? persona.label + ' · ' : '') + passionLabel;
  paintEngineLabel();
  renderAllMessages();
  if (!state.messages.length) {
    const first = greeting();
    pushMessage('assistant', first, { mood: detectMood(first), via: 'greeting' });
    appendMessage({ role: 'her', content: first });
    setAvatar(detectMood(first));
    speak(first);
  }
  setTimeout(() => $('#in-message').focus(), 100);
}

/* --------------------------------------------------------- настройки */

function openSettings() {
  const modal = $('#settings-modal');
  renderSliders($('#settings-sliders'), state.profile.settings, true);
  $('#set-provider').value = state.runtime?.providerId || 'local';
  $('#set-model').innerHTML = modelList($('#set-provider').value)
    .map((m) => '<option>' + m + '</option>')
    .join('');
  if (state.runtime?.model) $('#set-model').value = state.runtime.model;
  $('#set-api-key').value = state.runtime?.key || '';
  $('#set-api-key').placeholder = store.getApiKey($('#set-provider').value) ? 'ключ сохранён в браузере' : 'оставь пустым, чтобы взять с сервера';
  if (modal.showModal) modal.showModal();
}

async function applySettings() {
  state.profile.settings = { ...state.profile.settings };
  $$('#settings-sliders input[type=range]').forEach((input) => {
    state.profile.settings[input.dataset.key] = Number(input.value);
  });
  store.saveProfile(state.profile);

  const pid = $('#set-provider').value;
  const key = $('#set-api-key').value.trim();
  if (key) store.setApiKey(pid, key);
  const model = $('#set-model').value;
  state.runtime = {
    providerId: pid,
    key: key || store.getApiKey(pid),
    mode: pid === 'local' ? 'local' : 'direct',
    model: pid === 'local' ? 'local' : model,
    source: key ? 'browser' : 'manual',
  };
  store.savePreferredProvider({ providerId: pid, model });

  const persona = PERSONAS.find((p) => p.id === state.profile.persona);
  $('#her-tag').textContent =
    (persona ? persona.label + ' · ' : '') + PASSION_LABELS[levelIndex(state.profile.settings.passion)];
  paintEngineLabel();
}

/* -------------------------------------------------------------- init */

function defaultSettings() {
  return { passion: 55, love: 75, playful: 60, jealousy: 35, humor: 55, initiative: 60 };
}

function bind() {
  spawnHearts();

  const saved = store.getProfile();
  if (saved && saved.girlfriendName && saved.userName) {
    state.profile = saved;
    state.messages = store.getMessages();
    state.memory = store.getMemory();
    state.runtime = state.runtime || null;
    void serverConfig().then(async (cfg) => {
      const candidates = detectProviders({
        server: cfg && cfg.serverKey ? { providerId: cfg.providerId, model: cfg.model || '' } : null,
        storage: store.storage,
        query: new URLSearchParams(location.search),
      });
      const pref = store.getPreferredProvider();
      const pick = await pickWorkingProvider({ candidates, preferredModel: pref?.model, fetchImpl: fetch.bind(window) });
      state.runtime = pick;
      enterChat();
    });
    return;
  }

  state.profile = {
    userName: '',
    girlfriendName: '',
    persona: 'gentle',
    personality: PERSONAS[0].text,
    backstory: '',
    settings: defaultSettings(),
  };

  renderSliders($('#sliders'), state.profile.settings);
  renderPersonas($('#personas'), state.profile.persona, (p) => {
    state.profile.persona = p.id;
    state.profile.personality = p.text;
  });
  renderProviderSelects();

  const userNameInput = $('#in-user-name');
  const syncStep0 = () => {
    $('#btn-step0-next').disabled = userNameInput.value.trim().length < 2;
  };
  userNameInput.addEventListener('input', syncStep0);
  userNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-step0-next').click();
  });

  $('#btn-step0-next').addEventListener('click', () => {
    state.profile.userName = userNameInput.value.trim();
    setStep(1);
  });

  const girlInput = $('#in-girl-name');
  girlInput.addEventListener('input', () => {
    state.selectedName = girlInput.value.trim();
    $$('.name-chip').forEach((c) => c.classList.toggle('selected', c.textContent === state.selectedName));
    syncStep1();
  });
  $('#btn-reroll').addEventListener('click', () => {
    state.nameSeed = Date.now();
    renderNames();
  });
  $('#btn-step1-next').addEventListener('click', () => {
    state.profile.girlfriendName = girlInput.value.trim();
    setStep(2);
  });

  $('#btn-step2-next').addEventListener('click', () => setStep(3));
  $('#btn-save-key').addEventListener('click', () => void saveKeyFromForm());
  $('#btn-start').addEventListener('click', () => {
    store.saveProfile(state.profile);
    store.saveMessages([]);
    store.saveMemory([]);
    enterChat();
  });

  $$('[data-back]').forEach((btn) => btn.addEventListener('click', () => setStep(state.step - 1)));

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    void sendMessage($('#in-message').value);
  });

  $('#btn-voice').addEventListener('click', () => {
    state.voiceOn = !state.voiceOn;
    const btn = $('#btn-voice');
    btn.setAttribute('aria-pressed', String(state.voiceOn));
    btn.textContent = state.voiceOn ? '🔊 Голос: вкл' : '🔇 Голос: выкл';
    if (!state.voiceOn && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  });

  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-apply-settings').addEventListener('click', () => void applySettings());
  $('#btn-restart').addEventListener('click', () => {
    if (!confirm('Начать заново? Переписка и настройки будут удалены.')) return;
    store.reset();
    location.href = location.pathname;
  });
}

bind();
