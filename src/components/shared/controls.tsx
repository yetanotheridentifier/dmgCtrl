import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useOrientation } from '../../hooks/useOrientation'
import { ChevronDownIcon, CloseIcon } from '../icons'

// The X-Wing control set agreed in #853: every control filled (never an empty outline), radius 12,
// at least 44px so it can be hit at the table.

const TAP: React.CSSProperties = {
  border: 'none',
  borderRadius: '12px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}

const DISABLED: React.CSSProperties = {
  background: 'var(--color-surface)',
  color: 'var(--color-text-disabled)',
  cursor: 'default',
}

interface ButtonProps {
  variant?: 'primary' | 'secondary'
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  style?: React.CSSProperties
  testId?: string
}

// Primary is the screen's one next step; secondary is everything else that is worded.
export function Button({ variant = 'secondary', children, onClick, disabled = false, style, testId }: ButtonProps) {
  const fill: React.CSSProperties = variant === 'primary'
    ? { background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 600, fontSize: '1.05rem' }
    : { background: 'var(--color-tonal)', color: 'var(--color-tonal-text)', fontWeight: 500, fontSize: '0.95rem' }
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{ ...TAP, ...fill, ...(disabled ? DISABLED : {}), minHeight: '44px', padding: '0 16px', ...style }}
    >
      {children}
    </button>
  )
}

interface IconButtonProps {
  label: string
  children: ReactNode
  onClick?: () => void
  // Size overrides, such as the SWU game's 60px margin column.
  style?: React.CSSProperties
}

