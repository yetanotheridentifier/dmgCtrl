import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon } from './icons'
import { Button, IconButton, OptionRow, SegmentedControl, SelectButton, Sheet } from './shared/controls'
import { sectionLabelStyle } from '../styles/sectionLabel'
import type { ForceTokenDisplay, StartScreen } from '../hooks/useUserSettings'

const START_SCREENS: { value: StartScreen; label: string }[] = [
  { value: 'gameSelect', label: 'Game select' },
  { value: 'swu', label: 'Star Wars: Unlimited' },
  { value: 'xwing', label: 'X-Wing' },
]

const FORCE_TOKENS: { value: ForceTokenDisplay; label: string }[] = [
  { value: 'always-on', label: 'Always' },
  { value: 'lof-only', label: 'LOF bases' },
  { value: 'always-off', label: 'Off' },
]

// The width of a control beside its label in landscape, so the right-hand controls line up.
const CONTROL_WIDTH = '260px'

const labelStyle: React.CSSProperties = { fontSize: '15px', color: 'var(--color-text-primary)' }
const noteStyle: React.CSSProperties = { fontSize: '12px', lineHeight: '16px', color: 'var(--color-text-muted)' }

// Settings is the only screen with on/off choices, so the switch lives here rather than in the
// shared controls. The button is 44px tall so the track is easy to hit.
function SwitchRow({ label, note, checked, onChange }: { label: string; note?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px' }}>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={labelStyle}>{label}</span>
        {note && <span style={noteStyle}>{note}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{ flexShrink: 0, width: '60px', height: '44px', padding: 0, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
      >
        <span style={{
          width: '52px',
          height: '32px',
          boxSizing: 'border-box',
          padding: '3px',
          borderRadius: '16px',
          background: checked ? 'var(--color-accent)' : 'rgba(var(--color-ui-border-muted-rgb), 0.25)',
          display: 'flex',
          justifyContent: checked ? 'flex-end' : 'flex-start',
          transition: 'background 0.15s',
        }}>
          <span style={{ width: '26px', height: '26px', borderRadius: '13px', background: checked ? 'var(--color-on-accent)' : 'var(--color-text-muted)' }} />
        </span>
      </button>
    </div>
  )
}

// A labelled control: beside its label in landscape, under it in portrait where the width is short.
function FieldRow({ label, htmlFor, stacked, children }: { label: string; htmlFor?: string; stacked: boolean; children: ReactNode }) {
  const text = htmlFor ? <label htmlFor={htmlFor} style={{ ...labelStyle, flex: 1 }}>{label}</label> : <span style={{ ...labelStyle, flex: 1 }}>{label}</span>
  if (stacked) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {text}
        {children}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px' }}>
      {text}
      <div style={{ width: CONTROL_WIDTH, flexShrink: 0, display: 'flex' }}>{children}</div>
    </div>
  )
}

// A filled group. Its controls sit on the group's fill, so they take the raised fill instead of
// the surface one they use on a bare screen.
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} style={{ background: 'var(--color-surface)', borderRadius: '16px', padding: '12px 14px' }}>
      <div style={{ ['--color-surface' as string]: 'var(--color-surface-raised)', display: 'flex', flexDirection: 'column', gap: '8px' } as React.CSSProperties}>
        <div style={sectionLabelStyle('var(--color-accent)')}>{label}</div>
        {children}
      </div>
    </section>
  )
}

interface Props {
  startScreen: StartScreen
  onStartScreenChange: (v: StartScreen) => void
  useHyperspace: boolean
  onUseHyperspaceChange: (v: boolean) => void
  forceTokenDisplay: ForceTokenDisplay
  onForceTokenDisplayChange: (v: ForceTokenDisplay) => void
  meleePlayerGuid: string
  onMeleePlayerGuidChange: (v: string) => void
  enableDamageButtons: boolean
  onEnableDamageButtonsChange: (v: boolean) => void
  enableInitiativeBar: boolean
  onEnableInitiativeBarChange: (v: boolean) => void
  enableXwingPhases: boolean
  onEnableXwingPhasesChange: (v: boolean) => void
  enableXwingAlwaysIncDec: boolean
  onEnableXwingAlwaysIncDecChange: (v: boolean) => void
  onManageXwingLists?: () => void
  onBack: () => void
}

