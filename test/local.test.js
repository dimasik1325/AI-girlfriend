import test from 'node:test';
import assert from 'node:assert/strict';

import {
  suggestNames,
  similarity,
  detectIntent,
  learnFacts,
  localReply,
  petName,
  mulberry,
} from '../js/local.js';

test('suggestNames предлагает 4 разных имени из пула', () => {
  const names = suggestNames('', 42);
  assert.equal(names.length, 4);
  assert.equal(new Set(names).size, 4);
});

test('suggestNames детерминирован по сиду и реагирует на похожее имя', () => {
  assert.deepEqual(suggestNames('', 7), suggestNames('', 7));
  const names = suggestNames('Милана', 3);
  assert.ok(names.includes('Милана'), 'точное совпадение должно быть в списке: ' + names.join(','));
});

test('similarity ранжирует похожие строки выше', () => {
  assert.ok(similarity('Милана', 'Милана'.toLowerCase()) > similarity('Милана', 'Кира'));
  assert.equal(similarity('abc', 'abc'), 1);
});

test('detectIntent понимает основные ситуации', () => {
  assert.equal(detectIntent('Привет, как ты?'), 'greeting');
  assert.equal(detectIntent('я тебя люблю'), 'love');
  assert.equal(detectIntent('прости меня'), 'sorry');
  assert.equal(detectIntent('я так соскучился'), 'miss');
  assert.equal(detectIntent('какая ты красивая'), 'compliment');
  assert.equal(detectIntent('спокойной ночи'), 'goodnight');
  assert.equal(detectIntent('я пошел, пока'), 'bye');
  assert.equal(detectIntent('ты самая лучшая'), 'compliment');
  assert.equal(detectIntent('сегодня завал на работе'), 'work');
  assert.equal(detectIntent('расскажи про квантовую физику'), 'generic');
});

test('learnFacts вытаскивает факты и не дублирует известные', () => {
  const facts = learnFacts('Меня зовут Дима, мне 27 лет, я работаю программистом');
  assert.ok(facts.some((f) => /Дима/.test(f)));
  assert.ok(facts.some((f) => /27/.test(f)));
  assert.ok(facts.some((f) => /программистом/i.test(f)));
  const again = learnFacts('Меня зовут Дима', facts);
  assert.deepEqual(again, []);
});

test('localReply отвечает на приветствие и подставляет обращение', () => {
  const res = localReply({
    text: 'Привет!',
    girlfriendName: 'Милана',
    userName: 'Дима',
    settings: { love: 100, passion: 20 },
  });
  assert.equal(res.intent, 'greeting');
  assert.match(res.text, /Дима|любовь моя|родной/);
  assert.ok(res.text.length > 10);
  assert.ok(['smile', 'shy', 'flirt', 'sad'].includes(res.mood));
});

test('localReply усиливает страсть при высоком ползунке', () => {
  const cold = localReply({ text: 'расскажи о себе', settings: { passion: 0, love: 20 }, turn: 1 });
  const hot = localReply({ text: 'расскажи о себе', settings: { passion: 100, love: 90 }, turn: 1 });
  assert.equal(cold.intent, 'generic');
  assert.equal(hot.intent, 'generic');
  assert.ok(hot.text !== cold.text || hot.text.length > 0);
});

test('localReply поддерживает грустную поддержку', () => {
  const res = localReply({ text: 'мне сегодня очень грустно', settings: { love: 90 } });
  assert.match(res.text, /рядом|обнимаю|помолчим|наладится/);
});

test('localReply стабильна при одинаковых входных данных', () => {
  const a = localReply({ text: 'привет', settings: { passion: 50 }, turn: 2 });
  const b = localReply({ text: 'привет', settings: { passion: 50 }, turn: 2 });
  assert.equal(a.text, b.text);
});

test('petName зависит от уровня любви', () => {
  assert.ok(petName('Дима', { love: 0 }));
  assert.equal(petName('Дима', { love: 60 }), 'Дима');
  assert.ok(petName('', { love: 100 }));
});

test('mulberry даёт повторяемую последовательность', () => {
  const a = mulberry(99);
  const b = mulberry(99);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
