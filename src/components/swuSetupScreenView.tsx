import { useState } from 'react'
import { Base } from '../hooks/useBases'
import { baseKey, SWU_MODES, TOURNAMENT_FORMATS, TWIN_SUNS_MIN_OPPONENTS, TWIN_SUNS_SEATS } from '../hooks/useSwuSetup'
import SwuTwinSunsGrid from './swuTwinSunsGrid'
import type { SwuMode, TournamentFormat, TournamentSettings } from '../hooks/useSwuSetup'
import type { useBaseArt } from '../hooks/useBaseArt'
import AppScreenLayout from './layout/appScreenLayout'
import ImagePreview from './imagePreview'
import SwuBaseSheet from './swuBaseSheet'
import { aspectIconSrc, baseAspect, baseMeta } from '../utils/baseAspect'
import { sectionLabelStyle, mutedStyle } from '../styles/sectionLabel'
import type { SwudbImportControls } from './swuBaseSheet'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon, DotsIcon, PlusIcon, StarIcon } from './icons'
import { Button, IconButton, SegmentedControl, SetupHeaderMark, Sheet, Stepper } from './shared/controls'
import type { SetupMode } from '../utils/playMode'
import { FORMAT_LABELS, formatValidationError, isBaseValidForFormat } from '../utils/formatFilter'

export type { SwudbImport } from './swuBaseSheet'

interface Props {
  error: string | null
  base: Base | null
  art: ReturnType<typeof useBaseArt>
  useHyperspace: boolean
  isFavourite: boolean
  onFavouriteToggle: () => void
  matchType: SetupMode
  onMatchTypeChange: (v: SetupMode) => void
  // A tournament already under way: the primary goes back to it rather than starting another.
  tournamentInProgress: boolean
  format: TournamentFormat
  onFormatChange: (f: TournamentFormat) => void
  onStart: () => void
  onStartTournament: (settings: TournamentSettings) => void
  // The bases the base sheet offers: in a tournament, those legal in its format.
  sheetBases: Base[]
  favouriteBases: Base[]
  recentBases: Base[]
  onChooseBase: (b: Base) => void
  mode: SwuMode
  onModeChange: (m: SwuMode) => void
  // Their base, shown in 2 players only.
  theirBase: Base | null
  theirArt: ReturnType<typeof useBaseArt>
  theirBaseFromLastGame: boolean
  onChooseTheirBase: (b: Base) => void
  // Twin Suns: opponents' bases by seat (TWIN_SUNS_SEATS), and the bases used for other players before.
  seats: (Base | null)[]
  onChooseSeatBase: (seat: number, b: Base) => void
  onRemoveSeatBase: (seat: number) => void
  otherPlayersBases: Base[]
  // Every base the mode needs is chosen.
  ready: boolean
  swudb: SwudbImportControls
  onBack?: () => void
  onHelp: () => void
  onSettings?: () => void
}

type OpenSheet = null | 'more' | 'base' | 'theirBase' | 'seat' | 'tournament'

// Under Match in Twin Suns: how many are playing, or what is still needed.
function twinSunsHint(hasBase: boolean, opponents: number): string {
  if (!hasBase) return 'Choose your base to start.'
  if (opponents === 0) return 'Twin Suns is for 3 or 4 players on this device. Add a base where each opponent sits; at least 2.'
  const players = opponents + 1
  if (opponents < TWIN_SUNS_MIN_OPPONENTS) {
    const more = TWIN_SUNS_MIN_OPPONENTS - opponents
    return `${players} players. Add ${more} more ${more === 1 ? 'base' : 'bases'} to play.`
  }
  if (opponents < TWIN_SUNS_SEATS.length) return `${players} players. Add a fourth, or go.`
  return `${players} players. Tap a base to change or remove it; it keeps its place.`
}

// The controls column (Mode, Match, primary) keeps this width whatever the mode.
const CONTROLS_WIDTH = '284px'

const ROUNDS_MIN = 2
const ROUNDS_MAX = 16
const LIMITED_NOTE = 'In Limited you can change base between games of a match.'

const rowLabelStyle: React.CSSProperties = { flex: 1, fontSize: '0.95rem' }

