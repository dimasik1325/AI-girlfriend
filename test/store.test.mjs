import test from 'node:test';
import assert from 'node:assert/strict';

import storeMod from '../js/store.js';
import { memoryStorage } from './helpers.mjs';

const { createStore } = storeMod;

test('store сохраняет профиль, сообщения и память', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.getProfile(), null);
  assert.deepEqual(store.getMessages(), []);

  store.saveProfile({ userName: 'Дима', girlfriendName: 'Милана', settings: { passion: 80 } });
  assert.equal(store.getProfile().girlfriendName, 'Милана');

  store.saveMessages([{ role: 'user', content: 'привет' }]);
  assert.equal(store.getMessages().length, 1);

  store.saveMemory(['Его зовут Дима']);
  assert.deepEqual(store.getMemory(), ['Его зовут Дима']);

  store.reset();
  assert.equal(store.getProfile(), null);
  assert.deepEqual(store.getMessages(), []);
});

test('store переживает битый JSON и приватный режим', () => {
  const dirty = memoryStorage({ 'aigf.profile': '{не json' });
  const store = createStore(dirty);
  assert.equal(store.getProfile(), null);

  const readonly = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  const safe = createStore(readonly);
  safe.saveProfile({ girlfriendName: 'Ника' });
  assert.equal(safe.getProfile(), null);
});

test('store работает без хранилища (например, в Node без DOM)', () => {
  const store = createStore(null);
  store.saveMessages([{ role: 'user', content: 'x' }]);
  assert.deepEqual(store.getMessages(), []);
  store.setApiKey('openai', 'sk-1');
  assert.equal(store.getApiKey('openai'), '');
});

test('store хранит ключи по провайдерам отдельно', () => {
  const store = createStore(memoryStorage());
  store.setApiKey('openai', ' sk-1 ');
  store.setApiKey('groq', 'gsk_1');
  assert.equal(store.getApiKey('openai'), 'sk-1');
  assert.equal(store.getApiKey('groq'), 'gsk_1');
  store.setApiKey('openai', '');
  assert.equal(store.getApiKey('openai'), '');
});
