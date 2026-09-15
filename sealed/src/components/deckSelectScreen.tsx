import { useState, useEffect, useMemo } from 'react'
import { useDecks } from '../hooks/useDecks'
import type { SavedDeck } from '../data/deckStore'
import type { SwuCard } from '../data/cards'
import { largestCachedSet } from '../data/setImport'
import { generateRandomDeck, generationOptions, GENERATED_DECK_ID } from '../deckgen/randomDeck'
import { buildCardDb } from '../engine/cardDb'
import { StaticCardRef } from './cardRef'
import type { GeneratedDeck, GeneratedDeckEntry, GenerationChoice } from '../deckgen/randomDeck'
import { DECK_SIZE } from '../deckgen/rules'
import type { EngineCard } from '../engine/types'
import { cardRefFromId } from '../utils/parseProtectThePod'
import type { ParseDeckError, ParsedDeck } from '../utils/parseProtectThePod'
import { syncCatalogue } from '../data/catalogueSync'
import { importSet } from '../data/setImport'
import type { CardRef } from '../data/catalogueSync'
import { TOTAL_PROGRESS, SET_PROGRESS, CARD_TYPES, sumCounts } from '../data/implementedCards'
import type { SetProgress, SetGroup, TypeCounts } from '../data/implementedCards'

interface Props {
  onPlay: (deck: SavedDeck, opponentDeck: SavedDeck) => void
}

const ERROR_MESSAGES: Record<ParseDeckError, string> = {
  'invalid-json': "Couldn't read that. Check you've pasted the ProtectThePod JSON export.",
  'invalid-format': "That JSON doesn't look like a deck export.",
  'missing-leader': 'Deck must include exactly 1 leader.',
  'missing-base': 'Deck must include exactly 1 base.',
  'too-few-cards': 'Deck must have at least 30 cards.',
}

function deckRefs(deck: ParsedDeck): CardRef[] {
  const ids = [deck.leader, deck.base, ...deck.cards.map(c => c.id)]
  return ids
    .map(cardRefFromId)
    .filter((ref): ref is CardRef => ref !== null)
}

function cardCount(deck: SavedDeck): number {
  return deck.cards.reduce((n, c) => n + c.count, 0)
}

/**
 * The opponent a choice resolves to.
 *
 * `generated` builds a fresh deck per game rather than reusing the one on screen, so playing twice
 * against it is two different decks: the point is exercising the generator, not a fixed sparring
 * partner. It is the default, so while no set is cached it falls back to `random` rather than
 * mirroring the player's own deck. `random` picks among the player's own imported decks only and never
 * returns a generated one, which is why it reads "Random built deck".
 */
function pickOpponent(
  decks: SavedDeck[],
  choice: string,
  fallback: SavedDeck,
  generate: () => SavedDeck | null,
): SavedDeck {
  if (choice === GENERATED_DECK_ID) {
    const generated = generate()
    if (generated) return generated
  } else if (choice !== 'random') {
    return decks.find(d => d.id === choice) ?? fallback
  }
  if (decks.length === 0) return fallback
  return decks[Math.floor(Math.random() * decks.length)]
}

const pctOf = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 100))

/** The accent select every opponent choice uses, so the three read as one group of controls. */
const SELECT_CLASS = 'w-full bg-transparent border-2 border-accent rounded-xl px-3 py-1.5 text-sm text-ink shadow-[0_0_12px_rgba(79,195,247,0.3)] focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed'

/**
 * Rarity shown as its initial and coloured, since the column has to stay narrow enough that the card
 * name gets the width. Reading a deck's rarity mix at a glance is the point: a pool that could never
 * produce it shows up as a column of L's and R's.
 */
const RARITY_CLASS: Record<string, string> = {
  Legendary: 'text-amber',
  Special: 'text-amber',
  Rare: 'text-accent',
  Uncommon: 'text-ink-dim',
  Common: 'text-ink-faint',
}

/**
 * One card-type block of a generated deck list: a heading carrying the count, then a row per card.
 *
 * Renders nothing when empty rather than an empty heading, so a deck with no upgrades simply has no
 * Upgrades block instead of a heading promising rows that are not there.
 */