// Mounted only while its sheet is open, so Match and Rounds start from their defaults each time.
function StartTournamentBody({ base, format, onFormatChange, onChangeBase, onCancel, onStart }: {
  base: Base
  format: TournamentFormat
  onFormatChange: (f: TournamentFormat) => void
  onChangeBase: () => void
  onCancel: () => void
  onStart: (settings: TournamentSettings) => void
}) {
  const [playMode, setPlayMode] = useState<'bo1' | 'bo3'>('bo3')
  const [totalRounds, setTotalRounds] = useState(5)
  const legal = isBaseValidForFormat(format, base)

  return (
    <>
      {/* Your base, or why it can't be used in this format: one line either way, so the sheet fits 390px high. */}
      {legal ? <div style={mutedStyle}>{base.name}</div> : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div role="alert" style={{ flex: 1, fontSize: '0.85rem', lineHeight: 1.3, color: 'var(--color-error)' }}>{formatValidationError(format, base)}</div>
          <Button onClick={onChangeBase} style={{ flexShrink: 0 }}>Change base</Button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={rowLabelStyle}>Format</span>
        <div style={{ width: '260px', maxWidth: '70%' }}>
          <SegmentedControl
            label="Format"
            options={TOURNAMENT_FORMATS.map(f => ({ value: f, label: FORMAT_LABELS[f] }))}
            value={format}
            onChange={onFormatChange}
          />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={rowLabelStyle}>Match</span>
        <div style={{ width: '260px', maxWidth: '70%' }}>
          <SegmentedControl
            label="Match"
            options={[{ value: 'bo1', label: 'Best of 1' }, { value: 'bo3', label: 'Best of 3' }]}
            value={playMode}
            onChange={setPlayMode}
          />
        </div>
      </div>
      <Stepper label="Rounds" value={totalRounds} min={ROUNDS_MIN} max={ROUNDS_MAX} onChange={setTotalRounds} />
      <div style={mutedStyle}>
        <span>Fixed once round 1 starts.</span>
        {format === 'limited' && <> <span>{LIMITED_NOTE}</span></>}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!legal} onClick={() => onStart({ format, playMode, totalRounds })} style={{ minHeight: '52px', padding: '0 20px' }}>
          Start round 1
        </Button>
      </div>
    </>
  )
}

