import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDecks } from './useDecks'
import type { ImportResult } from './useDecks'
import { primeCards } from './useCardLookup'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import { cachedSetCards, cachedSetCount, importSet } from '../data/setImport'
import { syncCatalogue } from '../data/catalogueSync'
import type { CardRef } from '../data/catalogueSync'
import { loadSetup, saveSetup } from '../data/setupStore'
import type { Setup } from '../data/setupStore'
import { SET_PROGRESS, printedCardCount } from '../data/implementedCards'
import { generateRandomDeck, generationOptions, GENERATED_DECK_ID } from '../deckgen/randomDeck'
import type { GeneratedDeck, GenerationChoice, GenerationOptions } from '../deckgen/randomDeck'
import { DECK_SIZE } from '../deckgen/rules'
import { cardRefFromId } from '../utils/parseProtectThePod'
import type { ParsedDeck } from '../utils/parseProtectThePod'
import { deckSet } from '../components/setup/deckSummary'

/**
 * The Sealed setup screen's state and what it does, apart from how it looks: the deck chosen, the
 * opponent, the sets each generator builds from and the caching that makes them buildable.
 */

/** The sets a generator can be pointed at, newest first: the implementation manifest's. */
export const SET_CODES = SET_PROGRESS.map(s => s.code)

/** The random pick among the player's own decks, as an opponent choice. */
export const ANY_OF_MY_DECKS = 'random'

/** One generator's pool: every cached card of the set that side builds from. */
export interface Pool {
  set: string
  cards: SwuCard[]
}

/**
 * The cards a deck names, leader and base first: they carry the highest display priority, and
 * `syncCatalogue` hydrates in the order it is given.
 */
function deckRefs(deck: ParsedDeck): CardRef[] {
  return [deck.leader, deck.base, ...deck.cards.map(c => c.id)]
    .map(cardRefFromId)
    .filter((ref): ref is CardRef => ref !== null)
}

/**
 * The opponent a choice resolves to.
 *
 * `generated` builds a fresh deck per game, so playing twice against it is two different decks. While
 * nothing can be generated it falls back to a pick among the player's own decks rather than mirroring
 * the deck being played. That pick never returns a generated deck, and it can be the deck played.
 */
function pickOpponent(decks: SavedDeck[], choice: string, fallback: SavedDeck, generate: () => SavedDeck | null): SavedDeck {
  if (choice === GENERATED_DECK_ID) {
    const generated = generate()
    if (generated) return generated
  } else if (choice !== ANY_OF_MY_DECKS) {
    return decks.find(d => d.id === choice) ?? fallback
  }
  if (decks.length === 0) return fallback
  return decks[Math.floor(Math.random() * decks.length)]
}

/** A different deck every time: the seed is what makes one reproducible after the fact. */
function buildGenerated(from: Pool | null, choice: GenerationChoice = {}): GeneratedDeck | null {
  if (!from) return null
  return generateRandomDeck(from.cards, Math.floor(Math.random() * 1_000_000) + 1, choice)
}

/**
 * The pool one generator builds from, or `null` while its set has nothing cached. Reads the local
 * cache only: fetching is `ensureSet`'s job. `cacheVersion` changes once a fetch finishes, which is
 * what brings a newly cached set in. The pool's cards join the card lookup, so a deck generated from it
 * shows without fetching a card.
 */
function useCachedPool(set: string, cacheVersion: number): Pool | null {
  const [pool, setPool] = useState<Pool | null>(null)
  useEffect(() => {
    let live = true
    void cachedSetCards(set).then(cards => {
      if (!live) return
      primeCards(cards)
      setPool(cards.length > 0 ? { set, cards } : null)
    })
    return () => { live = false }
  }, [set, cacheVersion])
  return pool?.set === set ? pool : null
}

/**
 * What a generator says about its pool: the set is either here with the number of cards behind it,
 * or not here yet with whatever its fetch last reported.
 */
function poolSummary(set: string, pool: Pool | null, fetchStatus: string | undefined, cannotBuild = false): string {
  if (!pool) return fetchStatus ?? `Caching ${set}…`
  const lead = cannotBuild ? `Cannot fill a ${DECK_SIZE}-card deck from` : 'Built from'
  return `${lead} ${pool.set} (${pool.cards.length} cards cached)`
}

