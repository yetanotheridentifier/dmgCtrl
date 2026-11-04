// Gives Vitest's `expect` the jest-dom matchers' types (toBeInTheDocument, toHaveTextContent, ...).
// jest-dom's own augmentation targets `Assertion<T>`, which Vitest 5 changed to `Assertion<R, T>`,
// so it no longer merges and every matcher is a type error (testing-library/jest-dom #738).
// `Matchers` is the interface Vitest 5 asks custom matchers to extend. Delete this file once
// jest-dom ships a fix. A copy of src/test/jestDomVitest.d.ts in the PWA: keep the two identical.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'vitest' {
  // Merging with Vitest's `Matchers<R, T>` needs the same type parameters, T included, and the
  // interface adds nothing but what it extends.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<unknown, R> {}
}
