// localStorage with the failures swallowed: private windows and blocked storage must not break the game.
const PREFIX = 'bubbler:';

export const store = {
  get(name, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + name);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(name, value) {
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify(value));
    } catch {
      // Nothing to do: the game simply will not remember this.
    }
  },
  remove(name) {
    try {
      localStorage.removeItem(PREFIX + name);
    } catch {
      // As above.
    }
  },
};
