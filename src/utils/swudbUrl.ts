export const normaliseSwudbUrl = (url: string): string =>
  url.replace('/deck/edit/', '/deck/')

export const isValidSwudbUrl = (url: string): boolean =>
  /^https:\/\/swudb\.com\/deck\/[A-Za-z0-9]+$/.test(url)

export interface SwudbDeckResult {
  deckName: string
  baseKey: string
}

export async function fetchSwudbDeck(deckId: string): Promise<SwudbDeckResult> {
  try {
    const response = await fetch(`https://swu-proxy.dmgctrl.workers.dev/swudb/deck/${deckId}`)
    if (!response.ok) throw new Error('Deck not accessible')
    const data = await response.json()
    return {
      deckName: data.deckName,
      baseKey: `${data.base.defaultExpansionAbbreviation}-${data.base.defaultCardNumber}`,
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'Deck not accessible') throw e
    throw new Error('Deck not accessible')
  }
}