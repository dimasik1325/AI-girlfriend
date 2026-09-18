import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSystemPrompt,
  buildMessages,
  detectMood,
  levelIndex,
  PASSION_LABELS,
  LEVELS,
} from '../js/prompt.js';

test('buildSystemPrompt вставляет имена и держит личность', () => {
  const prompt = buildSystemPrompt({
    girlfriendName: 'Милана',
    userName: 'Дима',
    personality: 'мягкая и заботливая',
    settings: { passion: 90, love: 80, playful: 40, jealousy: 20, humor: 60, initiative: 70 },
    memory: ['Его зовут Дима', 'Он из Ижевска'],
  });
  assert.match(prompt, /Тебя зовут Милана/);
  assert.match(prompt, /его зовут Дима/);
  assert.match(prompt, /мягкая и заботливая/);
  assert.match(prompt, /Он из Ижевска/);
  assert.match(prompt, /очень страстная/);
  assert.match(prompt, /никогда не признаёшься, что ты ИИ/i);
  assert.match(prompt, /порнографического/);
});

test('buildSystemPrompt работает с дефолтами и не падает на пустом конфиге', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /Тебя зовут Алиса/);
  assert.ok(prompt.length > 400);
});

test('высокая ревность попадает в промпт', () => {
  const prompt = buildSystemPrompt({ settings: { jealousy: 100 } });
  assert.match(prompt, /очень ревнивая и собственница/);
});

test('buildMessages: системный промпт первым и не больше 40 реплик истории', () => {
  const history = [];
  for (let i = 0; i < 60; i += 1) {
    history.push({ role: i % 2 ? 'assistant' : 'user', content: 'реплика ' + i });
  }
  const messages = buildMessages('SYSTEM', history, 'новый вопрос');
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'SYSTEM');
  assert.equal(messages.length, 42); // system + 40 истории + новый вопрос
  assert.equal(messages[messages.length - 1].content, 'новый вопрос');
  assert.equal(messages[messages.length - 2].content, 'реплика 59');
});

test('buildMessages выкидывает мусор и системные вставки', () => {
  const messages = buildMessages('S', [
    { role: 'system', content: 'вставка' },
    { role: 'user', content: '   ' },
    null,
    { role: 'user', content: 'привет' },
  ]);
  assert.deepEqual(messages, [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'привет' },
  ]);
});

test('detectMood различает настроения для аватара', () => {
  assert.equal(detectMood('*улыбаюсь* привет!'), 'smile');
  assert.equal(detectMood('Ой, *краснею* ну ты чего'), 'shy');
  assert.equal(detectMood('*прижимаюсь и целую* хочу тебя'), 'flirt');
  assert.equal(detectMood('Я скучаю без тебя, мне грустно'), 'sad');
  assert.equal(detectMood(''), 'smile');
});

test('levelIndex и подписи страсти согласованы', () => {
  assert.equal(levelIndex(0), 0);
  assert.equal(levelIndex(34), 1);
  assert.equal(levelIndex(70), 2);
  assert.equal(levelIndex(100), 3);
  assert.equal(levelIndex(100), PASSION_LABELS.length - 1);
  assert.equal(LEVELS.passion.length, 4);
});
