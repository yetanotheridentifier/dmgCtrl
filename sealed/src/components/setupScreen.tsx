import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconButton, SelectButton, SetupHeaderMark } from '@pwa-shared/controls'
import type { SavedDeck } from '../data/deckStore'
import { GENERATED_DECK_ID, NO_ASPECT } from '../deckgen/randomDeck'
import { useSealedSetup, ANY_OF_MY_DECKS } from '../hooks/useSealedSetup'
import { useCardLookup } from '../hooks/useCardLookup'
import { DESKTOP_QUERY, PORTRAIT_QUERY, useMediaQuery } from '../hooks/useMediaQuery'
import { BackIcon, DotsIcon } from './icons'
import { AspectIcons, DeckList, LeaderAndBase } from './setup/deckParts'
import { CURVE_LABELS, cardCount, costCurve, deckAspects, deckEntries, deckGroups, deckLine, deckSet, recordLine, typeSummary } from './setup/deckSummary'
import { DeckView } from './setup/deckView'
import { matchupsOf, sideOf, totalOf } from '../data/matchups'
import { AspectSheet, CardSupportSheet, DeckSheet, ImportSheet, LeaderSheet, MatchupSheet, MoreSheet, OpponentSheet, SetSheet } from './setup/setupSheets'
import { aspectName, mutedStyle } from './setup/setupStyle'
import { useCardShown } from './setup/useCardShown'

/**
 * The Sealed setup screen: your deck, the opponent, and Go to game, with every choice made on a sheet.
 * Built from the PWA's shared controls in the shape of its X-Wing and SWU setup screens.
 */

interface Props {
  onPlay: (deck: SavedDeck, opponent: SavedDeck) => void
  onHelp: () => void
  onSettings: () => void
  /** Back to game select: the dmgCtrl app at the site root. */
  onBack: () => void
  /** Beside More in the header: what the caller wants there (the share-games pill). */
  headerExtra?: ReactNode
  /**
   * Last on the page, under Go to game, so it never moves the cards or Go: a notice the caller owns
   * (the share-games question, until answered).
   */
  notice?: ReactNode
}

type SheetName = 'more' | 'matchups' |'cardSupport' | 'deck' | 'import' | 'opponent' | 'opponentSet' | 'leader' | 'aspect' | 'playerSet' | 'view' | 'generate'
type Layout = 'portrait' | 'landscape' | 'desktop'

const labelStyle: React.CSSProperties = { fontSize: '0.75rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)' }
const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, minHeight: 0 }

/** Copies at each cost as bars, tallest full height. */
function CostCurve({ curve, grow }: { curve: number[]; grow: boolean }) {
  const most = Math.max(1, ...curve)
  return (
    <div
      role="img"
      aria-label={`Cost curve: ${curve.map((n, i) => `${n} at ${CURVE_LABELS[i]}`).join(', ')}`}
      style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', gap: '6px', height: grow ? undefined : '64px', flex: grow ? 1 : undefined, minHeight: '40px' }}
    >
      {curve.map((n, i) => (
        <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '100%', height: `${(n / most) * 100}%`, minHeight: n > 0 ? '3px' : 0, borderRadius: '4px', background: 'rgba(var(--color-accent-rgb), 0.4)' }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{CURVE_LABELS[i]}</span>
        </div>
      ))}
    </div>
  )
}

