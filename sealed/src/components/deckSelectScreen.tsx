import { useState } from 'react'
import type { ReactNode } from 'react'
import { useDecks } from '../hooks/useDecks'
import type { SavedDeck } from '../data/deckStore'
import { cardRefFromId } from '../utils/parseProtectThePod'
import type { ParseDeckError, ParsedDeck } from '../utils/parseProtectThePod'
import { syncCatalogue } from '../data/catalogueSync'
import { importSet } from '../data/setImport'
import type { CardRef } from '../data/catalogueSync'
import { IMPLEMENTED_LEADERS, IMPLEMENTED_UPGRADES, UNIT_GROUPS, TOTAL_PROGRESS } from '../data/implementedCards'
import type { GroupStatus } from '../data/implementedCards'

interface Props {
  onPlay: (deck: SavedDeck, opponentDeck: SavedDeck) => void
}

const ERROR_MESSAGES: Record<ParseDeckError, string> = {
  'invalid-json': "Couldn't read that — check you've pasted the ProtectThePod JSON export.",
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

function pickOpponent(decks: SavedDeck[], choice: string, fallback: SavedDeck): SavedDeck {
  if (choice !== 'random') return decks.find(d => d.id === choice) ?? fallback
  return decks[Math.floor(Math.random() * decks.length)]
}

/** Yes/No glyph for an implemented card side. */
function Flag({ on }: { on: boolean }) {
  return on
    ? <span className="text-accent" aria-label="implemented">✓</span>
    : <span className="text-ink-faint" aria-label="not yet">·</span>
}

/** Headline "% of the whole set implemented" bar (tokens included). */
function ProgressBar() {
  const { done, total } = TOTAL_PROGRESS
  const pct = Math.round((done / total) * 100)
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

const STATUS_LABEL: Record<GroupStatus, string> = { done: 'Done', 'in progress': 'In progress', planned: 'Planned' }

/** Development-status chip shown on each collapsible section's summary. */
function StatusChip({ status }: { status: GroupStatus }) {
  const tone = status === 'done' ? 'text-accent' : status === 'in progress' ? 'text-ink' : 'text-ink-faint'
  return <span className={`text-[0.6rem] uppercase tracking-[0.1em] ${tone}`}>{STATUS_LABEL[status]}</span>
}

/** A collapsible reference section: a summary row (title + status) with expandable content. */
function Section({ title, status, defaultOpen, testId, children }: {
  title: string
  status: GroupStatus
  defaultOpen: boolean
  testId?: string
  children: ReactNode
}) {
  return (
    <details data-testid={testId} open={defaultOpen} className="mt-2 border-2 border-line/60 rounded-xl bg-surface overflow-hidden">
      <summary className="flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer select-none text-accent text-xs uppercase tracking-[0.12em] font-light">
        <span className="truncate">{title}</span>
        <StatusChip status={status} />
      </summary>
      <div className="border-t-2 border-line/30">{children}</div>
    </details>
  )
}

/**
 * Reference panel (RHS of the setup screen): which cards' abilities are built into the engine.
 * Leaders and upgrades are complete, so they roll up into sections collapsed by default (still
 * expandable). Units are split into work groups (#306); the in-progress group is expanded, the
 * rest collapsed with their development status. Sourced from the manifest in `data/implementedCards`
 * (leaders/upgrades pinned to the ability registry by a test).
 */
function ImplementationStatus() {
  // Expand the first group that isn't done yet — the one currently being (or next to be) worked on.
  const nextGroupId = UNIT_GROUPS.find(g => g.status !== 'done')?.id
  return (
    <aside data-testid="implemented-cards" className="w-full lg:w-[27rem] shrink-0 lg:mt-0 mt-4">
      <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Implemented cards</h2>
      <p className="mt-1 text-ink-faint text-xs">
        Which card abilities are built in. Others still play as vanilla stats / resources.
      </p>

      <ProgressBar />

      <Section title={`Leaders (${IMPLEMENTED_LEADERS.length})`} status="done" defaultOpen={false}>
        <table data-testid="implemented-leaders" className="w-full text-sm">
          <thead>
            <tr className="text-ink-faint text-[0.65rem] uppercase tracking-[0.1em]">
              <th className="text-left font-light px-3 py-1.5">Leader</th>
              <th className="font-light px-2 py-1.5">Front</th>
              <th className="font-light px-2 py-1.5">Back</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/30">
            {IMPLEMENTED_LEADERS.map(l => (
              <tr key={l.id}>
                <td className="px-3 py-1.5 truncate">{l.name}</td>
                <td className="px-2 py-1.5 text-center"><Flag on={l.front} /></td>
                <td className="px-2 py-1.5 text-center"><Flag on={l.back} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`Upgrades (${IMPLEMENTED_UPGRADES.length})`} status="done" defaultOpen={false}>
        <ul data-testid="implemented-upgrades" className="divide-y divide-line/30 text-sm">
          {IMPLEMENTED_UPGRADES.map(u => (
            <li key={u.id} className="px-3 py-1 truncate">{u.name}</li>
          ))}
        </ul>
      </Section>

      <h3 className="mt-5 text-accent text-xs uppercase tracking-[0.12em] font-light">
        Units <span className="text-ink-faint normal-case tracking-normal">(by what's blocking them)</span>
      </h3>
      <div data-testid="implemented-unit-groups">
        {UNIT_GROUPS.map(g => (
          <details key={g.id} data-testid={`unit-group-${g.id}`} open={g.id === nextGroupId} className="mt-2 border-2 border-line/60 rounded-xl bg-surface overflow-hidden">
            <summary className="flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer select-none text-xs">
              <span className="truncate text-accent uppercase tracking-[0.1em] font-light">{g.name} <span className="text-ink-faint normal-case tracking-normal">({g.units.length})</span></span>
              <StatusChip status={g.status} />
            </summary>
            <div className="border-t-2 border-line/30">
              <p className="px-3 py-2 text-ink-dim text-xs">{g.note}</p>
              <ul className="border-t border-line/20 divide-y divide-line/20 text-sm">
                {g.units.map(u => (
                  <li key={u.id} className="px-3 py-1 truncate">{u.name}</li>
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </aside>
  )
}

export default function DeckSelectScreen({ onPlay }: Props) {
  const { decks, importDeck, removeDeck } = useDecks()
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<ParseDeckError | null>(null)
  const [opponentChoice, setOpponentChoice] = useState('random')
  const [setCode, setSetCode] = useState('')
  const [setStatus, setSetStatus] = useState<string | null>(null)

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
    onPlay(deck, pickOpponent(decks, opponentChoice, deck))
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
    <div data-testid="deck-select-screen" className="flex flex-col lg:flex-row gap-8 items-start">
      <div className="max-w-2xl w-full min-w-0">
      <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Deck selection</h2>

      {decks.length === 0 ? (
        <p data-testid="deck-empty-state" className="mt-4 text-ink-faint text-sm">
          No decks yet — paste a ProtectThePod export below to get started.
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

      {decks.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="opponent-deck-select" className="text-accent text-xs uppercase tracking-[0.12em] font-light">
            Opponent
          </label>
          <select
            id="opponent-deck-select"
            data-testid="opponent-deck-select"
            value={opponentChoice}
            onChange={e => setOpponentChoice(e.target.value)}
            className="bg-transparent border-2 border-accent rounded-xl px-3 py-1.5 text-sm text-ink shadow-[0_0_12px_rgba(79,195,247,0.3)] focus:outline-none"
          >
            <option value="random">Random deck</option>
            {decks.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
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

      <div className="mt-8">
        <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">Card catalogue</h3>
        <p className="mt-1 text-ink-faint text-xs">
          Cache a full set locally (e.g. ASH) — games and deck views then work offline, including bases.
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
      </div>
      </div>

      <ImplementationStatus />
    </div>
  )
}
