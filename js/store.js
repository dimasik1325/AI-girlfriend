/**
 * Хранилище: всё живёт в localStorage браузера, ничего никуда не отправляется.
 */

const KEY_PROFILE = 'aigf.profile';
const KEY_MESSAGES = 'aigf.messages';
const KEY_MEMORY = 'aigf.memory';
const KEY_PROVIDER = 'aigf.provider';

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export function createStore(storage) {
  const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const get = (key, fallback) => (s ? safeParse(s.getItem(key), fallback) : fallback);
  const set = (key, value) => {
    if (!s) return;
    try {
      s.setItem(key, JSON.stringify(value));
    } catch {
      /* переполнение или приватный режим — просто работаем в памяти */
    }
  };
  return {
    get storage() {
      return s;
    },
    getProfile: () => get(KEY_PROFILE, null),
    saveProfile: (profile) => set(KEY_PROFILE, profile),
    getMessages: () => get(KEY_MESSAGES, []),
    saveMessages: (messages) => set(KEY_MESSAGES, messages),
    getMemory: () => get(KEY_MEMORY, []),
    saveMemory: (facts) => set(KEY_MEMORY, facts),
    getPreferredProvider: () => get(KEY_PROVIDER, null),
    savePreferredProvider: (pref) => set(KEY_PROVIDER, pref),
    setApiKey: (providerId, key) => {
      if (!s) return;
      if (key) s.setItem('aigf.key.' + providerId, String(key).trim());
      else s.removeItem('aigf.key.' + providerId);
    },
    getApiKey: (providerId) => (s ? (s.getItem('aigf.key.' + providerId) || '').trim() : ''),
    reset: () => {
      if (!s) return;
      [KEY_PROFILE, KEY_MESSAGES, KEY_MEMORY].forEach((k) => s.removeItem(k));
    },
  };
}
