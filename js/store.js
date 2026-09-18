/**
 * Хранилище: всё живёт в localStorage браузера, ничего никуда не отправляется.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else {
    root.AIGF = root.AIGF || {};
    root.AIGF.store = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY_PROFILE = 'aigf.profile';
  var KEY_MESSAGES = 'aigf.messages';
  var KEY_MEMORY = 'aigf.memory';
  var KEY_PROVIDER = 'aigf.provider';

  function safeParse(raw, fallback) {
    try {
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function createStore(storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    function get(key, fallback) {
      if (!s) return fallback;
      try {
        return safeParse(s.getItem(key), fallback);
      } catch (e) {
        return fallback;
      }
    }
    function set(key, value) {
      if (!s) return;
      try {
        s.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* переполнение или приватный режим — просто работаем в памяти */
      }
    }
    return {
      get storage() {
        return s;
      },
      getProfile: function () {
        return get(KEY_PROFILE, null);
      },
      saveProfile: function (profile) {
        set(KEY_PROFILE, profile);
      },
      getMessages: function () {
        return get(KEY_MESSAGES, []);
      },
      saveMessages: function (messages) {
        set(KEY_MESSAGES, messages);
      },
      getMemory: function () {
        return get(KEY_MEMORY, []);
      },
      saveMemory: function (facts) {
        set(KEY_MEMORY, facts);
      },
      getPreferredProvider: function () {
        return get(KEY_PROVIDER, null);
      },
      savePreferredProvider: function (pref) {
        set(KEY_PROVIDER, pref);
      },
      setApiKey: function (providerId, key) {
        if (!s) return;
        if (key) s.setItem('aigf.key.' + providerId, String(key).trim());
        else s.removeItem('aigf.key.' + providerId);
      },
      getApiKey: function (providerId) {
        if (!s) return '';
        try {
          return (s.getItem('aigf.key.' + providerId) || '').trim();
        } catch (e) {
          return '';
        }
      },
      reset: function () {
        if (!s) return;
        [KEY_PROFILE, KEY_MESSAGES, KEY_MEMORY].forEach(function (k) {
          s.removeItem(k);
        });
      },
    };
  }

  return { createStore: createStore };
});