export default function SwuSetupScreenView({
  error,
  base,
  art,
  useHyperspace,
  isFavourite,
  onFavouriteToggle,
  matchType,
  onMatchTypeChange,
  tournamentInProgress,
  format,
  onFormatChange,
  onStart,
  onStartTournament,
  sheetBases,
  favouriteBases,
  recentBases,
  onChooseBase,
  mode,
  onModeChange,
  theirBase,
  theirArt,
  theirBaseFromLastGame,
  onChooseTheirBase,
  seats,
  onChooseSeatBase,
  onRemoveSeatBase,
  otherPlayersBases,
  ready,
  swudb,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const { isPortrait } = useOrientation()
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)
  // The Twin Suns seat the opponent sheet is for.
  const [seat, setSeat] = useState(0)
  const seatBase = seats[seat] ?? null

  const close = () => setOpenSheet(null)
  // Sheet actions close the sheet first, so it isn't left open behind the next screen.
  const closeThen = (fn?: () => void) => () => { close(); fn?.() }
  const openBaseSheet = () => setOpenSheet('base')

  const choose = (b: Base) => { onChooseBase(b); close() }
  const chooseTheirs = (b: Base) => { onChooseTheirBase(b); close() }
  const chooseForSeat = (b: Base) => { onChooseSeatBase(seat, b); close() }
  const twoPlayers = mode === '2p'
  const twinSuns = mode === 'twin-suns'
  const missingTheirs = twoPlayers && theirBase === null

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      {onBack && <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>}
      <SetupHeaderMark />
      <h1 style={{
        flex: 1,
        minWidth: 0,
        margin: 0,
        fontSize: isPortrait ? '17px' : '22px',
        fontWeight: 300,
        letterSpacing: isPortrait ? '0.06em' : '0.12em',
        whiteSpace: 'nowrap',
        color: 'var(--color-text-primary)',
      }}>
        Star Wars: Unlimited
      </h1>
      <IconButton label="More" onClick={() => setOpenSheet('more')}><DotsIcon /></IconButton>
    </div>
  )

  // Under the art rather than over it: the art is the whole card, with its own text.
  const baseInfo = (b: Base) => {
    const aspect = baseAspect(b)
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        {aspect && <img src={aspectIconSrc(aspect)} alt="" style={{ width: '28px', height: '28px', flexShrink: 0 }} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <span style={{ fontSize: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-body)' }}>{baseMeta(b)}</span>
        </div>
      </div>
    )
  }

  const favouriteToggle = (
    <button
      type="button"
      aria-pressed={isFavourite}
      onClick={onFavouriteToggle}
      style={{
        height: '32px',
        padding: '0 10px',
        border: 'none',
        borderRadius: '10px',
        background: 'var(--color-tonal)',
        color: isFavourite ? 'var(--color-epic)' : 'var(--color-tonal-text)',
        fontFamily: 'inherit',
        fontSize: '0.8rem',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <StarIcon filled={isFavourite} />Favourite
    </button>
  )

  // In 2 players the cards share the space: in portrait each takes a share of the height, and in
  // landscape Change base goes under the name, as the card is too narrow for both on one line.
  const shareHeight = isPortrait && twoPlayers
  const stackActions = !isPortrait && twoPlayers

  const baseCardFor = ({ testId, who, b, baseArt, labelColor, headerExtra, onOpen, alert }: {
    testId: string
    who: 'your' | 'their'
    b: Base | null
    baseArt: ReturnType<typeof useBaseArt>
    labelColor: string
    headerExtra: React.ReactNode
    onOpen: () => void
    alert?: React.ReactNode
  }) => (
    <div data-testid={testId} style={{ flex: isPortrait && (!b || shareHeight) ? 1 : undefined, minHeight: 0, minWidth: 0, background: 'var(--color-surface)', borderRadius: '16px', padding: '12px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minHeight: '32px' }}>
        <div style={sectionLabelStyle(labelColor)}>{who === 'your' ? 'Your base' : 'Their base'}</div>
        {b && headerExtra}
      </div>
      {b ? (
        <>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <ImagePreview
              base={b}
              src={baseArt.src}
              isHyperspace={baseArt.isHyperspace}
              allFailed={baseArt.allFailed}
              imageLoaded={baseArt.imageLoaded}
              rotationDeg={baseArt.rotationDeg}
              useHyperspace={useHyperspace}
              fill={isPortrait && !shareHeight ? 'width' : 'height'}
              centred
              onLoad={baseArt.onLoad}
              onError={baseArt.onError}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: stackActions ? 'column' : 'row', alignItems: stackActions ? 'stretch' : 'center', gap: stackActions ? '8px' : '12px' }}>
            {baseInfo(b)}
            <Button onClick={onOpen} style={{ flexShrink: 0 }}>Change base</Button>
          </div>
        </>
      ) : (
        <>
          {alert}
          <button
            type="button"
            onClick={onOpen}
            style={{ flex: 1, minHeight: '120px', border: 'none', borderRadius: '12px', background: 'var(--color-tonal)', color: 'var(--color-tonal-text)', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            <span style={{ color: 'var(--color-accent)', display: 'flex' }}><PlusIcon /></span>
            <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>{who === 'your' ? 'Choose your base' : 'Choose their base'}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-tonal-text)', opacity: 0.8 }}>Search by name, or paste an SWUDB deck link</span>
          </button>
        </>
      )}
    </div>
  )

  const baseCard = baseCardFor({
    testId: 'base-card',
    who: 'your',
    b: base,
    baseArt: art,
    labelColor: 'var(--color-accent)',
    headerExtra: favouriteToggle,
    onOpen: openBaseSheet,
    alert: error && <div role="alert" style={{ fontSize: '0.85rem', color: 'var(--color-error)' }}>{error}</div>,
  })

  // Their base has no Favourite toggle: favourites are your bases.
  const theirBaseCard = twoPlayers && baseCardFor({
    testId: 'their-base-card',
    who: 'their',
    b: theirBase,
    baseArt: theirArt,
    labelColor: 'var(--color-opponent)',
    headerExtra: theirBaseFromLastGame && <div style={mutedStyle}>Same as last game</div>,
    onOpen: () => setOpenSheet('theirBase'),
  })

  const twinSunsGrid = (
    <SwuTwinSunsGrid
      base={base}
      isFavourite={isFavourite}
      onFavouriteToggle={onFavouriteToggle}
      seats={seats}
      onOpenYours={openBaseSheet}
      onOpenSeat={i => { setSeat(i); setOpenSheet('seat') }}
      compact={isPortrait}
    />
  )

  const twinSunsNote = error
    ? <div role="alert" style={{ fontSize: '0.85rem', color: 'var(--color-error)' }}>{error}</div>
    : <div style={{ ...mutedStyle, lineHeight: 1.4 }}>{twinSunsHint(base !== null, seats.filter(b => b !== null).length)}</div>

  const modeSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={sectionLabelStyle()}>Mode</div>
      <SegmentedControl label="Mode" options={SWU_MODES} value={mode} onChange={onModeChange} />
    </div>
  )

  const matchSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={sectionLabelStyle()}>Match</div>
      <SegmentedControl
        label="Match"
        options={[{ value: 'casual', label: 'Casual' }, { value: 'tournament', label: 'Tournament' }]}
        value={matchType}
        onChange={onMatchTypeChange}
      />
    </div>
  )

  // A new tournament is set up on its start sheet; one under way is a tap away.
  const startsTournament = matchType === 'tournament' && !tournamentInProgress
  const primaryLabel = matchType === 'casual' ? 'Go to game' : tournamentInProgress ? 'Go to tournament' : 'Start tournament'
  const primary = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
      <Button variant="primary" onClick={startsTournament ? () => setOpenSheet('tournament') : onStart} disabled={!ready} style={{ minHeight: '52px' }}>
        {primaryLabel}
      </Button>
      {base && missingTheirs && <div style={{ ...mutedStyle, textAlign: 'center' }}>Choose their base to start.</div>}
    </div>
  )

  const sheets = (
    <>
      <Sheet open={openSheet === 'more'} title="More" onClose={close}>
        <Button onClick={closeThen(onHelp)}>Help</Button>
        {onSettings && <Button onClick={closeThen(onSettings)}>Settings</Button>}
      </Sheet>
      <SwuBaseSheet
        open={openSheet === 'base'}
        onClose={close}
        bases={sheetBases}
        favouriteBases={favouriteBases}
        recentBases={recentBases}
        currentKey={base ? baseKey(base) : null}
        onChoose={choose}
        swudb={swudb}
      />
      <SwuBaseSheet
        title="Choose their base"
        open={openSheet === 'theirBase'}
        onClose={close}
        bases={sheetBases}
        favouriteBases={favouriteBases}
        recentBases={recentBases}
        currentKey={theirBase ? baseKey(theirBase) : null}
        onChoose={chooseTheirs}
        swudb={swudb}
      />
      {/* Opponents' bases: no favourites, and the bases used for other players rather than your recent ones. */}
      <SwuBaseSheet
        title="Opponent’s base"
        open={openSheet === 'seat'}
        onClose={close}
        action={seatBase && (
          <Button onClick={() => { onRemoveSeatBase(seat); close() }} style={{ background: 'rgba(var(--color-error-rgb), 0.15)', color: 'var(--color-error)' }}>
            Remove base
          </Button>
        )}
        bases={sheetBases}
        favouriteBases={[]}
        recentBases={otherPlayersBases}
        recentLabel="Used for other players before"
        currentKey={seatBase ? baseKey(seatBase) : null}
        onChoose={chooseForSeat}
        swudb={swudb}
      />
      <Sheet open={openSheet === 'tournament' && base !== null} title="Start a tournament" onClose={close}>
        {base && (
          <StartTournamentBody
            base={base}
            format={format}
            onFormatChange={onFormatChange}
            onChangeBase={openBaseSheet}
            onCancel={close}
            onStart={settings => { close(); onStartTournament(settings) }}
          />
        )}
      </Sheet>
    </>
  )

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <div data-testid="swu-setup" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', color: 'var(--color-text-primary)' }}>
          {topBar}
          {twinSuns ? twinSunsGrid : (
            <>
              {baseCard}
              {theirBaseCard}
              {base && !twoPlayers && <div style={{ flex: 1 }} />}
            </>
          )}
          {modeSection}
          {matchSection}
          {twinSuns && twinSunsNote}
          {primary}
        </div>
        {sheets}
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div data-testid="swu-setup" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'hidden', color: 'var(--color-text-primary)' }}>
        {topBar}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `${twoPlayers ? 'minmax(0, 1fr) ' : ''}minmax(0, 1fr) ${CONTROLS_WIDTH}`, gap: '12px' }}>
          {twinSuns ? twinSunsGrid : <>{baseCard}{theirBaseCard}</>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
            {modeSection}
            {matchSection}
            {twinSuns && twinSunsNote}
            <div style={{ flex: 1 }} />
            {primary}
          </div>
        </div>
      </div>
      {sheets}
    </AppScreenLayout>
  )
}
