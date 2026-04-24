export const normaliseSwudbUrl = (url: string): string =>
  url.replace('/deck/edit/', '/deck/')

export const isValidSwudbUrl = (url: string): boolean =>
  /^https:\/\/swudb\.com\/deck\/[A-Za-z0-9]+$/.test(url)