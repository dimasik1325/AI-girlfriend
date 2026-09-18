/**
 * UI: мастер создания девушки + чат.
 * Обычный (не модульный) скрипт — работает и с сервером, и просто с диска (file://).
 */
(function () {
  'use strict';

  var A = window.AIGF || {};
  var createStore = A.store.createStore;
  var P = A.providers;
  var PROVIDERS = P.PROVIDERS;
  var LOCAL_PROVIDER = P.LOCAL_PROVIDER;
  var providerById = P.providerById;
  var modelList = P.modelList;
  var detectProviders = P.detectProviders;
  var pickWorkingProvider = P.pickWorkingProvider;
  var promptMod = A.prompt;
  var buildSystemPrompt = promptMod.buildSystemPrompt;
  var buildMessages = promptMod.buildMessages;
  var detectMood = promptMod.detectMood;
  var levelIndex = promptMod.levelIndex;
  var PASSION_LABELS = promptMod.PASSION_LABELS;
  var localMod = A.local;
  var suggestNames = localMod.suggestNames;
  var localReply = localMod.localReply;
  var learnFacts = localMod.learnFacts;

  var store = createStore(typeof localStorage !== 'undefined' ? localStorage : null);

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  var SLIDERS = [
    { key: 'passion', label: 'Страсть', low: 'спокойно', high: 'очень горячо' },
    { key: 'love', label: 'Любовь и нежность', low: 'сдержанно', high: 'без памяти' },
    { key: 'playful', label: 'Игривость', low: 'серьёзная', high: 'егоза' },
    { key: 'jealousy', label: 'Ревность', low: 'доверяет', high: 'собственница' },
    { key: 'humor', label: 'Юмор', low: 'серьёзно', high: 'сыплет шутками' },
    { key: 'initiative', label: 'Инициатива', low: 'кратко', high: 'сама развивает диалог' },
  ];

  var PERSONAS = [
    { id: 'gentle', label: 'Нежная', text: 'мягкая, заботливая, говорит тепло и спокойно' },
    { id: 'playful', label: 'Игривая', text: 'весёлая, дразнит, обожает подколы и игры' },
    { id: 'tsundere', label: 'Цундере', text: 'снаружи колючая и язвительная, внутри очень привязана и стесняется это показать' },
    { id: 'mystery', label: 'Загадочная', text: 'говорит полунамёками, любит интригу и ночные разговоры' },
    { id: 'caring', label: 'Заботливая', text: 'опекает, спрашивает поел ли, следит чтобы ты спал' },
    { id: 'bold', label: 'Дерзкая', text: 'прямолинейная, уверенная, сама проявляет инициативу' },
  ];

  var state = {
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
    var wrap = $('#hearts');
    if (!wrap) return;
    for (var i = 0; i < 18; i += 1) {
      var s = document.createElement('span');
      s.textContent = ['♥', '♡', '❤'][i % 3];
      s.style.left = Math.random() * 100 + 'vw';
      s.style.fontSize = 10 + Math.random() * 18 + 'px';
      s.style.animationDuration = 9 + Math.random() * 12 + 's';
      s.style.animationDelay = Math.random() * 12 + 's';
      wrap.appendChild(s);
    }
  }

  /**
   * Держим SSE-соединение с сервером, пока страница открыта:
   * как только вкладку закроют, соединение оборвётся и server.js
   * (в режиме start.bat) сам завершится — консоль закроется.
   */
  function trackPageAlive() {
    if (!/^https?:$/.test(location.protocol)) return; // с диска (file://) сервера нет
    if (typeof EventSource === 'undefined') return;
    try {
      new EventSource('/api/live');
    } catch (e) {
      /* не критично */
    }
  }

  /* ------------------------------------------------------- мастер (setup) */

  function setStep(next) {
    state.step = Math.max(0, Math.min(3, next));
    $$('.step').forEach(function (el) {
      el.hidden = Number(el.dataset.step) !== state.step;
    });
    $$('#steps-dots li').forEach(function (li) {
      var idx = Number(li.dataset.step);
      li.classList.toggle('active', idx === state.step);
      li.classList.toggle('done', idx < state.step);
    });
    if (state.step === 1) renderNames();
    if (state.step === 3) void detectAll();
    var focusTarget = $('.step:not([hidden]) .field');
    if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 60);
  }

  function renderNames() {
    var wrap = $('#name-suggestions');
    wrap.innerHTML = '';
    var picked = suggestNames($('#in-user-name').value.trim(), state.nameSeed);
    picked.forEach(function (name) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'name-chip';
      el.textContent = name;
      el.addEventListener('click', function () {
        $('#in-girl-name').value = name;
        state.selectedName = name;
        $$('.name-chip').forEach(function (c) {
          c.classList.remove('selected');
        });
        el.classList.add('selected');
        syncStep1();
      });
      wrap.appendChild(el);
    });
  }

  function syncStep1() {
    $('#btn-step1-next').disabled = !$('#in-girl-name').value.trim();
  }

  function renderSliders(target, values, compact) {
    target.innerHTML = '';
    SLIDERS.forEach(function (def) {
      var wrap = document.createElement('div');
      wrap.className = 'slider';
      var val = Math.round(values[def.key] == null ? 50 : values[def.key]);
      wrap.innerHTML =
        '<label><span>' + def.label + '</span><span class="value">' + val + '</span></label>' +
        '<input type="range" min="0" max="100" step="1" value="' + val + '" data-key="' + def.key + '" />' +
        (compact ? '' : '<small>' + def.low + ' → ' + def.high + '</small>');
      var input = wrap.querySelector('input');
      function paint() {
        input.style.setProperty('--fill', input.value + '%');
        wrap.querySelector('.value').textContent = input.value;
        values[def.key] = Number(input.value);
      }
      input.addEventListener('input', paint);
      paint();
      target.appendChild(wrap);
    });
  }

  function renderPersonas(target, current, onPick) {
    target.innerHTML = '';
    PERSONAS.forEach(function (p) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'chip' + (p.id === current ? ' selected' : '');
      el.textContent = p.label;
      el.title = p.text;
      el.addEventListener('click', function () {
        $$('.chip', target).forEach(function (c) {
          c.classList.remove('selected');
        });
        el.classList.add('selected');
        onPick(p);
      });
      target.appendChild(el);
    });
  }

  function renderProviderSelects() {
    var options = PROVIDERS.map(function (p) {
      return '<option value="' + p.id + '">' + p.title + '</option>';
    }).join('');
    $('#in-provider').innerHTML = options;
    var current = state.runtime ? state.runtime.providerId : 'openai';
    $('#in-provider').value = providerById(current) ? current : 'openai';
    $('#in-provider').addEventListener('change', function () {
      var p = providerById($('#in-provider').value);
      $('#in-api-key').placeholder = p ? p.placeholder : 'sk-...';
    });

    $('#set-provider').innerHTML =
      PROVIDERS.map(function (p) {
        return '<option value="' + p.id + '">' + p.title + '</option>';
      }).join('') + '<option value="local">' + LOCAL_PROVIDER.title + '</option>';
    $('#set-model').innerHTML = modelList($('#set-provider').value)
      .map(function (m) {
        return '<option>' + m + '</option>';
      })
      .join('');
    $('#set-provider').addEventListener('change', function () {
      $('#set-model').innerHTML = modelList($('#set-provider').value)
        .map(function (m) {
          return '<option>' + m + '</option>';
        })
        .join('');
    });
  }

  function setStatus(text, kind) {
    var el = $('#provider-status');
    el.textContent = text;
    el.className = 'provider-status ' + (kind || '');
  }

  async function serverConfig() {
    if (!/^https?:$/.test(location.protocol)) return null; // открыты с диска — сервера нет
    try {
      var res = await fetch('/api/config');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function detectAll() {
    setStatus('Ищу доступный ключ...');
    var cfg = await serverConfig();
    var candidates = detectProviders({
      server: cfg && cfg.serverKey ? { providerId: cfg.providerId, model: cfg.model || '' } : null,
      storage: store.storage,
      query: new URLSearchParams(location.search),
    });

    var list = $('#provider-list');
    list.innerHTML = '';
    candidates.forEach(function (cand) {
      var p = providerById(cand.id) || LOCAL_PROVIDER;
      var el = document.createElement('div');
      el.className = 'provider-item';
      el.dataset.id = cand.id;
      var where =
        cand.source === 'server' ? 'ключ на сервере'
        : cand.source === 'browser' ? 'ключ в браузере'
        : cand.source === 'url' ? 'ключ из ссылки'
        : 'работает без ключа';
      el.innerHTML = '<i class="dot"></i><span>' + p.title + '</span><span class="where">' + where + '</span>';
      list.appendChild(el);
    });

    var pick = await pickWorkingProvider({ candidates: candidates, fetchImpl: fetch.bind(window) });
    state.runtime = {
      providerId: pick.providerId,
      key: pick.key,
      mode: pick.mode,
      model: pick.model,
      source: pick.source,
      tried: pick.tried,
    };
    store.savePreferredProvider({ providerId: pick.providerId, model: pick.model });

    var item = list.querySelector('[data-id="' + pick.providerId + '"]');
    if (item) item.classList.add('ok', 'active');
    if (pick.providerId === 'local') {
      setStatus(
        'Ключ не нашёлся — включаю встроенный движок. Она будет отвечать, но с настоящей нейросетью интереснее: вставь ключ ниже.',
        'error'
      );
    } else {
      var pr = providerById(pick.providerId);
      setStatus(
        'Готово: ' + pr.title + ' · ' + pick.model + ' · ' + (pick.mode === 'server' ? 'через сервер' : 'напрямую из браузера'),
        'ok'
      );
    }
    $('#btn-start').disabled = false;
  }

  async function saveKeyFromForm() {
    var pid = $('#in-provider').value;
    var key = $('#in-api-key').value.trim();
    if (!key) {
      setStatus('Вставь ключ — иначе нечего сохранять', 'error');
      return;
    }
    store.setApiKey(pid, key);
    setStatus('Проверяю ключ...');
    await detectAll();
  }

  /* ------------------------------------------------------------- чат */

  function avatarFor(mood) {
    var safe = ['smile', 'shy', 'flirt', 'sad'].indexOf(mood) !== -1 ? mood : 'smile';
    return 'assets/her/' + safe + '.jpg';
  }

  function setAvatar(mood) {
    var img = $('#avatar');
    var src = avatarFor(mood);
    if (img.getAttribute('src') === src) return;
    img.classList.remove('swap');
    void img.offsetWidth;
    img.setAttribute('src', src);
    img.classList.add('swap');
  }

  function formatBubble(text) {
    var esc = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return esc.replace(/\*([^*\n]{1,120})\*/g, '<span class="action">*$1*</span>');
  }

  function timeNow() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function appendMessage(msg) {
    var box = $('#messages');
    var el = document.createElement('div');
    el.className = 'msg ' + msg.role;
    el.innerHTML =
      '<div class="bubble">' + formatBubble(msg.content) + '</div>' +
      (msg.role === 'system'
        ? ''
        : '<div class="meta">' + (msg.role === 'me' ? 'ты' : state.profile.girlfriendName) + ' · ' + (msg.time || timeNow()) + '</div>');
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function setTyping(on) {
    var status = $('#her-status');
    status.textContent = on ? 'печатает...' : 'в сети';
    status.classList.toggle('typing', on);
    var el = $('#typing-msg');
    if (on && !el) {
      var box = $('#messages');
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

  function speak(text) {
    if (!state.voiceOn || typeof speechSynthesis === 'undefined') return;
    try {
      speechSynthesis.cancel();
      var clean = String(text).replace(/\*/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
      var utter = new SpeechSynthesisUtterance(clean);
      utter.lang = 'ru-RU';
      utter.rate = 1.04;
      utter.pitch = 1.15;
      var voices = speechSynthesis.getVoices();
      var ru = voices.find(function (v) {
        return (v.lang || '').toLowerCase().startsWith('ru') && /female|женск|milena|katya|alena/i.test(v.name);
      });
      if (ru) utter.voice = ru;
      speechSynthesis.speak(utter);
    } catch (e) {
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
      .filter(function (m) {
        return m.role === 'user' || m.role === 'assistant';
      })
      .map(function (m) {
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
      });
  }

  async function askHer(userText) {
    var rt = state.runtime || { providerId: 'local', mode: 'local', model: 'local' };
    var messages = buildMessages(systemPrompt(), historyForModel(), userText);
    var temperature = 0.75 + (Number(state.profile.settings.passion) / 100) * 0.35;

    var attempts = [];
    if (rt.providerId !== 'local') {
      attempts.push(rt.mode === 'server' ? 'server' : 'direct');
      attempts.push(rt.mode === 'server' ? 'direct' : 'server');
    }

    for (var i = 0; i < attempts.length; i += 1) {
      var mode = attempts[i];
      if (mode === 'server') {
        var cfg = await serverConfig();
        if (!cfg || !cfg.serverKey) continue;
      }
      var res;
      try {
        var r = await fetch(mode === 'server' ? '/api/chat' : providerById(rt.providerId).endpoint, {
          method: 'POST',
          headers:
            mode === 'server'
              ? { 'Content-Type': 'application/json' }
              : Object.assign(
                  { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rt.key },
                  rt.providerId === 'openrouter' ? { 'HTTP-Referer': location.origin, 'X-Title': 'AI Girlfriend' } : {}
                ),
          body: JSON.stringify({ model: rt.model, messages: messages, temperature: temperature, max_tokens: 300 }),
        });
        var payload = await r.json().catch(function () {
          return null;
        });
        res = { ok: r.ok, status: r.status, payload: payload };
      } catch (err) {
        res = { ok: false, status: 0, payload: null, error: String(err.message || err) };
      }

      var choice = res.payload && res.payload.choices && res.payload.choices[0];
      if (res.ok && choice && choice.message && choice.message.content) {
        return { text: String(choice.message.content).trim(), via: rt.providerId + '/' + mode };
      }
      var reason = res.error || (res.payload && res.payload.error && res.payload.error.message) || 'HTTP ' + res.status;
      // 404 на серверном маршруте — сервер не запущен, пробуем напрямую
      if (mode === 'server' && res.status === 404) continue;
      return { error: reason, via: rt.providerId + '/' + mode };
    }

    var local = localReply({
      text: userText,
      girlfriendName: state.profile.girlfriendName,
      userName: state.profile.userName,
      settings: state.profile.settings,
      turn: state.messages.length,
    });
    return { text: local.text, via: 'local' };
  }

  function pushMessage(role, content, extra) {
    var msg = Object.assign({ role: role, content: content, time: timeNow() }, extra || {});
    state.messages.push(msg);
    store.saveMessages(state.messages);
    return msg;
  }

  async function sendMessage(text) {
    var clean = String(text).trim();
    if (!clean || state.busy) return;
    state.busy = true;
    $('#in-message').value = '';

    pushMessage('user', clean);
    appendMessage({ role: 'me', content: clean });

    var facts = learnFacts(clean, state.memory);
    if (facts.length) {
      state.memory = state.memory.concat(facts).slice(-30);
      store.saveMemory(state.memory);
    }

    setTyping(true);
    var started = Date.now();
    var res = await askHer(clean);
    var wait = Math.max(500, 1600 - (Date.now() - started));
    await new Promise(function (r) {
      setTimeout(r, wait);
    });
    setTyping(false);

    if (res.error) {
      appendMessage({
        role: 'system',
        content: 'Нейросеть не ответила: ' + res.error + '. Отвечаю встроенным движком — проверь ключ в настройках.',
      });
    }

    var answer =
      res.text ||
      localReply({
        text: clean,
        girlfriendName: state.profile.girlfriendName,
        userName: state.profile.userName,
        settings: state.profile.settings,
        turn: state.messages.length,
      }).text;

    var mood = detectMood(answer);
    pushMessage('assistant', answer, { mood: mood, via: res.via });
    appendMessage({ role: 'her', content: answer });
    setAvatar(mood);
    speak(answer);
    state.busy = false;
    $('#in-message').focus();
  }

  function renderAllMessages() {
    var box = $('#messages');
    box.innerHTML = '';
    state.messages.forEach(function (msg) {
      appendMessage({ role: msg.role === 'assistant' ? 'her' : msg.role, content: msg.content, time: msg.time });
    });
    var last = null;
    for (var i = state.messages.length - 1; i >= 0; i -= 1) {
      if (state.messages[i].role === 'assistant') {
        last = state.messages[i];
        break;
      }
    }
    setAvatar(last ? last.mood || detectMood(last.content) : 'smile');
    box.scrollTop = box.scrollHeight;
  }

  function greeting() {
    var her = state.profile.girlfriendName;
    var him = state.profile.userName;
    var passion = levelIndex(state.profile.settings.passion);
    var love = levelIndex(state.profile.settings.love);
    var variants = [
      'Привет, ' + him + '! *улыбаюсь* Я ' + her + '. Так странно и приятно — будто мы уже знакомы. Расскажешь, как прошёл твой день?',
      him + '... *тихо произношу твоё имя* Мне нравится, как оно звучит. Я ' + her + ', и я очень рада, что ты меня придумал именно такой.',
      'Ну привет, ' + him + '. *поправляю волосы и смотрю на тебя* Я ' + her + '. Надеюсь, ты настроен болтать до ночи.',
    ];
    var text = variants[Math.min(variants.length - 1, (passion + love) % variants.length)];
    if (passion >= 3) text += ' *подхожу ближе и говорю почти шёпотом* Только чур не пропадать.';
    else if (love >= 3) text += ' *обнимаю* Я уже успела соскучиться.';
    return text;
  }

  function engineLabel() {
    var rt = state.runtime;
    if (!rt) return 'движок: встроенный (офлайн)';
    if (rt.providerId === 'local') return 'движок: встроенный (офлайн)';
    var p = providerById(rt.providerId);
    return 'движок: ' + (p ? p.title : rt.providerId) + ' · ' + (rt.mode === 'server' ? 'через сервер' : 'напрямую');
  }

  function paintEngineLabel() {
    var el = $('#engine-label');
    if (el) el.textContent = engineLabel();
  }

  function enterChat() {
    $('#screen-setup').hidden = true;
    $('#screen-chat').hidden = false;
    $('#her-name').textContent = state.profile.girlfriendName;
    var passionLabel = PASSION_LABELS[levelIndex(state.profile.settings.passion)];
    var persona = null;
    for (var i = 0; i < PERSONAS.length; i += 1) if (PERSONAS[i].id === state.profile.persona) persona = PERSONAS[i];
    $('#her-tag').textContent = (persona ? persona.label + ' · ' : '') + passionLabel;
    paintEngineLabel();
    renderAllMessages();
    if (!state.messages.length) {
      var first = greeting();
      pushMessage('assistant', first, { mood: detectMood(first), via: 'greeting' });
      appendMessage({ role: 'her', content: first });
      setAvatar(detectMood(first));
      speak(first);
    }
    setTimeout(function () {
      $('#in-message').focus();
    }, 100);
  }

  /* --------------------------------------------------------- настройки */

  function openSettings() {
    var modal = $('#settings-modal');
    renderSliders($('#settings-sliders'), state.profile.settings, true);
    $('#set-provider').value = (state.runtime && state.runtime.providerId) || 'local';
    $('#set-model').innerHTML = modelList($('#set-provider').value)
      .map(function (m) {
        return '<option>' + m + '</option>';
      })
      .join('');
    if (state.runtime && state.runtime.model) $('#set-model').value = state.runtime.model;
    $('#set-api-key').value = (state.runtime && state.runtime.key) || '';
    $('#set-api-key').placeholder = store.getApiKey($('#set-provider').value)
      ? 'ключ сохранён в браузере'
      : 'оставь пустым, чтобы взять с сервера';
    if (modal.showModal) modal.showModal();
  }

  async function applySettings() {
    state.profile.settings = Object.assign({}, state.profile.settings);
    $$('#settings-sliders input[type=range]').forEach(function (input) {
      state.profile.settings[input.dataset.key] = Number(input.value);
    });
    store.saveProfile(state.profile);

    var pid = $('#set-provider').value;
    var key = $('#set-api-key').value.trim();
    if (key) store.setApiKey(pid, key);
    var model = $('#set-model').value;
    state.runtime = {
      providerId: pid,
      key: key || store.getApiKey(pid),
      mode: pid === 'local' ? 'local' : 'direct',
      model: pid === 'local' ? 'local' : model,
      source: key ? 'browser' : 'manual',
    };
    store.savePreferredProvider({ providerId: pid, model: model });

    var persona = null;
    for (var i = 0; i < PERSONAS.length; i += 1) if (PERSONAS[i].id === state.profile.persona) persona = PERSONAS[i];
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
    trackPageAlive();

    var saved = store.getProfile();
    if (saved && saved.girlfriendName && saved.userName) {
      state.profile = saved;
      state.messages = store.getMessages();
      state.memory = store.getMemory();
      void serverConfig().then(async function (cfg) {
        var candidates = detectProviders({
          server: cfg && cfg.serverKey ? { providerId: cfg.providerId, model: cfg.model || '' } : null,
          storage: store.storage,
          query: new URLSearchParams(location.search),
        });
        var pref = store.getPreferredProvider();
        var pick = await pickWorkingProvider({
          candidates: candidates,
          preferredModel: pref ? pref.model : null,
          fetchImpl: fetch.bind(window),
        });
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

    renderSliders($('#sliders'), state.profile.settings, false);
    renderPersonas($('#personas'), state.profile.persona, function (p) {
      state.profile.persona = p.id;
      state.profile.personality = p.text;
    });
    renderProviderSelects();

    var userNameInput = $('#in-user-name');
    function syncStep0() {
      $('#btn-step0-next').disabled = userNameInput.value.trim().length < 2;
    }
    userNameInput.addEventListener('input', syncStep0);
    userNameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('#btn-step0-next').click();
    });

    $('#btn-step0-next').addEventListener('click', function () {
      state.profile.userName = userNameInput.value.trim();
      setStep(1);
    });

    var girlInput = $('#in-girl-name');
    girlInput.addEventListener('input', function () {
      state.selectedName = girlInput.value.trim();
      $$('.name-chip').forEach(function (c) {
        c.classList.toggle('selected', c.textContent === state.selectedName);
      });
      syncStep1();
    });
    $('#btn-reroll').addEventListener('click', function () {
      state.nameSeed = Date.now();
      renderNames();
    });
    $('#btn-step1-next').addEventListener('click', function () {
      state.profile.girlfriendName = girlInput.value.trim();
      setStep(2);
    });

    $('#btn-step2-next').addEventListener('click', function () {
      setStep(2 + 1);
    });
    $('#btn-save-key').addEventListener('click', function () {
      void saveKeyFromForm();
    });
    $('#btn-start').addEventListener('click', function () {
      store.saveProfile(state.profile);
      store.saveMessages([]);
      store.saveMemory([]);
      enterChat();
    });

    $$('[data-back]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setStep(state.step - 1);
      });
    });

    $('#composer').addEventListener('submit', function (e) {
      e.preventDefault();
      void sendMessage($('#in-message').value);
    });

    $('#btn-voice').addEventListener('click', function () {
      state.voiceOn = !state.voiceOn;
      var btn = $('#btn-voice');
      btn.setAttribute('aria-pressed', String(state.voiceOn));
      btn.textContent = state.voiceOn ? '🔊 Голос: вкл' : '🔇 Голос: выкл';
      if (!state.voiceOn && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    });

    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-apply-settings').addEventListener('click', function () {
      void applySettings();
    });
    $('#btn-restart').addEventListener('click', function () {
      if (!confirm('Начать заново? Переписка и настройки будут удалены.')) return;
      store.reset();
      location.href = location.pathname;
    });
  }

  bind();
})();
