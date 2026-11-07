import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, OptionRow, SegmentedControl, SelectButton, Sheet, Switch } from '@pwa-shared/controls'
import type { SavedDeck } from '../../data/deckStore'
import type { EngineCard } from '../../engine/types'
import type { SwuCard } from '../../data/cards'
import { SET_PROGRESS, CARD_TYPES, sumCounts } from '../../data/implementedCards'
import type { SetGroup, SetProgress, TypeCounts } from '../../data/implementedCards'
import { GENERATED_DECK_ID, NO_ASPECT } from '../../deckgen/randomDeck'
import type { GenerationOptions } from '../../deckgen/randomDeck'
import type { ParseDeckError } from '../../utils/parseProtectThePod'
import type { ImportResult } from '../../hooks/useDecks'
import { ANY_OF_MY_DECKS, SET_CODES } from '../../hooks/useSealedSetup'
import { Disclosure } from '../disclosure'
import { FIELD_CLASS } from '../field'
import { AspectIcons } from './deckParts'
import { games, winRate } from '../../data/matchups'
import type { Matchup, Side } from '../../data/matchups'
import CardFace from '../cardFace'
import { deckAspects, deckLine } from './deckSummary'
import { aspectIconSrc, aspectName, mutedStyle } from './setupStyle'

/** The sheets the setup screen opens: the deck, importing, the opponent and its choices, and card support. */

const subheadStyle: React.CSSProperties = { margin: 0, paddingTop: '4px', fontSize: '0.7rem', fontWeight: 400, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)' }

type Cards = Record<string, EngineCard | undefined>

/** A row that keeps its height in a sheet too full to show everything: the sheet scrolls instead. */
const KEEP: React.CSSProperties = { flexShrink: 0, display: 'flex', flexDirection: 'column' }

/** A saved deck as a row: tapping it chooses it, and View beside it opens it. */
function DeckRow({ deck, cards, selected, testId, record, onChoose, onView }: {
  deck: SavedDeck
  cards: Cards
  selected: boolean
  testId: string
  /** The player's record against the deck, after its leader and base. */
  record?: string
  onChoose: () => void
  onView: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <OptionRow
          testId={testId}
          title={deck.name}
          icon={<AspectIcons aspects={deckAspects(deck, cards)} size={14} />}
          detail={[deckLine(deck, cards), record].filter(Boolean).join(' · ')}
          selected={selected}
          onClick={onChoose}
        />
      </div>
      <Button onClick={onView} style={{ width: '64px', minHeight: '52px', padding: 0, fontSize: '0.85rem' }}><span aria-label={`View ${deck.name}`}>View</span></Button>
    </div>
  )
}

export function DeckSheet({ open, decks, cards, chosenId, onChoose, onView, onGenerate, onImport, onClose }: {
  open: boolean
  decks: SavedDeck[]
  cards: Cards
  chosenId: string | null
  onChoose: (id: string) => void
  onView: (id: string) => void
  onGenerate: () => void
  onImport: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={open} title="Your deck" onClose={onClose}>
      {decks.length === 0 && <p style={mutedStyle}>No saved decks yet.</p>}
      {decks.map(deck => (
        <DeckRow key={deck.id} deck={deck} cards={cards} testId={`deck-option-${deck.id}`} selected={deck.id === chosenId} onChoose={() => onChoose(deck.id)} onView={() => onView(deck.id)} />
      ))}
      <div style={KEEP}>
        <OptionRow title="Generate a deck" detail="A deck built for you from one set; see it before you play it" onClick={onGenerate} />
      </div>
      <Button onClick={onImport} style={{ marginTop: 'auto' }}>Import deck JSON</Button>
    </Sheet>
  )
}

const ERROR_MESSAGES: Record<ParseDeckError, string> = {
  'invalid-json': "Couldn't read that. Check you've pasted the ProtectThePod JSON export.",
  'invalid-format': "That JSON doesn't look like a deck export.",
  'missing-leader': 'Deck must include exactly 1 leader.',
  'missing-base': 'Deck must include exactly 1 base.',
  'too-few-cards': 'Deck must have at least 30 cards.',
}