// The dmgCtrl mark before the game title in a setup header. Decorative: the title names the screen.
export function SetupHeaderMark() {
  return <img src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`} alt="" style={{ width: '30px', height: '30px', flexShrink: 0 }} />
}

// Icon-only, so the label is what a screen reader announces. Kept to back, log, more and roll.
export function IconButton({ label, children, onClick, style }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        ...TAP,
        flexShrink: 0,
        width: '44px',
        height: '44px',
        background: 'var(--color-surface-raised)',
        color: 'var(--color-text-body)',
        fontSize: '22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

interface SegmentedControlProps<T extends string> {
  label: string
  options: { value: T; label: string }[]
  value: T | null
  onChange: (v: T) => void
}

export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', gap: '4px', height: '44px', padding: '4px', boxSizing: 'border-box', borderRadius: '12px', background: 'var(--color-surface)' }}
    >
      {options.map(o => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            style={{
              ...TAP,
              flex: 1,
              minWidth: 0,
              // One line, so three options fit the 284px controls column.
              padding: '0 4px',
              whiteSpace: 'nowrap',
              borderRadius: '9px',
              fontSize: '0.95rem',
              background: selected ? 'var(--color-accent)' : 'transparent',
              color: selected ? 'var(--color-on-accent)' : 'var(--color-text-body)',
              fontWeight: selected ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

interface SelectButtonProps {
  label: string
  value: string
  onClick: () => void
}

// Stands in for a native select: shows the value and opens a Sheet of choices.
export function SelectButton({ label, value, onClick }: SelectButtonProps) {
  return (
    <button
      type="button"
      aria-label={`${label}: ${value}`}
      aria-haspopup="dialog"
      onClick={onClick}
      style={{
        ...TAP,
        flex: 1,
        minWidth: 0,
        height: '44px',
        padding: '0 14px',
        background: 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        fontSize: '0.95rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      <span style={{ color: 'var(--color-text-muted)', display: 'flex' }}><ChevronDownIcon /></span>
    </button>
  )
}

interface OptionRowProps {
  title: string
  detail?: string
  selected?: boolean
  // A one-tap shortcut (last game's opponent): filled tonal like a selection, so it reads as tappable.
  suggested?: boolean
  onClick: () => void
  testId?: string
  // A small symbol before the title, such as a list's faction.
  icon?: ReactNode
}

// One choice in a Sheet, one or two lines: a list, a scenario, a start screen. `selected` marks the
// current choice.
export function OptionRow({ title, detail, selected = false, suggested = false, onClick, testId, icon }: OptionRowProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={suggested ? undefined : selected}
      onClick={onClick}
      style={{
        ...TAP,
        minHeight: '52px',
        padding: '6px 14px',
        background: selected || suggested ? 'var(--color-tonal)' : 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '2px',
      }}
    >
      {icon
        ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem' }}>{icon}{title}</span>
        : <span style={{ fontSize: '0.95rem' }}>{title}</span>}
      {detail && <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{detail}</span>}
    </button>
  )
}

interface StepperProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}

const stepButtonStyle = (disabled: boolean): React.CSSProperties => ({
  ...TAP,
  width: '44px',
  height: '44px',
  fontSize: '22px',
  background: 'var(--color-surface-raised)',
  color: 'var(--color-text-primary)',
  ...(disabled ? DISABLED : {}),
})

export function Stepper({ label, value, min, max, step = 1, onChange }: StepperProps) {
  const name = label.toLowerCase()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button type="button" aria-label={`Decrease ${name}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} style={stepButtonStyle(value <= min)}>−</button>
      <span style={{ minWidth: '48px', textAlign: 'center', fontSize: '1.3rem', fontWeight: 300, color: 'var(--color-text-primary)' }}>{value}</span>
      <button type="button" aria-label={`Increase ${name}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} style={stepButtonStyle(value >= max)}>+</button>
      <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  )
}

interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  // For a grid of choices too wide for the side: fills the screen in landscape.
  wide?: boolean
  // A button in the header, before Close, for an action on the sheet as a whole.
  action?: ReactNode
}

// An on-screen keyboard that does not resize the page (iOS) covers its lower part, which shows as a
// visual viewport shorter than the window. A zoomed-in view is shorter too but not covered, so the
// covered height is measured at the zoom. The keyboard covers far more than this; less is browser chrome.
const KEYBOARD_MIN_HEIGHT = 120
const SHEET_PADDING = 16

function subscribeToViewport(onChange: () => void) {
  const viewport = window.visualViewport
  viewport?.addEventListener('resize', onChange)
  viewport?.addEventListener('scroll', onChange)
  return () => {
    viewport?.removeEventListener('resize', onChange)
    viewport?.removeEventListener('scroll', onChange)
  }
}

// With the keyboard up, "<top of the visible area> <height of the window below it>", or '' with no
// keyboard: a string, so an unchanged area is an unchanged snapshot.
function keyboardSnapshot() {
  const viewport = window.visualViewport
  if (!viewport || window.innerHeight - viewport.height * viewport.scale < KEYBOARD_MIN_HEIGHT) return ''
  return `${viewport.offsetTop} ${window.innerHeight - viewport.offsetTop - viewport.height}`
}

// Choices open over the screen rather than replacing it: from the right in landscape, where height
// is short, and from the bottom in portrait, where the thumb is. While the on-screen keyboard is up,
// the sheet starts at the top of the visible area and still runs to the foot of the screen behind
// the keyboard, so nothing shows through, but its content scrolls to the top of the keyboard; it
// scrolls to put the field being typed in at its top.
export function Sheet({ open, title, onClose, children, wide = false, action }: SheetProps) {
  const { isPortrait } = useOrientation()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const keyboard = useSyncExternalStore(subscribeToViewport, keyboardSnapshot, () => '')
  const [visibleTop, covered] = keyboard ? keyboard.split(' ').map(Number) : [0, 0]

  useEffect(() => {
    const dialog = dialogRef.current
    const field = document.activeElement
    if (!keyboard || !dialog || !(field instanceof HTMLElement) || !dialog.contains(field)) return
    dialog.scrollTop += field.getBoundingClientRect().top - dialog.getBoundingClientRect().top - SHEET_PADDING
  }, [keyboard])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const where = isPortrait ? 'bottom' : wide ? 'full' : 'side'
  // A side the sheet runs to the screen edge on keeps its content clear by the edge token; the keyboard
  // is the foot of the screen while it is up.
  const foot = keyboard ? `${SHEET_PADDING + covered}px` : 'var(--edge-bottom)'
  const fromBottom = { paddingTop: `${SHEET_PADDING}px`, paddingRight: 'var(--edge-right)', paddingBottom: foot, paddingLeft: 'var(--edge-left)' }
  const placement: React.CSSProperties = {
    bottom: { left: 0, right: 0, bottom: 0, maxHeight: keyboard ? `calc(100% - ${visibleTop}px)` : '85vh', borderRadius: '20px 20px 0 0', ...fromBottom },
    full: { top: `${10 + visibleTop}px`, left: 0, right: 0, bottom: 0, borderRadius: '16px 16px 0 0', ...fromBottom },
    side: { top: `${visibleTop}px`, right: 0, bottom: 0, width: 'min(420px, 90vw)', borderRadius: '20px 0 0 20px', paddingTop: 'var(--edge-top)', paddingRight: 'var(--edge-right)', paddingBottom: foot, paddingLeft: `${SHEET_PADDING}px` },
  }[where]
  // A scroll bounce stays in the sheet rather than moving the page under it.
  const contained: React.CSSProperties = keyboard ? { overscrollBehavior: 'contain' } : {}

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 30, ...contained }}>
      <div data-testid="sheet-backdrop" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--color-backdrop)' }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-placement={where}
        style={{
          position: 'absolute',
          ...placement,
          boxSizing: 'border-box',
          background: 'var(--color-sheet)',
          color: 'var(--color-text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          overflowY: 'auto',
          ...contained,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px' }}>
          <h2 id={titleId} style={{ flex: 1, margin: 0, fontSize: '1.15rem', fontWeight: 500 }}>{title}</h2>
          {action}
          <IconButton label="Close" onClick={onClose}><CloseIcon /></IconButton>
        </div>
        {children}
      </div>
      {/* With the keyboard up, iOS can pan or bounce the page past the foot of the screen: the
          sheet's colour runs on below it, so the page never shows there. */}
      {keyboard && <div data-testid="sheet-overhang" style={{ position: 'absolute', left: placement.left, right: placement.right, width: placement.width, top: '100%', height: '100vh', background: 'var(--color-sheet)' }} />}
    </div>
  )
}
