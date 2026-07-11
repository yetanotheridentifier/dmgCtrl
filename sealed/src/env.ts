/** True under the Vite dev server, false in a production build. Wrapped in a
 *  function so components can be tested for both cases by mocking this module. */
export function isDev(): boolean {
  return import.meta.env.DEV
}