export function ImportSheet({ open, onImport, onImported, onClose }: {
  open: boolean
  onImport: (text: string) => ImportResult
  onImported: () => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<ParseDeckError | null>(null)
  const errorId = useId()
  const fieldId = useId()

  function submit() {
    const result = onImport(text)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setText('')
    setError(null)
    onImported()
  }

  async function paste() {
    try {
      setText(await navigator.clipboard.readText())
      setError(null)
    } catch {
      // No clipboard access: the box still takes a paste by hand.
    }
  }

  return (
    <Sheet open={open} title="Import deck JSON" onClose={onClose}>
      <p style={mutedStyle}>Paste a deck's JSON export from a deck builder. The deck is saved on this device.</p>
      <label htmlFor={fieldId} style={{ ...subheadStyle, color: 'var(--color-text-muted)' }}>Deck JSON</label>
      <textarea
        id={fieldId}
        data-testid="deck-import-textarea"
        value={text}
        onChange={e => { setText(e.target.value); setError(null) }}
        placeholder="Paste ProtectThePod JSON"
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        className={`h-[104px] shrink-0 resize-none py-2.5 font-mono ${FIELD_CLASS}`}
        style={error ? { borderColor: 'var(--color-opponent)' } : undefined}
      />
      {error && (
        <div id={errorId} role="alert" data-testid="deck-import-error" style={{ padding: '10px 12px', borderRadius: '12px', background: 'rgba(var(--color-error-rgb), 0.15)', color: 'var(--color-text-primary)', fontSize: '0.9rem' }}>
          {ERROR_MESSAGES[error]}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
        <Button onClick={() => void paste()} style={{ flex: 1, minHeight: '52px' }}>Paste</Button>
        <Button variant="primary" testId="deck-import-btn" onClick={submit} disabled={text.trim() === ''} style={{ flex: 1, minHeight: '52px' }}>Import</Button>
      </div>
    </Sheet>
  )
}

/** A select standing in a row behind its label, the way the design sets the opponent's choices. */
function LabelledSelect({ label, value, onClick, icon }: { label: string; value: string; onClick: () => void; icon?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ width: '92px', flexShrink: 0, fontSize: '0.95rem', color: 'var(--color-text-muted)' }}>{label}</span>
      {icon}
      <SelectButton label={label} value={value} onClick={onClick} />
    </div>
  )
}

export function OpponentSheet({ open, decks, cards, recordOf, opponentChoice, onOpponentChoice, linkSets, onLinkSets, opponentSet, poolSummary, leaderName, aspect, onSet, onLeader, onAspect, onView, onClose }: {
  open: boolean
  decks: SavedDeck[]
  cards: Cards
  /** The player's record against a deck, as `recordLine` reads it. */
  recordOf: (deck: SavedDeck) => string | undefined
  opponentChoice: string
  onOpponentChoice: (choice: string) => void
  linkSets: boolean
  onLinkSets: (linked: boolean) => void
  opponentSet: string
  poolSummary: string
  leaderName: string | null
  aspect: string
  onSet: () => void
  onLeader: () => void
  onAspect: () => void
  onView: (id: string) => void
  onClose: () => void
}) {
  const generated = opponentChoice === GENERATED_DECK_ID
  return (
    <Sheet open={open} title="Opponent" onClose={onClose}>
      <SegmentedControl
        label="Opponent's deck"
        options={[{ value: 'generated', label: 'Generated' }, { value: 'mine', label: 'One of my decks' }]}
        value={generated ? 'generated' : 'mine'}
        onChange={v => {
          if (v === 'generated') onOpponentChoice(GENERATED_DECK_ID)
          else if (generated) onOpponentChoice(ANY_OF_MY_DECKS)
        }}
      />
      {generated ? (
        <>
          <Switch label="Same set as my deck" note={linkSets ? `Builds from ${opponentSet}` : undefined} checked={linkSets} onChange={onLinkSets} />
          {!linkSets && <LabelledSelect label="Set" value={opponentSet} onClick={onSet} />}
          <LabelledSelect label="Leader" value={leaderName ?? 'Random'} onClick={onLeader} />
          <LabelledSelect
            label="Base aspect"
            value={aspect ? aspectName(aspect) : 'Random'}
            onClick={onAspect}
            icon={aspect && aspect !== NO_ASPECT ? <img src={aspectIconSrc(aspect)} alt="" style={{ width: 18, height: 18 }} /> : undefined}
          />
          <p data-testid="opponent-pool-summary" style={mutedStyle}>{poolSummary}</p>
          <p style={mutedStyle}>A new deck is built each game. Choose a leader and a base aspect to watch the bot play them; left random, a leader never gets a base of its own aspect.</p>
        </>
      ) : (
        <>
          <OptionRow
            testId="opponent-option-random"
            title="Any of my decks"
            detail="Picked at random each game; it can be the deck you play"
            selected={opponentChoice === ANY_OF_MY_DECKS}
            onClick={() => onOpponentChoice(ANY_OF_MY_DECKS)}
          />
          {decks.length === 0 && <p style={mutedStyle}>No saved decks yet. Import one from Your deck.</p>}
          {decks.map(deck => (
            <DeckRow key={deck.id} deck={deck} cards={cards} testId={`opponent-option-${deck.id}`} record={recordOf(deck)} selected={opponentChoice === deck.id} onChoose={() => onOpponentChoice(deck.id)} onView={() => onView(deck.id)} />
          ))}
        </>
      )}
    </Sheet>
  )
}

export function SetSheet({ open, title, value, onPick, onClose }: { open: boolean; title: string; value: string; onPick: (code: string) => void; onClose: () => void }) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {SET_CODES.map(code => (
        <OptionRow key={code} testId={`set-option-${code}`} title={code} selected={code === value} onClick={() => onPick(code)} />
      ))}
    </Sheet>
  )
}