export default function SettingsScreenView(props: Props) {
  const { isPortrait } = useOrientation()
  const [startSheetOpen, setStartSheetOpen] = useState(false)
  const meleeId = useId()

  const startLabel = START_SCREENS.find(s => s.value === props.startScreen)?.label ?? START_SCREENS[0].label

  const general = (
    <Section label="General">
      <FieldRow label="Start screen" stacked={isPortrait}>
        <SelectButton label="Start screen" value={startLabel} onClick={() => setStartSheetOpen(true)} />
      </FieldRow>
    </Section>
  )

  const swu = (
    <Section label="Star Wars: Unlimited">
      <SwitchRow label="Hyperspace art" checked={props.useHyperspace} onChange={props.onUseHyperspaceChange} />
      <FieldRow label="Force tokens" stacked={isPortrait}>
        <div style={{ flex: 1 }}>
          <SegmentedControl label="Force tokens" options={FORCE_TOKENS} value={props.forceTokenDisplay} onChange={props.onForceTokenDisplayChange} />
        </div>
      </FieldRow>
      <FieldRow label="Melee player ID" htmlFor={meleeId} stacked={isPortrait}>
        <input
          id={meleeId}
          type="text"
          value={props.meleePlayerGuid}
          onChange={e => props.onMeleePlayerGuidChange(e.target.value)}
          placeholder="Optional"
          style={{ flex: 1, minWidth: 0, height: '44px', boxSizing: 'border-box', border: 'none', borderRadius: '12px', background: 'var(--color-surface-raised)', color: 'var(--color-text-primary)', fontFamily: 'inherit', fontSize: '15px', padding: '0 14px', outline: 'none' }}
        />
      </FieldRow>
      <SwitchRow label="Damage −/+ buttons" checked={props.enableDamageButtons} onChange={props.onEnableDamageButtonsChange} />
      <SwitchRow label="Initiative" checked={props.enableInitiativeBar} onChange={props.onEnableInitiativeBarChange} />
    </Section>
  )

  const xwing = (
    <Section label="X-Wing">
      <SwitchRow
        label="Phase tracker"
        note={isPortrait ? 'Step through every phase. Off: the round button scores the round' : undefined}
        checked={props.enableXwingPhases}
        onChange={props.onEnableXwingPhasesChange}
      />
      <SwitchRow
        label="Score −/+ buttons"
        note={isPortrait ? 'Change scores by hand on the game screen' : undefined}
        checked={props.enableXwingAlwaysIncDec}
        onChange={props.onEnableXwingAlwaysIncDecChange}
      />
      {props.onManageXwingLists && <Button onClick={props.onManageXwingLists}>Squad lists</Button>}
    </Section>
  )

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', height: '44px', flexShrink: 0 }}>
      <IconButton label="Back" onClick={props.onBack}><BackIcon /></IconButton>
      <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 300, letterSpacing: '0.12em', color: 'var(--color-text-primary)' }}>Settings</h1>
    </div>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: '16px', display: 'flex', flexDirection: 'column', gap: isPortrait ? '14px' : '12px', color: 'var(--color-text-primary)' }}>
      {header}
      {isPortrait ? (
        <>
          {general}
          {swu}
          {xwing}
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>
          <div data-testid="settings-left" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {general}
            {xwing}
          </div>
          <div data-testid="settings-right">{swu}</div>
        </div>
      )}
      <Sheet open={startSheetOpen} title="Start screen" onClose={() => setStartSheetOpen(false)}>
        {START_SCREENS.map(s => (
          <OptionRow
            key={s.value}
            title={s.label}
            selected={s.value === props.startScreen}
            onClick={() => { props.onStartScreenChange(s.value); setStartSheetOpen(false) }}
          />
        ))}
      </Sheet>
    </div>
  )
}