export interface SealedSetup {
  decks: SavedDeck[]
  /** The deck the player will play: a saved deck, or a generated one in use. */
  chosen: SavedDeck | null
  chooseDeck: (id: string) => void
  importDeck: (text: string) => ImportResult
  removeDeck: (id: string) => void

  /** The set the player's generator builds from. */
  playerSet: string
  setPlayerSet: (code: string) => void
  /** The deck on the Generate view, not yet in use. */
  generated: GeneratedDeck | null
  /** What the Generate view says while it has no deck, or why it has none. */
  generatedStatus: string
  /** Whether the player's generator has a pool to build from yet. */
  canGenerate: boolean
  generate: () => void
  /** Choose the deck on the Generate view as the one to play. */
  takeGenerated: () => void

  linkSets: boolean
  setLinkSets: (linked: boolean) => void
  /** The set a generated opponent builds from: the chosen deck's while linked. */
  opponentSet: string
  setOpponentSet: (code: string) => void
  opponentPoolSummary: string
  /** The leaders and base aspects the opponent's set offers, once it is cached. */
  options: GenerationOptions | null
  /** The opponent's set's cached cards, or none while it is caching. */
  opponentPool: SwuCard[]
  /** `generated`, `random` or a saved deck's id. */
  opponentChoice: string
  setOpponentChoice: (choice: string) => void
  /** A leader id, or '' for random: always one the opponent's set offers. */
  opponentLeader: string
  setOpponentLeader: (id: string) => void
  /** A base aspect, or '' for random: always one the opponent's set offers. */
  opponentAspect: string
  setOpponentAspect: (aspect: string) => void

  play: () => Promise<void>
}

