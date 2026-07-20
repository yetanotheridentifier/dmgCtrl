/**
 * The favicon for the current environment: the **white** dmgCtrl icon in dev
 * (so the dev.dmgctrl.app tab is easy to tell apart), the standard **blue** icon
 * in prod. Paths are under the app base (`/sealed/`).
 */
export function faviconHref(isDev: boolean, baseUrl: string): string {
  return `${baseUrl}${isDev ? 'dmgctrl-icon-192-white.svg' : 'dmgCtrl-icon-192.png'}`
}

/** Point the page's `<link id="favicon">` at the right icon for the environment. */
export function applyFavicon(isDev: boolean, baseUrl: string): void {
  const link = document.getElementById('favicon') as HTMLLinkElement | null
  if (link) link.href = faviconHref(isDev, baseUrl)
}
