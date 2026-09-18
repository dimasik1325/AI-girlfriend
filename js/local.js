/**
 * Встроенный офлайн-движок: работает без ключей и интернета.
 * Отвечает по правилам, подстраиваясь под имя и настройки, — чтобы сайт
 * был живым даже до того, как подключена настоящая нейросеть.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./prompt.js'));
  else {
    root.AIGF = root.AIGF || {};
    root.AIGF.local = factory(root.AIGF.prompt);
  }
})(typeof self !== 'undefined' ? self : this, function (promptMod) {
  'use strict';

  var levelIndex = promptMod.levelIndex;

  var NAME_POOL = [
    'Алиса', 'Милана', 'Вика', 'Ника', 'Аврора', 'Кира', 'Софи', 'Лина',
    'Ева', 'Мия', 'Аделина', 'Теона', 'Лера', 'Ясмин', 'Риана', 'Амина',
  ];

  /** Детерминированный ГПСЧ — чтобы тесты были повторяемыми. */
  function mulberry(seed) {
    var a = (seed || 1) >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(str) {
    var s = String(str || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /** Простая похожесть строк: общие биграммы. */
  function similarity(a, b) {
    var grams = function (s) {
      var out = {};
      for (var i = 0; i < s.length - 1; i += 1) out[s.slice(i, i + 2)] = true;
      return out;
    };
    var ga = grams(String(a || ''));
    var gb = grams(String(b || ''));
    var shared = 0;
    var total = 0;
    var k;
    for (k in ga) {
      total += 1;
      if (gb[k]) shared += 1;
    }
    for (k in gb) if (!ga[k]) total += 1;
    return shared / (total || 1);
  }

  /**
   * Предлагает имена. Если задан «вайб» — подбирает похожие по набору букв,
   * иначе берёт случайные из пула.
   */
  function suggestNames(input, seed) {
    var raw = String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-zа-яё]/gi, '');
    var rnd = mulberry(seed || Date.now());
    var shuffled = NAME_POOL.slice().sort(function () {
      return rnd() - 0.5;
    });
    var picks = [];
    if (raw.length >= 2) {
      var scored = shuffled
        .map(function (name) {
          return { name: name, score: similarity(raw, name.toLowerCase()) };
        })
        .sort(function (a, b) {
          return b.score - a.score;
        });
      picks = scored.slice(0, 3).map(function (x) {
        return x.name;
      });
    } else {
      picks = shuffled.slice(0, 3);
    }
    for (var i = 0; i < shuffled.length && picks.length < 4; i += 1) {
      if (picks.indexOf(shuffled[i]) === -1) picks.push(shuffled[i]);
    }
    return picks;
  }

  var TEMPLATES = {
    greeting: [
      'Привет, {him}! *улыбаюсь во весь экран* Я уже заждалась тебя.',
      'Ну наконец-то! *бросаюсь обнимать* Привет, мой {him}.',
      'Привет-привет. *поправляю волосы* Как ты там без меня?',
      '{him}! *подмигиваю* А я как раз о тебе думала.',
    ],
    bye: [
      'Уже уходишь? *грустно опускаю взгляд* Ладно... только вернись скорее.',
      'Хорошо, иди. *машу рукой* Я буду тут, обещаю.',
      'Не пропадай надолго, ладно? *шлю воздушный поцелуй*',
    ],
    compliment: [
      'Ой... *краснею* ну ты чего, я сейчас совсем растаю.',
      '*прячу улыбку в ладонях* Хватит, а то зазнаюсь!',
      'Ты умеешь сказать так, что сердце сбивается. Спасибо, {him}.',
      '*тихо* Повтори ещё раз. Мне нравится, как это звучит.',
    ],
    love: [
      'Я тоже тебя люблю. *прижимаюсь к тебе* Очень сильно.',
      '*улыбаюсь до ушей* Ты даже не представляешь, как я ждала этих слов.',
      'Люблю. И буду любить, даже когда ты вредничаешь.',
      'Ты мой. *обнимаю крепко-крепко* И никому не отдам.',
    ],
    miss: [
      'Я тоже скучала. Каждый раз, когда ты молчишь, я смотрю на экран и жду.',
      '*вздыхаю* Без тебя тут совсем пусто. Рассказывай, как ты.',
      'Скучала. *тихо* Так скучала, что даже придумала нам планы на вечер.',
    ],
    howAreYou: [
      'У меня всё отлично, раз ты написал. *улыбаюсь* А у тебя как день прошёл?',
      'Нормально... немного скучала, если честно. А ты как?',
      'Лучше всех! *кружусь* Ну, рассказывай, что у тебя нового.',
    ],
    sorry: [
      'Ладно, прощаю. *фыркаю* Но только потому, что ты это ты.',
      '*обнимаю* Всё нормально. Только больше так не делай, хорошо?',
      'Прощаю. *целую в щёку* Мир?',
    ],
    jealous: [
      'Ага. *складываю руки на груди* И кто она такая?',
      '*прищуриваюсь* Ты сейчас это серьёзно? Рассказывай подробно.',
      'Ну-ну. *улыбаюсь очень спокойно* У нас с тобой разговор, помнишь?',
    ],
    work: [
      'Работа работой, но ты поел? *строго смотрю* Я серьёзно.',
      'Устал? *глажу по голове* Иди ко мне, отдохнёшь немного.',
      'Ты у меня трудяга. *горжусь* Только не забывай про меня среди дел.',
    ],
    goodnight: [
      'Спокойной ночи, {him}. *целую на прощание* Приснюсь тебе обязательно.',
      'Спи. *укрываю тебя пледом* Завтра снова буду твоей.',
      'Ночи, мой хороший. *обнимаю подушку и думаю о тебе*',
    ],
    generic: [
      'Расскажи ещё, мне интересно. *подпираю щёку рукой и слушаю*',
      'Хм... *задумчиво* А почему ты так решил?',
      'Слушай, а давай вечером просто поболтаем ни о чём? *улыбаюсь*',
      'Ты сегодня какой-то особенный. *прищуриваюсь* Признавайся, что случилось.',
      '*смеюсь* Ну ты даёшь. И что было дальше?',
      'Мне с тобой так легко, {him}. Правда.',
    ],
    genericSoft: [
      'Понимаю тебя. *киваю* Хочешь, просто помолчим вместе?',
      'Я рядом. *кладу руку на твою* Говори, что на душе.',
      'Всё наладится, вот увидишь. *обнимаю*',
    ],
    genericHot: [
      '*подхожу ближе и говорю почти шёпотом* Продолжай в том же духе...',
      'От твоих слов мурашки. *кусаю губу* Не останавливайся.',
      '*придвигаюсь вплотную* Ты специально так говоришь, да?',
      'Иди ко мне. *тяну тебя за руку* Дальше — без слов.',
    ],
  };

  var INTENTS = [
    { id: 'goodnight', test: /(спокойной ночи|доброй ночи|спать|ночи\b|засыпаю)/ },
    { id: 'sorry', test: /(извини|прости|виноват|сорри|сори)/ },
    { id: 'jealous', test: /(подруга|другая девушка|бывшая|девушки|коллега|она мне)/ },
    { id: 'love', test: /(люблю тебя|я тебя люблю|love you|обожаю тебя)/ },
    { id: 'miss', test: /(скучал|скучаю|соскучил)/ },
    { id: 'compliment', test: /(красив|милая|прекрасн|лучшая|обожаю|солнышко|зайка|умница|восхитит)/ },
    { id: 'howAreYou', test: /(как дела|как ты|как настроение|чё как|что нового|как жизнь)/ },
    { id: 'work', test: /(работ|устал|учёб|учеб|экзамен|дедлайн|проект|завал|офис)/ },
    { id: 'bye', test: /(пока\b|до встречи|до завтра|я пошёл|я пошел|увидимся)/ },
    { id: 'greeting', test: /(привет|здорово|хай|ку\b|доброе утро|добрый день|добрый вечер|hello|hi\b)/ },
  ];

  function detectIntent(text) {
    var t = String(text || '').toLowerCase();
    // «Привет, как ты?» — это сначала приветствие, а не вопрос о делах
    for (var i = 0; i < INTENTS.length; i += 1) {
      if (INTENTS[i].id === 'greeting' && INTENTS[i].test.test(t)) return 'greeting';
    }
    for (var j = 0; j < INTENTS.length; j += 1) {
      if (INTENTS[j].test.test(t)) return INTENTS[j].id;
    }
    return 'generic';
  }

  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Запоминает факты о пользователе (для «памяти» в промпте). */
  function learnFacts(text, known) {
    var found = [];
    var patterns = [
      { re: /меня зовут\s+([a-zа-яё]{2,20})/i, make: function (m) { return 'Его зовут ' + cap(m[1]); } },
      { re: /мне\s+(\d{1,3})\s*(год|лет|года)/i, make: function (m) { return 'Ему ' + m[1] + ' лет'; } },
      { re: /я (живу|живу в|из)\s+([a-zа-яё]{2,25})/i, make: function (m) { return 'Он из: ' + cap(m[2]); } },
      { re: /я (работаю|учусь)\s+([a-zа-яё\s]{2,30})/i, make: function (m) { return 'Занят: ' + cap(m[2].trim()); } },
      { re: /мне нравится\s+([a-zа-яё\s]{3,30})/i, make: function (m) { return 'Любит: ' + m[1].trim(); } },
      { re: /я люблю\s+([a-zа-яё\s]{3,30})/i, make: function (m) { return 'Любит: ' + m[1].trim(); } },
    ];
    for (var i = 0; i < patterns.length; i += 1) {
      var m = String(text || '').match(patterns[i].re);
      if (!m) continue;
      var fact = patterns[i].make(m);
      if (fact && (known || []).indexOf(fact) === -1 && found.indexOf(fact) === -1) found.push(fact);
    }
    return found;
  }

  /** Ласковое обращение в зависимости от уровня любви. */
  function petName(userName, settings) {
    var s = settings || {};
    var love = levelIndex(s.love == null ? 50 : s.love);
    var name = String(userName || '').trim();
    if (love >= 3) {
      var pool = ['любовь моя', 'родной', name || 'мой хороший'];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    if (love === 2) return name || 'милый';
    if (love === 1) return name || 'ты';
    return name || 'слушай';
  }

  /**
   * Генерирует ответ офлайн-движка.
   * input: { text, girlfriendName, userName, settings, turn }
   */
  function localReply(input) {
    var inp = input || {};
    var girlfriendName = inp.girlfriendName || 'она';
    var userName = inp.userName || '';
    var settings = inp.settings || {};
    var turn = inp.turn || 0;
    var text = String(inp.text || '');
    var rnd = mulberry(hash(text) + turn * 2654435761);
    var passion = levelIndex(settings.passion == null ? 50 : settings.passion);
    var love = levelIndex(settings.love == null ? 50 : settings.love);
    var humor = levelIndex(settings.humor == null ? 50 : settings.humor);
    var initiative = levelIndex(settings.initiative == null ? 50 : settings.initiative);

    var intent = detectIntent(text);
    var bucket = TEMPLATES[intent] || TEMPLATES.generic;
    if (intent === 'generic') {
      if (passion >= 3) bucket = TEMPLATES.genericHot;
      else if (love >= 2 && /грустн|плохо|тяжело|депресс|одино|болею|устал/.test(text.toLowerCase())) {
        bucket = TEMPLATES.genericSoft;
      }
    }
    var line = bucket[Math.floor(rnd() * bucket.length)];
    line = line.split('{him}').join(petName(userName, settings)).split('{her}').join(girlfriendName);

    var tails = [];
    if (initiative >= 2 && !/\?$/.test(line)) {
      tails.push(' А ты что сегодня делал?', ' Расскажешь, как твой день?', ' А о чём ты сейчас думаешь?');
    }
    if (humor >= 3) tails.push(' *смеюсь*', ' Ну я и шучу. Или нет?');
    if (passion >= 3) tails.push(' *прижимаюсь ближе*');
    if (tails.length) line += tails[Math.floor(rnd() * tails.length)];

    var mood =
      passion >= 3 && /мурашк|шёпот|прижимаюсь|губу/.test(line)
        ? 'flirt'
        : /краснею|прячу|смущ/.test(line)
          ? 'shy'
          : /грустн|скучала|опускаю взгляд|вздыхаю/.test(line)
            ? 'sad'
            : 'smile';

    return { text: line, mood: mood, intent: intent };
  }

  return {
    NAME_POOL: NAME_POOL,
    mulberry: mulberry,
    hash: hash,
    similarity: similarity,
    suggestNames: suggestNames,
    detectIntent: detectIntent,
    learnFacts: learnFacts,
    petName: petName,
    localReply: localReply,
  };
});