export function LeaderSheet({ open, set, options, value, onPick, onClose }: {
  open: boolean
  set: string
  options: GenerationOptions | null
  value: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const leaders = options?.leaders ?? []
  return (
    <Sheet open={open} title="Opponent's leader" onClose={onClose}>
      <p style={mutedStyle}>{options ? `The ${leaders.length} leaders in ${set}` : `Caching ${set}…`}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' }}>
        <OptionRow testId="leader-option-random" title="Random" selected={value === ''} onClick={() => onPick('')} />
        {leaders.map(l => (
          <OptionRow key={l.id} testId={`leader-option-${l.id}`} title={l.name} icon={<AspectIcons aspects={l.aspects} size={16} />} selected={value === l.id} onClick={() => onPick(l.id)} />
        ))}
      </div>
    </Sheet>
  )
}

export function AspectSheet({ open, set, options, pool, value, onPick, onClose }: {
  open: boolean
  set: string
  options: GenerationOptions | null
  /** The opponent's pool, which names the bases behind No aspect. */
  pool: SwuCard[]
  value: string
  onPick: (aspect: string) => void
  onClose: () => void
}) {
  const aspectless = pool.filter(c => c.Type === 'Base' && (c.Aspects ?? []).length === 0).map(c => c.Name)
  return (
    <Sheet open={open} title="Opponent's base aspect" onClose={onClose}>
      <p style={mutedStyle}>{options ? `The aspects of the bases in ${set}` : `Caching ${set}…`}</p>
      <OptionRow testId="aspect-option-random" title="Random" selected={value === ''} onClick={() => onPick('')} />
      {(options?.aspects ?? []).map(a => (
        <OptionRow
          key={a}
          testId={`aspect-option-${a}`}
          title={aspectName(a)}
          detail={a === NO_ASPECT ? [...new Set(aspectless)].join(', ') : undefined}
          icon={a === NO_ASPECT ? undefined : <img src={aspectIconSrc(a)} alt="" style={{ width: 22, height: 22 }} />}
          selected={value === a}
          onClick={() => onPick(a)}
        />
      ))}
    </Sheet>
  )
}

export function MoreSheet({ open, onHelp, onCardSupport, onSettings, onClose }: { open: boolean; onHelp: () => void; onCardSupport: () => void; onSettings: () => void; onClose: () => void }) {
  return (
    <Sheet open={open} title="More" onClose={onClose}>
      <Button onClick={onHelp}>Help</Button>
      <Button onClick={onCardSupport}>Card support</Button>
      <Button onClick={onSettings}>Settings</Button>
    </Sheet>
  )
}

/** The leader and base thumbnails' short edge: both are landscape cards, so each is this tall. */
const THUMB_PX = 36
const CELL: React.CSSProperties = { padding: '8px' }
const NUMBER: React.CSSProperties = { ...CELL, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }
const COLUMNS = ['Opponent', 'Games', 'Win rate']

/** A cell's second line, under its art or its count. */
const Subtitle = ({ children }: { children: React.ReactNode }) =>
  <div data-testid="matchup-subtitle" style={{ ...mutedStyle, marginTop: '4px' }}>{children}</div>

/**
 * The player's record as the chosen leader and base against each opposing leader and base played, a
 * row each with the leader and base art over the opponent's name, and the games over the wins, losses
 * and draws. A base group shows the base played in it. Alternate rows sit on the band.
 */
export function MatchupSheet({ open, mine, matchups, onClose }: { open: boolean; mine: Side | null; matchups: Matchup[]; onClose: () => void }) {
  return (
    <Sheet open={open} title="Matchups" onClose={onClose}>
      {mine && <p style={mutedStyle}>As {mine.label}, against each leader and base you have played. Aspect bases count together by aspect, and Force bases and splash bases each as one, shown by a base played; any other base is its own.</p>}
      <table style={{ flexShrink: 0, width: '100%', borderSpacing: 0, fontSize: '0.9rem' }}>
        <thead>
          <tr>{COLUMNS.map((c, i) => <th key={c} style={{ ...subheadStyle, ...(i > 0 ? NUMBER : CELL), color: 'var(--color-accent)', textAlign: i > 0 ? 'right' : 'left' }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {matchups.map(({ opponent: o, record }, i) => (
            <tr key={o.key} data-testid="matchup-row" style={i % 2 === 0 ? { background: 'var(--color-band)' } : undefined}>
              <td style={CELL}>
                <div style={{ display: 'flex', gap: '8px', lineHeight: 0 }}>
                  {[o.leader, o.base].map(card => <CardFace key={card.id} card={card} fallbackName={card.name} widthPx={THUMB_PX} tight />)}
                </div>
                <Subtitle>{o.label}</Subtitle>
              </td>
              <td style={NUMBER}>
                <div>{games(record)}</div>
                <Subtitle>{record.won} - {record.lost} - {record.drawn}</Subtitle>
              </td>
              <td style={NUMBER}>{winRate(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  )
}

/**
 * The sets listed under their legality, newest first within each. The labels spell out legality
 * rather than naming the block: "out of rotation" and "out of cycle" read alike, but one means no
 * longer legal and the other means legal indefinitely.
 */
const SET_GROUPS: { group: SetGroup; heading: string }[] = [
  { group: 'rotation', heading: 'In rotation' },
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

/** One set: its code and how much of it is built, opening on a tap to the count of each card type. */
function SetSupport({ set }: { set: SetProgress }) {
  const [open, setOpen] = useState(false)
  const done = sumCounts(set.done)
  const total = sumCounts(set.total)
  const all = done === total
  return (
    <Disclosure
      testId={`set-progress-${set.code}`}
      open={open}
      onToggle={() => setOpen(o => !o)}
      summary={<>
        <span style={{ width: '44px', fontWeight: 600 }}>{set.code}</span>
        <span style={{ fontSize: '0.8rem', color: all ? 'var(--color-text-muted)' : 'var(--color-warning)' }}>
          {all ? `All ${total} cards` : `${done} of ${total} cards`}
        </span>
      </>}
    >
      <dl style={{ margin: 0 }}>
        {CARD_TYPES.map(type => (
          <div key={type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '2px 0' }}>
            <dt style={{ color: 'var(--color-text-muted)' }}>{TYPE_LABEL[type]}</dt>
            <dd data-testid={`set-${set.code}-${type}`} style={{ margin: 0, color: set.done[type] === set.total[type] ? 'var(--color-accent)' : 'var(--color-text-disabled)' }}>
              {set.done[type]} / {set.total[type]}
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  )
}

/**
 * How much of each set's card abilities the engine plays, from the manifest in `data/implementedCards`,
 * which a test pins to the ability registry.
 */
export function CardSupportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Card support" onClose={onClose}>
      <p style={mutedStyle}>The card abilities the game plays, by set. A card not built yet plays with its printed stats and keywords only. Tap a set to see which types are short.</p>
      <p style={mutedStyle}>Cards are cached on this device as your decks need them, so games and deck views then work offline.</p>
      {SET_GROUPS.map(({ group, heading }) => {
        const sets = SET_PROGRESS.filter(s => s.group === group)
        if (sets.length === 0) return null
        return (
          <section key={group} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <h3 style={subheadStyle}>{heading}</h3>
            {sets.map(set => <SetSupport key={set.code} set={set} />)}
          </section>
        )
      })}
    </Sheet>
  )
}
