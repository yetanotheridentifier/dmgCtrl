import { useState } from 'react'
import { Base } from '../hooks/useBases'
import { baseKey, TOURNAMENT_FORMATS } from '../hooks/useSwuSetup'
import type { TournamentFormat, TournamentSettings } from '../hooks/useSwuSetup'
import type { useBaseArt } from '../hooks/useBaseArt'
import AppScreenLayout from './layout/appScreenLayout'
import ImagePreview from './imagePreview'
import SwuBaseSheet from './swuBaseSheet'
import { aspectIconSrc, baseAspect, baseMeta } from '../utils/baseAspect'
import { sectionLabelStyle, mutedStyle } from '../styles/sectionLabel'
import type { SwudbImportControls } from './swuBaseSheet'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon, DotsIcon, PlusIcon, StarIcon } from './icons'
import { Button, IconButton, SegmentedControl, Sheet, Stepper } from './shared/controls'
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
  swudb: SwudbImportControls
  onBack?: () => void
  onHelp: () => void
  onSettings?: () => void
}

type OpenSheet = null | 'more' | 'base' | 'tournament'

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
  swudb,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const { isPortrait } = useOrientation()
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)

  const close = () => setOpenSheet(null)
  // Sheet actions close the sheet first, so it isn't left open behind the next screen.
  const closeThen = (fn?: () => void) => () => { close(); fn?.() }
  const openBaseSheet = () => setOpenSheet('base')

  const choose = (b: Base) => { onChooseBase(b); close() }
  const currentKey = base ? baseKey(base) : null

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      {onBack && <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>}
      <img src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`} alt="" style={{ width: '30px', height: '30px', flexShrink: 0 }} />
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

  const aspect0 = base ? baseAspect(base) : null
  // Under the art rather than over it: the art is the whole card, with its own text.
  const baseInfo = base && (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
      {aspect0 && <img src={aspectIconSrc(aspect0)} alt="" style={{ width: '28px', height: '28px', flexShrink: 0 }} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <span style={{ fontSize: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{base.name}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-body)' }}>{baseMeta(base)}</span>
      </div>
    </div>
  )

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

  const baseCard = (
    <div data-testid="base-card" style={{ flex: isPortrait && !base ? 1 : undefined, minHeight: 0, minWidth: 0, background: 'var(--color-surface)', borderRadius: '16px', padding: '12px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minHeight: '32px' }}>
        <div style={sectionLabelStyle('var(--color-accent)')}>Your base</div>
        {base && favouriteToggle}
      </div>
      {base ? (
        <>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <ImagePreview
              base={base}
              src={art.src}
              isHyperspace={art.isHyperspace}
              allFailed={art.allFailed}
              imageLoaded={art.imageLoaded}
              rotationDeg={art.rotationDeg}
              useHyperspace={useHyperspace}
              fill={isPortrait ? 'width' : 'height'}
              centred
              onLoad={art.onLoad}
              onError={art.onError}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {baseInfo}
            <Button onClick={openBaseSheet} style={{ flexShrink: 0 }}>Change base</Button>
          </div>
        </>
      ) : (
        <>
          {error && <div role="alert" style={{ fontSize: '0.85rem', color: 'var(--color-error)' }}>{error}</div>}
          <button
            type="button"
            onClick={openBaseSheet}
            style={{ flex: 1, minHeight: '120px', border: 'none', borderRadius: '12px', background: 'var(--color-tonal)', color: 'var(--color-tonal-text)', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            <span style={{ color: 'var(--color-accent)', display: 'flex' }}><PlusIcon /></span>
            <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>Choose your base</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-tonal-text)', opacity: 0.8 }}>Search by name, or paste an SWUDB deck link</span>
          </button>
        </>
      )}
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
    <Button variant="primary" onClick={startsTournament ? () => setOpenSheet('tournament') : onStart} disabled={!base} style={{ minHeight: '52px', flexShrink: 0 }}>
      {primaryLabel}
    </Button>
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
        currentKey={currentKey}
        onChoose={choose}
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
        <div data-testid="swu-setup" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 16px 24px', overflowY: 'auto', color: 'var(--color-text-primary)' }}>
          {topBar}
          {baseCard}
          {base && <div style={{ flex: 1 }} />}
          {matchSection}
          {primary}
        </div>
        {sheets}
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div data-testid="swu-setup" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', overflow: 'hidden', color: 'var(--color-text-primary)' }}>
        {topBar}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 400px) minmax(0, 1fr)', gap: '16px' }}>
          {baseCard}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
            {matchSection}
            <div style={{ flex: 1 }} />
            {primary}
          </div>
        </div>
      </div>
      {sheets}
    </AppScreenLayout>
  )
}
