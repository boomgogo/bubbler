// Where the places come from. Lantern Lake is part of the game; every other place is its own
// small chunk, fetched after Play so it never delays the first screen.
import lake from './lake.js';

const LOADERS = {
  lake: () => Promise.resolve({ default: lake }),
  fjord: () => import('./fjord.js'),
  marsh: () => import('./marsh.js'),
  lagoon: () => import('./lagoon.js'),
  harbour: () => import('./harbour.js'),
};

const loading = new Map();

export { lake };

// Resolves to the place module. A failed fetch is forgotten, so the next call tries again.
export function loadPlace(id) {
  if (!loading.has(id)) {
    const promise = (LOADERS[id] ?? LOADERS.lake)().then((m) => m.default);
    promise.catch(() => loading.delete(id));
    loading.set(id, promise);
  }
  return loading.get(id);
}