function DeckSection({ title, entries, cardDb }: {
  title: string
  entries: GeneratedDeckEntry[]
  cardDb: Record<string, EngineCard> | null
}) {
  if (entries.length === 0) return null
  const copies = entries.reduce((n, c) => n + c.count, 0)
  return (
    <section className="mb-2">
      <h4 className="text-ink-faint text-[0.65rem] uppercase tracking-[0.12em] font-light">
        {title} <span className="tabular-nums">({copies})</span>
      </h4>
      <ul>
        {entries.map(c => (
          <li key={c.id} className="flex items-baseline gap-2 py-0.5">
            <span className="text-ink-faint w-4 shrink-0 text-right tabular-nums">{c.cost}</span>
            <span className="truncate">
              <StaticCardRef card={cardDb?.[c.id]} text={c.name} />
            </span>
            <span className={`shrink-0 ml-auto ${RARITY_CLASS[c.rarity] ?? 'text-ink-faint'}`}>
              {c.rarity.slice(0, 1)}
            </span>
            <span className="text-ink-faint shrink-0 w-6 text-right tabular-nums">x{c.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Headline "% of every set implemented" bar. */
function ProgressBar() {
  const { done, total } = TOTAL_PROGRESS
  const pct = pctOf(done, total)
  return (
    <div data-testid="implementation-progress" className="mt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-dim">{done} / {total} cards</span>
        <span className="text-accent font-medium" aria-label={`${pct}% implemented`}>{pct}%</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-line/40 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * The blocks the sets are listed under, in display order. The in-rotation sets lead and need no
 * heading — they're the default expectation. The other two are labelled, and the labels spell out
 * legality rather than just naming the block: "out of rotation" and "out of cycle" read alike, but
 * one means no longer legal and the other means legal indefinitely.
 */
const SET_GROUPS: { group: SetGroup; heading?: string }[] = [
  { group: 'rotation' },
  { group: 'retired', heading: 'Rotated out' },
  { group: 'out-of-cycle', heading: 'Other sets' },
]

const TYPE_LABEL: Record<keyof TypeCounts, string> = {
  leaders: 'Leaders',
  bases: 'Bases',
  units: 'Units',
  upgrades: 'Upgrades',
  events: 'Events',
  tokens: 'Tokens',
}

/**
 * One set's breakdown: a summary line carrying its overall count, then a row per card type. Sets
 * with nothing built still appear (all zeroes), so the panel doubles as the roadmap.
 */
function SetRow({ set, defaultOpen }: { set: SetProgress; defaultOpen: boolean }) {
  const done = sumCounts(set.done)
  const total = sumCounts(set.total)
  const pct = pctOf(done, total)
  return (
    <details data-testid={`set-progress-${set.code}`} open={defaultOpen} className="mt-2 border-2 border-line/60 rounded-xl bg-surface overflow-hidden">
      <summary className="flex items-baseline justify-between gap-2 px-3 py-1.5 cursor-pointer select-none text-xs">
        <span className="text-accent uppercase tracking-[0.12em] font-light">{set.code}</span>
        <span className="ml-auto text-ink-dim tabular-nums">{done} / {total}</span>
        <span className={`w-10 text-right tabular-nums ${done === total ? 'text-accent' : 'text-ink-faint'}`} aria-label={`${set.code} ${pct}% implemented`}>{pct}%</span>
      </summary>
      <dl className="border-t-2 border-line/30 divide-y divide-line/20">
        {CARD_TYPES.map(type => (
          <div key={type} className="flex items-baseline justify-between px-3 py-1 text-xs">
            <dt className="text-ink-dim">{TYPE_LABEL[type]}</dt>
            <dd data-testid={`set-${set.code}-${type}`} className={`tabular-nums ${set.done[type] === set.total[type] ? 'text-accent' : 'text-ink-faint'}`}>
              {set.done[type]} / {set.total[type]}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

/**
 * Reference panel (foot of the card catalogue column): how much of each set's card abilities are built into
 * the engine. One collapsible block per set, newest first, each broken down by card type. Sourced
 * from the manifest in `data/implementedCards`, which a test pins to the ability registry.
 */
function ImplementationStatus() {
  return (
    <aside data-testid="implemented-cards" className="mt-8">
      <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Implemented cards</h2>
      <p className="mt-1 text-ink-faint text-xs">
        Which card abilities are built in. Others still play as vanilla stats / resources.
      </p>

      <ProgressBar />

      {/* Sets by legality block, newest first within each. Only the newest set starts expanded. */}
      <div data-testid="set-progress">
        {SET_GROUPS.map(({ group, heading }) => {
          const sets = SET_PROGRESS.filter(s => s.group === group)
          if (sets.length === 0) return null
          return (
            <section key={group} data-testid={`set-group-${group}`}>
              {heading && <h3 className="mt-4 text-ink-faint text-[0.65rem] uppercase tracking-[0.12em] font-light">{heading}</h3>}
              {sets.map(set => <SetRow key={set.code} set={set} defaultOpen={set.code === SET_PROGRESS[0].code} />)}
            </section>
          )
        })}
      </div>

    </aside>
  )
}

export default function DeckSelectScreen({ onPlay }: Props) {
  const { decks, importDeck, removeDeck } = useDecks()
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<ParseDeckError | null>(null)
  const [opponentChoice, setOpponentChoice] = useState<string>(GENERATED_DECK_ID)
  // What a generated opponent is built around. The empty string is "random".
  const [opponentLeader, setOpponentLeader] = useState('')
  const [opponentAspect, setOpponentAspect] = useState('')
  const [setCode, setSetCode] = useState('')
  const [setStatus, setSetStatus] = useState<string | null>(null)
  // The pool is loaded once so generating is synchronous, which lets the opponent picker build a
  // fresh deck at play time without `onPlay` having to become async.
  const [pool, setPool] = useState<{ set: string; cards: SwuCard[] } | null>(null)
  const [generated, setGenerated] = useState<GeneratedDeck | null>(null)
  // Set when Generate built nothing because the cached set cannot fill a deck, so the button says why
  // rather than appearing to do nothing.
  const [cannotBuild, setCannotBuild] = useState(false)
  // The same conversion the engine uses, so hovering a card in the deck list shows exactly what it
  // would show in a game. Rebuilt only when the pool changes.
  const cardDb = useMemo(() => (pool ? buildCardDb(pool.cards) : null), [pool])
  const options = useMemo(() => (pool ? generationOptions(pool.cards) : null), [pool])

  useEffect(() => {
    let live = true
    void largestCachedSet().then(p => {
      if (!live) return
      setPool(p)
      setCannotBuild(false)
    })
    return () => { live = false }
  }, [setStatus])

  /** A different deck every time: the seed is what makes one reproducible after the fact. */
  function buildGenerated(choice: GenerationChoice = {}): GeneratedDeck | null {
    if (!pool) return null
    return generateRandomDeck(pool.cards, Math.floor(Math.random() * 1_000_000) + 1, choice)
  }

  function handleGenerate() {
    const next = buildGenerated()
    setGenerated(next)
    setCannotBuild(next === null)
  }

  function handleImport() {
    const result = importDeck(importText)
    if (result.ok) {
      setImportText('')
      setImportError(null)
      // Fire-and-forget: hydrate the new deck's cards in the background,
      // leader and base first (highest display priority).
      void syncCatalogue(deckRefs(result.deck))
    } else {
      setImportError(result.error)
    }
  }

  function handlePlay(deck: SavedDeck) {
    const choice = { leaderId: opponentLeader || undefined, baseAspect: opponentAspect || undefined }
    onPlay(deck, pickOpponent(decks, opponentChoice, deck, () => buildGenerated(choice)?.deck ?? null))
  }

  async function handleSetImport() {
    const code = setCode.trim()
    if (!code) return
    setSetStatus(`Importing ${code.toUpperCase()}…`)
    try {
      const result = await importSet(code, {
        onProgress: (done, total) => setSetStatus(`Importing ${code.toUpperCase()}… ${done}/${total}`),
      })
      setSetStatus(`${result.cached} cards cached for ${code.toUpperCase()}`)
    } catch (err) {
      setSetStatus(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div data-testid="deck-select-screen" className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,4fr)] gap-8 items-start">
      {/* Three columns: the deck you play with, the deck the bot plays, and the card catalogue that
          feeds both. The opponent gets a column of its own because choosing a generated one is a panel. */}
      <div data-testid="player-column" className="min-w-0">
      <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Your deck</h2>

      {/* Generated decks sit above the imported ones: this is the quickest way to see what the
          generator produces, and it works before any deck has been imported. */}
      <div data-testid="generated-deck-panel" className="mt-4 border-2 border-line/60 rounded-xl bg-surface px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <span className="block font-medium truncate">Random generated deck</span>
            <span data-testid="generated-deck-subtitle" className="block text-xs text-ink-faint">
              {pool === null
                ? 'Cache a set in the card catalogue to generate decks'
                : generated === null
                  ? `${cannotBuild ? `Cannot fill a ${DECK_SIZE}-card deck from` : 'Built from'} ${pool.set} (${pool.cards.length} cards cached)`
                  : (
                    // Leader and base are cards too, so they hover for their art like any other row.
                    // They were previously raw ids, which is unreadable for the base.
                    <>
                      {cardCount(generated.deck)} cards&ensp;·&ensp;
                      <StaticCardRef
                        card={cardDb?.[generated.deck.leader]}
                        text={cardDb?.[generated.deck.leader]?.name ?? generated.leaderName}
                      />
                      &ensp;·&ensp;
                      <StaticCardRef
                        card={cardDb?.[generated.deck.base]}
                        text={cardDb?.[generated.deck.base]?.name ?? generated.deck.base}
                      />
                    </>
                  )}
            </span>
          </div>
          <button
            data-testid="generate-deck-button"
            onClick={handleGenerate}
            disabled={pool === null}
            className="px-4 py-1.5 text-sm border-2 border-accent text-accent rounded-xl hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generated === null ? 'Generate' : 'Regenerate'}
          </button>
          <button
            data-testid="play-generated-button"
            onClick={() => generated && handlePlay(generated.deck)}
            disabled={generated === null}
            className="px-4 py-1.5 text-sm border-2 border-ink text-ink rounded-xl shadow-[0_0_12px_rgba(255,255,255,0.2)] hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Play
          </button>
        </div>

        {generated && (
          <div className="mt-3 border-t border-line/40 pt-3">
            {/* The card list is the point of the panel: a deck you cannot read is a deck you cannot
                judge against what a real pool would give you. */}
            {/* Grouped by card type rather than flowed across two columns: a decklist is read as
                units first, then the non-unit cards, and a flowing grid interleaves them so neither
                the curve nor the unit count can be taken in at a glance. */}
            <div data-testid="generated-deck-cards" className="grid grid-cols-2 gap-x-6 text-xs text-ink-dim">
              <DeckSection title="Units" entries={generated.entries.filter(c => c.type === 'Unit')} cardDb={cardDb} />
              <div>
                <DeckSection title="Upgrades" entries={generated.entries.filter(c => c.type === 'Upgrade')} cardDb={cardDb} />
                <DeckSection title="Events" entries={generated.entries.filter(c => c.type === 'Event')} cardDb={cardDb} />
                {/* Anything the pool could not resolve, so a partial cache is visible rather than
                    silently dropping rows and leaving a deck that does not add up. */}
                <DeckSection
                  title="Other"
                  entries={generated.entries.filter(c => !['Unit', 'Upgrade', 'Event'].includes(c.type))}
                  cardDb={cardDb}
                />
              </div>
            </div>
            {!generated.report.ok && (
              <p data-testid="generated-deck-violations" className="mt-2 text-xs text-red">
                Shape rules broken: {generated.report.violations.join('; ')}
              </p>
            )}
          </div>
        )}
      </div>

      {decks.length === 0 ? (
        <p data-testid="deck-empty-state" className="mt-4 text-ink-faint text-sm">
          No decks yet. Paste a ProtectThePod export below to get started.
        </p>
      ) : (
        <ul data-testid="deck-list" className="mt-4 divide-y divide-line/40 border-2 border-line/60 rounded-xl bg-surface">
          {decks.map(deck => (
            <li key={deck.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <span className="block font-medium truncate">{deck.name}</span>
                <span className="block text-xs text-ink-faint">
                  {cardCount(deck)} cards · leader {deck.leader} · base {deck.base}
                </span>
              </div>
              <button
                onClick={() => handlePlay(deck)}
                className="px-4 py-1.5 text-sm border-2 border-ink text-ink rounded-xl shadow-[0_0_12px_rgba(255,255,255,0.2)] hover:bg-white/10"
              >
                Play
              </button>
              <button
                onClick={() => removeDeck(deck.id)}
                className="px-4 py-1.5 text-sm border-2 border-line/60 text-ink-dim rounded-xl hover:border-red hover:text-red"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">Import deck</h3>
        <textarea
          data-testid="deck-import-textarea"
          value={importText}
          onChange={e => {
            setImportText(e.target.value)
            setImportError(null)
          }}
          placeholder="Paste ProtectThePod JSON"
          className="mt-2 w-full h-36 bg-transparent border-2 border-accent rounded-xl p-3 text-sm font-mono text-ink placeholder:text-ink-faint shadow-[0_0_12px_rgba(79,195,247,0.3)] focus:outline-none"
        />
        {importError && (
          <p data-testid="deck-import-error" className="mt-1 text-sm text-red">
            {ERROR_MESSAGES[importError]}
          </p>
        )}
        <button
          data-testid="deck-import-btn"
          onClick={handleImport}
          disabled={importText.trim() === ''}
          className="mt-2 px-5 py-2 text-sm border-2 border-ink text-ink rounded-xl shadow-[0_0_12px_rgba(255,255,255,0.2)] hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Import
        </button>
      </div>

      </div>

      <div data-testid="opponent-column" className="min-w-0">
        <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">
          <label htmlFor="opponent-deck-select">Opponent</label>
        </h2>
        {decks.length === 0 && pool === null ? (
          <p className="mt-4 text-ink-faint text-sm">Import a deck or cache a set to choose an opponent.</p>
        ) : (
          <select
            id="opponent-deck-select"
            data-testid="opponent-deck-select"
            value={opponentChoice}
            onChange={e => setOpponentChoice(e.target.value)}
            className={`mt-4 ${SELECT_CLASS}`}
          >
            {/* A freshly generated deck each game, so it is not the same opponent twice. The default,
                because it is the opponent that exercises the bot on a leader you can choose below. */}
            <option value={GENERATED_DECK_ID} disabled={pool === null}>Random generated deck</option>
            {/* "Built" because it picks among the player's own imported decks and never a generated one. */}
            <option value="random" disabled={decks.length === 0}>Random built deck</option>
            {decks.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}

        {/* How to watch the bot play one leader: the matrix rates leaders, and a game against a chosen
            one shows whether a rating belongs to the leader or to the bot. A fieldset, so switching the
            opponent to a built deck disables every control in it at once. */}
        {options && (
          <fieldset
            data-testid="opponent-generation-panel"
            disabled={opponentChoice !== GENERATED_DECK_ID}
            className="mt-4 border-2 border-line/60 rounded-xl bg-surface px-4 py-3"
          >
            <legend className="px-1 text-accent text-xs uppercase tracking-[0.12em] font-light">Generated opponent</legend>
            <label className="block text-xs text-ink-dim">
              Leader
              <select
                data-testid="opponent-leader-select"
                value={opponentLeader}
                onChange={e => setOpponentLeader(e.target.value)}
                className={`mt-1 ${SELECT_CLASS}`}
              >
                <option value="">Random leader</option>
                {options.leaders.map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.aspects.join(', ')})</option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-ink-dim">
              Base aspect
              <select
                data-testid="opponent-aspect-select"
                value={opponentAspect}
                onChange={e => setOpponentAspect(e.target.value)}
                className={`mt-1 ${SELECT_CLASS}`}
              >
                <option value="">Random base aspect</option>
                {options.aspects.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-xs text-ink-faint">
              A random pick never pairs a leader with a base of an aspect the leader already has. Choosing
              both yourself overrides that.
            </p>
          </fieldset>
        )}
      </div>

      <div data-testid="catalogue-column" className="min-w-0">
        <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Card catalogue</h2>
        <p className="mt-1 text-ink-faint text-xs">
          Cache a full set locally (e.g. ASH): games and deck views then work offline, including bases.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <input
            data-testid="set-import-input"
            value={setCode}
            onChange={e => setSetCode(e.target.value)}
            placeholder="Set code"
            maxLength={3}
            className="w-28 bg-transparent border-2 border-accent rounded-xl px-3 py-1.5 text-sm text-ink uppercase placeholder:normal-case placeholder:text-ink-faint shadow-[0_0_12px_rgba(79,195,247,0.3)] focus:outline-none"
          />
          <button
            data-testid="set-import-btn"
            onClick={handleSetImport}
            disabled={setCode.trim() === ''}
            className="px-4 py-1.5 text-sm border-2 border-ink text-ink rounded-xl shadow-[0_0_12px_rgba(255,255,255,0.2)] hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import set
          </button>
          {setStatus && (
            <span data-testid="set-import-status" className="text-ink-dim text-xs">
              {setStatus}
            </span>
          )}
        </div>

        <ImplementationStatus />
      </div>
    </div>
  )
}