export function useSealedSetup(onPlay: (deck: SavedDeck, opponent: SavedDeck) => void): SealedSetup {
  const { decks, importDeck: importStored, removeDeck: removeStored } = useDecks()
  // The choices as the player last left them, saved on each change rather than on every render.
  const [setup, setSetup] = useState(loadSetup)
  const update = (patch: Partial<Setup>) => {
    setSetup(current => {
      const next = { ...current, ...patch }
      saveSetup(next)
      return next
    })
  }
  // A generated deck in use is held here alone: it is never kept, so it is not in the setup.
  const [inUse, setInUse] = useState<GeneratedDeck | null>(null)
  const chosen = inUse?.deck ?? decks.find(d => d.id === setup.playerDeck) ?? null

  const { playerSet, linkSets, opponentLeader, opponentAspect } = setup
  // Linked, a generated opponent builds from the chosen deck's set, or the player's generator's while
  // no deck is chosen. A deck from a set the manifest does not list keeps to the generator's.
  const chosenSet = chosen ? deckSet(chosen) : null
  const linkedSet = chosenSet && SET_CODES.includes(chosenSet) ? chosenSet : playerSet
  const opponentSet = linkSets ? linkedSet : setup.opponentSet
  // A remembered deck deleted since is not a choice, so the default stands in for it.
  const opponentChoice = [GENERATED_DECK_ID, ANY_OF_MY_DECKS].includes(setup.opponentChoice) || decks.some(d => d.id === setup.opponentChoice)
    ? setup.opponentChoice
    : GENERATED_DECK_ID

  const [cacheVersion, setCacheVersion] = useState(0)
  // How each set asked for is getting on, keyed by set code: the line a generator with no pool shows.
  const [fetchStatus, setFetchStatus] = useState<Record<string, string>>({})
  // Each set's fetch, once asked for, claimed synchronously so two generators on one set fetch once.
  const requestedSets = useRef(new Map<string, Promise<void>>())
  const syncedDecks = useRef(new Set<string>())
  // A fetch outlives the screen, so every report checks it is still there to report into.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const pool = useCachedPool(playerSet, cacheVersion)
  const opponentPool = useCachedPool(opponentSet, cacheVersion)
  const options = useMemo(() => (opponentPool ? generationOptions(opponentPool.cards) : null), [opponentPool])
  const [generated, setGenerated] = useState<GeneratedDeck | null>(null)
  const [cannotBuild, setCannotBuild] = useState(false)

  // A leader or a base aspect belongs to a pool: one the opponent's set does not offer reads as random,
  // and changing the set back brings the choice back with it.
  const leaderChoice = options?.leaders.some(l => l.id === opponentLeader) ? opponentLeader : ''
  const aspectChoice = options?.aspects.includes(opponentAspect) ? opponentAspect : ''

  /**
   * Cache a set the screen needs, at most once per set, resolving once it is cached or has failed. A
   * failure releases the claim, so asking again retries. Cached means every printed card is here: a
   * deck list caches its own cards one at a time, so a set holding a handful is fetched whole.
   */
  const ensureSet = useCallback((code: string): Promise<void> => {
    const set = code.toUpperCase()
    const pending = requestedSets.current.get(set)
    if (pending) return pending
    const fetching = (async () => {
      if (await cachedSetCount(set) >= (printedCardCount(set) ?? 1)) return
      const report = (line: string) => {
        if (mounted.current) setFetchStatus(s => ({ ...s, [set]: line }))
      }
      report(`Caching ${set}…`)
      try {
        const result = await importSet(set, { onProgress: (done, total) => report(`Caching ${set}… ${done}/${total}`) })
        report(`${result.cached} cards cached for ${set}`)
      } catch (err) {
        report(err instanceof Error ? err.message : String(err))
        requestedSets.current.delete(set)
      } finally {
        if (mounted.current) {
          setCacheVersion(v => v + 1)
          setCannotBuild(false)
        }
      }
    })()
    requestedSets.current.set(set, fetching)
    return fetching
  }, [])

  // Each generator caches the set it is pointed at, on open as well as on a change, and nothing else.
  useEffect(() => {
    for (const set of new Set([playerSet, opponentSet])) void ensureSet(set)
  }, [playerSet, opponentSet, ensureSet])

  // Each saved deck caches the cards it names, once, so it can be viewed and played offline.
  useEffect(() => {
    for (const deck of decks) {
      if (syncedDecks.current.has(deck.id)) continue
      syncedDecks.current.add(deck.id)
      void syncCatalogue(deckRefs(deck))
    }
  }, [decks])

  // Stable per pool, so a view that generates once a pool arrives does not run again on every render.
  const generate = useCallback(() => {
    const next = buildGenerated(pool)
    setGenerated(next)
    setCannotBuild(pool !== null && next === null)
  }, [pool])

  async function play() {
    if (!chosen) return
    const choice = { leaderId: leaderChoice || undefined, baseAspect: aspectChoice || undefined }
    let from = opponentPool
    if (opponentChoice === GENERATED_DECK_ID && !from) {
      await ensureSet(opponentSet)
      const cards = await cachedSetCards(opponentSet)
      from = cards.length > 0 ? { set: opponentSet, cards } : null
    }
    onPlay(chosen, pickOpponent(decks, opponentChoice, chosen, () => buildGenerated(from, choice)?.deck ?? null))
  }

  return {
    decks,
    chosen,
    chooseDeck: id => {
      setInUse(null)
      update({ playerDeck: id })
    },
    importDeck: text => {
      const result = importStored(text)
      if (result.ok) {
        setInUse(null)
        update({ playerDeck: result.deck.id })
      }
      return result
    },
    removeDeck: id => {
      removeStored(id)
      if (setup.playerDeck === id) update({ playerDeck: '' })
    },

    playerSet,
    setPlayerSet: code => {
      // A deck built from the set chosen a moment ago is not a deck from this one.
      setGenerated(null)
      setCannotBuild(false)
      update({ playerSet: code })
    },
    generated,
    generatedStatus: poolSummary(playerSet, pool, fetchStatus[playerSet], cannotBuild),
    canGenerate: pool !== null,
    generate,
    takeGenerated: () => {
      if (!generated) return
      setInUse(generated)
      update({ playerDeck: '' })
    },

    linkSets,
    // Unlinking starts the opponent on the set it was building from, so the different set is chosen
    // from there rather than from whatever was last stored.
    setLinkSets: linked => update(linked ? { linkSets: true } : { linkSets: false, opponentSet: linkedSet }),
    opponentSet,
    setOpponentSet: code => update({ opponentSet: code }),
    opponentPoolSummary: poolSummary(opponentSet, opponentPool, fetchStatus[opponentSet]),
    options,
    opponentPool: opponentPool?.cards ?? [],
    opponentChoice,
    setOpponentChoice: choice => update({ opponentChoice: choice }),
    opponentLeader: leaderChoice,
    setOpponentLeader: id => update({ opponentLeader: id }),
    opponentAspect: aspectChoice,
    setOpponentAspect: aspect => update({ opponentAspect: aspect }),

    play,
  }
}
