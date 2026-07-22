import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../app/settings-storage.js';

test('settings can be saved and loaded from storage', () => {
  const storage = new Map();
  const store = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };

  const updated = {
    ...DEFAULT_SETTINGS,
    freeipa: {
      ...DEFAULT_SETTINGS.freeipa,
      url: 'https://ipa.example.test',
      realm: 'EXAMPLE.TEST',
    },
    xyops: {
      ...DEFAULT_SETTINGS.xyops,
      url: 'https://xyops.example.test',
      apiKey: 'secret-key',
    },
  };

  saveSettings(updated, store);
  assert.deepEqual(loadSettings(store), updated);
});
