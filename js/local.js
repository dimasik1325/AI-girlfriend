/**
 * Встроенный офлайн-движок: работает без ключей и интернета.
 * Отвечает по правилам, подстраиваясь под имя и настройки, — чтобы сайт
 * был живым даже до того, как подключена настоящая нейросеть.
 */

import { levelIndex } from './prompt.js';

export const NAME_POOL = [
  'Алиса', 'Милана', 'Вика', 'Ника', 'Аврора', 'Кира', 'Софи', 'Лина',
  'Ева', 'Мия', 'Аделина', 'Теона', 'Лера', 'Ясмин', 'Риана', 'Амина',
];

/**
 * Предлагает имена. Если задан «вайб» — подбирает похожие по набору букв,
 * иначе берёт случайные из пула. Своё имя из ввода всегда добавляется первым.
 */
export function suggestNames(input = '', seed = Date.now()) {
  const raw = String(input || '').trim().toLowerCase().replace(/[^a-zа-яё]/gi, '');
  const rnd = mulberry(seed);
  const shuffled = NAME_POOL.slice().sort(() => rnd() - 0.5);
  let picks = [];
  if (raw.length >= 2) {
    const scored = shuffled
      .map((name) => ({ name, score: similarity(raw, name.toLowerCase()) }))
      .sort((a, b) => b.score - a.score);
    picks = scored.slice(0, 3).map((x) => x.name);
  } else {
    picks = shuffled.slice(0, 3);
  }
  for (const extra of shuffled) {
    if (picks.length >= 4) break;
    if (!picks.includes(extra)) picks.push(extra);
  }
  return picks;
}

/** Простая похожесть строк: общие биграммы. */
export function similarity(a = '', b = '') {
  const grams = (s) => {
    const out = new Set();
    for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
    return out;
  };
  const ga = grams(String(a));
  const gb = grams(String(b));
  let shared = 0;
  ga.forEach((g) => {
    if (gb.has(g)) shared += 1;
  });
  const total = new Set([...ga, ...gb]).size || 1;
  return shared / total;
}

/** Детерминированный ГПСЧ — чтобы тесты были повторяемыми. */
export function mulberry(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEMPLATES = {
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
    'Ладно, прощаю. *фyrкаю* Но только потому, что ты это ты.',
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

const INTENTS = [
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

export function detectIntent(text = '') {
  const t = String(text).toLowerCase();
  // «Привет, как ты?» — это сначала приветствие, а не вопрос о делах
  if (INTENTS.find((i) => i.id === 'greeting').test.test(t)) return 'greeting';
  for (const intent of INTENTS) {
    if (intent.test.test(t)) return intent.id;
  }
  return 'generic';
}

/** Запоминает факты о пользователе (для «памяти» в промпте). */
export function learnFacts(text = '', known = []) {
  const found = [];
  const patterns = [
    { re: /меня зовут\s+([a-zа-яё]{2,20})/i, make: (m) => 'Его зовут ' + cap(m[1]) },
    { re: /мне\s+(\d{1,3})\s*(год|лет|года)/i, make: (m) => 'Ему ' + m[1] + ' лет' },
    { re: /я (живу|живу в|из)\s+([a-zа-яё]{2,25})/i, make: (m) => 'Он из: ' + cap(m[2]) },
    { re: /я (работаю|учусь)\s+([a-zа-яё\s]{2,30})/i, make: (m) => 'Занят: ' + cap(m[2].trim()) },
    { re: /мне нравится\s+([a-zа-яё\s]{3,30})/i, make: (m) => 'Любит: ' + m[1].trim() },
    { re: /я люблю\s+([a-zа-яё\s]{3,30})/i, make: (m) => 'Любит: ' + m[1].trim() },
  ];
  for (const p of patterns) {
    const m = String(text).match(p.re);
    if (!m) continue;
    const fact = p.make(m);
    if (fact && !known.includes(fact) && !found.includes(fact)) found.push(fact);
  }
  return found;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ласковое обращение в зависимости от уровня любви. */
export function petName(userName, settings = {}) {
  const love = levelIndex(settings.love ?? 50);
  const name = String(userName || '').trim();
  if (love >= 3) return ['любовь моя', 'родной', name || 'мой хороший'][Math.floor(Math.random() * 3)];
  if (love === 2) return name || 'милый';
  if (love === 1) return name || 'ты';
  return name || 'слушай';
}

/**
 * Генерирует ответ офлайн-движка.
 * @param {{text: string, girlfriendName?: string, userName?: string,
 *          settings?: Object, history?: Object[], turn?: number}} input
 * @returns {{text: string, mood: 'smile'|'shy'|'flirt'|'sad'}}
 */
export function localReply(input = {}) {
  const { girlfriendName = 'она', userName = '', settings = {}, turn = 0 } = input;
  const text = String(input.text || '');
  const rnd = mulberry(hash(text) + turn * 2654435761);
  const passion = levelIndex(settings.passion ?? 50);
  const love = levelIndex(settings.love ?? 50);
  const humor = levelIndex(settings.humor ?? 50);
  const initiative = levelIndex(settings.initiative ?? 50);

  const intent = detectIntent(text);
  let bucket = TEMPLATES[intent] || TEMPLATES.generic;
  if (intent === 'generic') {
    if (passion >= 3) bucket = TEMPLATES.genericHot;
    else if (love >= 2 && /грустн|плохо|тяжело|депресс|одино|болею|устал/.test(text.toLowerCase())) {
      bucket = TEMPLATES.genericSoft;
    }
  }
  let line = bucket[Math.floor(rnd() * bucket.length)];
  line = line.replace(/\{him\}/g, petName(userName, settings)).replace(/\{her\}/g, girlfriendName);

  const tails = [];
  if (initiative >= 2 && !/\?$/.test(line)) {
    tails.push(' А ты что сегодня делал?', ' Расскажешь, как твой день?', ' А о чём ты сейчас думаешь?');
  }
  if (humor >= 3) tails.push(' *смеюсь*', ' Ну я и шучу. Или нет?');
  if (passion >= 3) tails.push(' *прижимаюсь ближе*');
  if (tails.length) line += tails[Math.floor(rnd() * tails.length)];

  const mood = passion >= 3 && /мурашк|шёпот|прижимаюсь|губу/.test(line) ? 'flirt'
    : /краснею|прячу|смущ/.test(line) ? 'shy'
    : /грустн|скучала|опускаю взгляд|вздыхаю/.test(line) ? 'sad'
    : 'smile';

  return { text: line, mood, intent };
}

export function hash(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
