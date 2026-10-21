import { useEffect, useId } from 'react'
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
}

// Primary is the screen's one next step; secondary is everything else that is worded.
export function Button({ variant = 'secondary', children, onClick, disabled = false, style }: ButtonProps) {
  const fill: React.CSSProperties = variant === 'primary'
    ? { background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 600, fontSize: '1.05rem' }
    : { background: 'var(--color-tonal)', color: 'var(--color-tonal-text)', fontWeight: 500, fontSize: '0.95rem' }
  return (
    <button
      type="button"
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
}

// Icon-only, so the label is what a screen reader announces. Kept to back, log, more and roll.
export function IconButton({ label, children, onClick }: IconButtonProps) {
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
}

// Choices open over the screen rather than replacing it: from the right in landscape, where height
// is short, and from the bottom in portrait, where the thumb is.
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const { isPortrait } = useOrientation()
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const placement: React.CSSProperties = isPortrait
    ? { left: 0, right: 0, bottom: 0, maxHeight: '85vh', borderRadius: '20px 20px 0 0' }
    : { top: 0, right: 0, bottom: 0, width: 'min(420px, 90vw)', borderRadius: '20px 0 0 20px' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 30 }}>
      <div data-testid="sheet-backdrop" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--color-backdrop)' }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-placement={isPortrait ? 'bottom' : 'side'}
        style={{
          position: 'absolute',
          ...placement,
          boxSizing: 'border-box',
          padding: '16px',
          background: 'var(--color-sheet)',
          color: 'var(--color-text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px' }}>
          <h2 id={titleId} style={{ flex: 1, margin: 0, fontSize: '1.15rem', fontWeight: 500 }}>{title}</h2>
          <IconButton label="Close" onClick={onClose}><CloseIcon /></IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}