export default function SetupScreen({ onPlay, onHelp, onSettings, onBack, headerExtra, notice }: Props) {
  const s = useSealedSetup(onPlay)
  const portrait = useMediaQuery(PORTRAIT_QUERY)
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const layout: Layout = portrait ? 'portrait' : desktop ? 'desktop' : 'landscape'

  // The sheets open, the one on top last. A sheet opened from another goes back to it on close, the
  // way the design's sub-sheets have Back; a deck view covers the screen beneath whatever is on top.
  const [stack, setStack] = useState<SheetName[]>([])
  const top = stack[stack.length - 1] ?? null
  const open = (name: SheetName) => setStack(st => [...st, name])
  const back = () => setStack(st => st.slice(0, -1))
  const closeAll = () => setStack([])
  const [viewing, setViewing] = useState<string | null>(null)
  const view = (id: string) => { setViewing(id); open('view') }

  const viewed = s.decks.find(d => d.id === viewing) ?? null
  const cards = useCardLookup([
    ...s.decks.flatMap(d => [d.leader, d.base]),
    ...[s.chosen, viewed, s.generated?.deck].flatMap(d => (d ? [d.leader, d.base, ...d.cards.map(c => c.id)] : [])),
  ])
  const { show, shown } = useCardShown()

  // The Generate view shows a deck as soon as there is a pool to build it from.
  const generating = stack.includes('generate')
  const { canGenerate, generated, generate } = s
  useEffect(() => {
    if (generating && canGenerate && !generated) generate()
  }, [generating, canGenerate, generated, generate])

  const chosen = s.chosen
  const chosenId = chosen && chosen.id !== GENERATED_DECK_ID ? chosen.id : null

  const leaderName = s.options?.leaders.find(l => l.id === s.opponentLeader)?.name ?? null
  const opponentDeck = s.decks.find(d => d.id === s.opponentChoice)
  // The chosen deck's leader and base as one side of a matchup, and what that side has played.
  const mine = chosen ? sideOf(cards[chosen.leader], cards[chosen.base]) : null
  const played = matchupsOf(s.matchups, mine)
  const recordOf = (deck: SavedDeck) => {
    const theirs = sideOf(cards[deck.leader], cards[deck.base])
    return recordLine(played.find(m => m.opponent.key === theirs?.key)?.record)
  }
  const overall = played.length > 0 ? recordLine(totalOf(played)) : undefined

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      <IconButton label="Back to game select" onClick={onBack}><BackIcon /></IconButton>
      <SetupHeaderMark />
      <h1 style={{ flex: 1, margin: 0, fontSize: '1.4rem', fontWeight: 300, letterSpacing: '0.12em', color: 'var(--color-text-primary)' }}>Sealed</h1>
      {headerExtra}
      <IconButton label="More" onClick={() => setStack(['more'])}><DotsIcon /></IconButton>
    </div>
  )

  const deckCard = () => {
    if (!chosen) {
      const none = s.decks.length === 0
      // Side by side in landscape, where stacked they push Go to game off a 844x390 screen.
      const row = layout === 'landscape'
      const each = row ? { flex: 1 } : undefined
      return (
        <div data-testid="deck-card" style={cardStyle}>
          <div style={{ ...labelStyle, minHeight: '44px', display: 'flex', alignItems: 'center' }}>Your deck</div>
          <div style={{ fontSize: '1.25rem' }}>Choose your deck</div>
          <p style={mutedStyle}>{none ? 'Generate one from any set to play straight away, or import a deck\'s JSON.' : 'One of your saved decks, a generated one, or a new import.'}</p>
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: row ? 'row' : 'column', gap: '8px' }}>
            {none ? (
              <>
                <Button onClick={() => { s.generate(); setStack(['generate']) }} style={each}>Generate a deck</Button>
                <Button onClick={() => setStack(['import'])} style={each}>Import deck JSON</Button>
              </>
            ) : <Button onClick={() => setStack(['deck'])}>Choose a deck</Button>}
          </div>
        </div>
      )
    }
    const groups = deckGroups(deckEntries(chosen, cards))
    const set = deckSet(chosen) ?? ''
    const buttons = (
      <>
        {layout !== 'desktop' && <Button onClick={() => (chosenId ? view(chosenId) : setStack(['generate']))} style={portrait ? { flex: 1 } : undefined}>View</Button>}
        <Button onClick={() => setStack(['deck'])} style={portrait ? { flex: 2 } : undefined}>Change deck</Button>
      </>
    )
    return (
      <div data-testid="deck-card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
          <div style={{ ...labelStyle, flex: 1 }}>Your deck</div>
          {!portrait && buttons}
        </div>
        {portrait && <LeaderAndBase deck={chosen} cards={cards} width={150} show={show} row />}
        <div data-testid="deck-name" style={{ fontSize: '1.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chosen.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--color-text-body)', minWidth: 0 }}>
          <AspectIcons aspects={deckAspects(chosen, cards)} size={20} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deckLine(chosen, cards, false)}</span>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          {[`${cardCount(chosen)} cards`, set, ...(layout === 'desktop' ? [] : [typeSummary(groups)])].filter(Boolean).join(' · ')}
        </div>
        {layout !== 'desktop' && <CostCurve curve={costCurve(groups.flatMap(g => g.entries))} grow={portrait} />}
        {portrait && <div style={{ display: 'flex', gap: '8px' }}>{buttons}</div>}
      </div>
    )
  }

  const opponentCard = () => {
    let title: string
    let lines: string[]
    if (s.opponentChoice === GENERATED_DECK_ID) {
      const from = s.linkSets && !chosen ? 'the set your deck comes from' : s.opponentSet
      const aspect = s.opponentAspect === '' ? 'random base aspect' : s.opponentAspect === NO_ASPECT ? 'a base with no aspect' : `${aspectName(s.opponentAspect)} base`
      title = 'Generated deck'
      lines = [
        `A new deck every game, from ${from}`,
        [...(s.linkSets && chosen ? ['Same set as your deck'] : []), leaderName ?? 'random leader', aspect].join(' · '),
      ]
    } else if (s.opponentChoice === ANY_OF_MY_DECKS || !opponentDeck) {
      title = 'Any of my decks'
      lines = ['Picked at random each game']
    } else {
      const record = recordOf(opponentDeck)
      title = opponentDeck.name
      lines = [deckLine(opponentDeck, cards), ...(record ? [`Your record: ${record}`] : [])]
    }
    return (
      <div data-testid="opponent-card" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px' }}>
          <div style={{ ...labelStyle, flex: 1 }}>Opponent</div>
          <Button onClick={() => setStack(['opponent'])}>Change opponent</Button>
        </div>
        <div style={{ fontSize: '1.25rem' }}>{title}</div>
        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-body)' }}>{lines[0]}</div>
        {lines[1] && <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{lines[1]}</div>}
        {mine && overall && (
          <div data-testid="matchup-summary" style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <p style={{ ...mutedStyle, flex: 1, minWidth: 0 }}>As {mine.label}: {overall}</p>
            <Button onClick={() => setStack(['matchups'])}>Matchups</Button>
          </div>
        )}
      </div>
    )
  }

  const go = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
      {!chosen && <span style={mutedStyle}>Choose your deck first</span>}
      <Button variant="primary" onClick={() => void s.play()} disabled={!chosen} style={{ minHeight: '52px', minWidth: '176px', flex: portrait || layout === 'desktop' ? 1 : undefined }}>Go to game</Button>
    </div>
  )

  const beside = layout === 'desktop' && chosen && (
    <div data-testid="deck-beside" style={{ ...cardStyle, flex: '999 1 560px', flexDirection: 'row', flexWrap: 'wrap', gap: '20px', padding: '16px' }}>
      <div style={{ flex: '0 1 240px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={labelStyle}>In your deck</div>
        <LeaderAndBase deck={chosen} cards={cards} width={240} show={show} />
      </div>
      <div style={{ flex: '1 1 360px', minWidth: 0 }}>
        <DeckList deck={chosen} cards={cards} show={show} columns="2 220px" />
      </div>
    </div>
  )

  const body = layout === 'desktop' ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'stretch' }}>
      <div style={{ flex: '1 1 340px', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {deckCard()}
        {opponentCard()}
        <div style={{ marginTop: 'auto' }}>{go}</div>
        {notice}
      </div>
      {beside}
    </div>
  ) : (
    <>
      {/* Fills the height, and never shrinks below its cards: with the notice showing, the page scrolls.
          Stacked in portrait, the deck card taking the height the opponent card leaves. */}
      <div data-testid="setup-cards" style={{ flex: '1 0 auto', display: 'grid', gap: '16px', ...(portrait ? { gridTemplateRows: '1fr auto' } : { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }) }}>
        {deckCard()}
        {opponentCard()}
      </div>
      {go}
      {notice}
    </>
  )

  const pickThenBack = (fn: (v: string) => void) => (v: string) => { fn(v); back() }

  return (
    <div
      data-testid="setup-screen"
      data-layout={layout}
      style={{
        boxSizing: 'border-box',
        height: layout === 'desktop' ? undefined : '100dvh',
        minHeight: layout === 'desktop' ? '100dvh' : undefined,
        overflowY: 'auto',
        paddingTop: 'var(--edge-top)',
        paddingRight: 'var(--edge-right)',
        paddingBottom: 'var(--edge-bottom)',
        paddingLeft: 'var(--edge-left)',
        color: 'var(--color-text-primary)',
      }}
    >
      {/* A definite height on a phone, so the cards can fill it and the curve's bars can size off it;
          what does not fit (the share notice) overflows into the page's scroll. */}
      <div style={{ height: layout === 'desktop' ? undefined : '100%', maxWidth: layout === 'desktop' ? '1232px' : undefined, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {topBar}
        {body}
      </div>

      {shown}

      <MoreSheet
        open={top === 'more'}
        onHelp={() => { closeAll(); onHelp() }}
        onCardSupport={() => setStack(['cardSupport'])}
        onSettings={() => { closeAll(); onSettings() }}
        onClose={closeAll}
      />
      <CardSupportSheet open={top === 'cardSupport'} onClose={closeAll} />
      <MatchupSheet open={top === 'matchups'} mine={mine} matchups={played} onClose={closeAll} />
      <DeckSheet
        open={top === 'deck'}
        decks={s.decks}
        cards={cards}
        chosenId={chosenId}
        onChoose={id => { s.chooseDeck(id); closeAll() }}
        onView={view}
        onGenerate={() => { s.generate(); open('generate') }}
        onImport={() => open('import')}
        onClose={closeAll}
      />
      <ImportSheet open={top === 'import'} onImport={s.importDeck} onImported={closeAll} onClose={back} />
      <OpponentSheet
        open={top === 'opponent'}
        decks={s.decks}
        cards={cards}
        recordOf={recordOf}
        opponentChoice={s.opponentChoice}
        onOpponentChoice={s.setOpponentChoice}
        linkSets={s.linkSets}
        onLinkSets={s.setLinkSets}
        opponentSet={s.opponentSet}
        poolSummary={s.opponentPoolSummary}
        leaderName={leaderName}
        aspect={s.opponentAspect}
        onSet={() => open('opponentSet')}
        onLeader={() => open('leader')}
        onAspect={() => open('aspect')}
        onView={view}
        onClose={closeAll}
      />
      <SetSheet open={top === 'opponentSet'} title="Opponent's set" value={s.opponentSet} onPick={pickThenBack(s.setOpponentSet)} onClose={back} />
      <LeaderSheet open={top === 'leader'} set={s.opponentSet} options={s.options} value={s.opponentLeader} onPick={pickThenBack(s.setOpponentLeader)} onClose={back} />
      <AspectSheet open={top === 'aspect'} set={s.opponentSet} options={s.options} pool={s.opponentPool} value={s.opponentAspect} onPick={pickThenBack(s.setOpponentAspect)} onClose={back} />
      <SetSheet open={top === 'playerSet'} title="Set" value={s.playerSet} onPick={pickThenBack(s.setPlayerSet)} onClose={back} />

      {stack.includes('view') && viewed && (
        <DeckView
          title={viewed.name}
          subtitle={`${cardCount(viewed)} cards · ${deckSet(viewed) ?? ''} · tap a card to see it`}
          deck={viewed}
          cards={cards}
          portrait={portrait}
          onBack={back}
          actions={(
            <>
              <Button onClick={() => { s.removeDeck(viewed.id); setStack(st => (st.length > 1 ? st.slice(0, -1) : ['deck'])) }}>Delete</Button>
              <Button variant="primary" onClick={() => { s.chooseDeck(viewed.id); closeAll() }} style={{ minWidth: '176px' }}>Use this deck</Button>
            </>
          )}
        />
      )}
      {generating && (
        <DeckView
          title="Generated deck"
          subtitle={s.generated ? `${cardCount(s.generated.deck)} cards · tap a card to see it` : s.generatedStatus}
          deck={s.generated?.deck ?? null}
          cards={cards}
          portrait={portrait}
          onBack={back}
          status={s.generated && !s.generated.report.ok && (
            <p data-testid="generated-deck-violations" style={{ ...mutedStyle, color: 'var(--color-warning)' }}>Shape rules broken: {s.generated.report.violations.join('; ')}</p>
          )}
          actions={(
            <>
              <div style={{ display: 'flex', width: '96px' }}>
                <SelectButton label="Set" value={s.playerSet} onClick={() => open('playerSet')} />
              </div>
              <Button onClick={s.generate} disabled={!s.canGenerate}>Generate again</Button>
              <Button variant="primary" onClick={() => { s.takeGenerated(); closeAll() }} disabled={!s.generated} style={{ minWidth: '176px' }}>Use this deck</Button>
            </>
          )}
        />
      )}
    </div>
  )
}
