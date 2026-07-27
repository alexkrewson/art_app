// Vitest global setup. Registers a real (in-memory) IndexedDB implementation
// so src/cache/imageCache.js's indexedDB/IDBKeyRange calls work under jsdom,
// which doesn't implement IndexedDB itself.
import 'fake-indexeddb/auto';
