import '@testing-library/jest-dom'
// In-memory IndexedDB so Dexie-backed modules are testable in jsdom.
import 'fake-indexeddb/auto'

// The PWA's shared controls read the orientation through `window.matchMedia`, which jsdom does not
// provide: landscape, as a desktop browser reports. A copy of the mock in the PWA's
// src/test/setup.ts. Most files here run in `node`, with no window to give one to.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}
