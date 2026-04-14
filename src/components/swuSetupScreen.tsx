import { useState, useMemo, useEffect } from 'react'
import { useBases, Base } from '../hooks/useBases'

const starField = `radial-gradient(ellipse at 20% 50%, #0d1b2a 0%, #0a0e1a 60%, #000510 100%)`

const ASPECT_ORDER = ['Aggression', 'Command', 'Cunning', 'Vigilance', 'None']

interface Props {
  onConfirm: (base: Base) => void
}

function ImageFallbackText({ base }: { base: Base }) {
  const [failed, setFailed] = useState(false)

  if (!failed) {
    return (
      <img
        src={base.frontArt}
        alt={base.name}
        onError={() => setFailed(true)}
        style={{
          width: '100%',
          borderRadius: '12px',
          border: '2px solid #4fc3f7',
          boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
        }}
      />
    )
  }

  return (
    <div style={{
      width: '100%',
      padding: '2vh',
      border: '2px solid #4fc3f7',
      borderRadius: '12px',
      boxSizing: 'border-box',
      boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
    }}>
      <p style={{
        color: '#ffffff',
        fontWeight: '300',
        fontSize: 'clamp(0.9rem, 3vw, 1.2rem)',
        margin: '0 0 0.5vh',
      }}>
        {base.name} — {base.subtitle}
      </p>
      {base.epicAction && (
        <p style={{
          color: '#a8a8b3',
          fontWeight: '300',
          fontSize: 'clamp(0.7rem, 2.5vw, 1rem)',
          margin: 0,
          fontStyle: 'italic',
        }}>
          {base.epicAction}
        </p>
      )}
    </div>
  )
}

function SwuSetupScreen({ onConfirm }: Props) {
  const { bases, loading, error } = useBases()
  const [selectedSet, setSelectedSet] = useState('')
  const [selectedAspect, setSelectedAspect] = useState('')
  const [selectedKey, setSelectedKey] = useState('')

  const availableSets = useMemo(() => {
    const sets = [...new Set(bases.map(b => b.set))].sort()
    return sets
  }, [bases])

  const availableAspects = useMemo(() => {
    if (!selectedSet) return []
    const basesInSet = bases.filter(b => b.set === selectedSet)
    const aspects = new Set<string>()
    basesInSet.forEach(b => {
      if (b.aspects.length === 0) {
        aspects.add('None')
      } else {
        b.aspects.forEach(a => aspects.add(a))
      }
    })
    return ASPECT_ORDER.filter(a => aspects.has(a))
  }, [bases, selectedSet])

  const filteredBases = useMemo(() => {
    if (!selectedSet || !selectedAspect) return []
    return bases.filter(b => {
      if (b.set !== selectedSet) return false
      if (selectedAspect === 'None') return b.aspects.length === 0
      return b.aspects.includes(selectedAspect)
    })
  }, [bases, selectedSet, selectedAspect])

  const selectedBase = filteredBases.find(
    b => `${b.set}-${b.number}` === selectedKey
  ) ?? null

  const handleSetChange = (set: string) => {
    setSelectedSet(set)
    setSelectedAspect('')
    setSelectedKey('')
  }

  const handleAspectChange = (aspect: string) => {
    setSelectedAspect(aspect)
    setSelectedKey('')
  }

  // Auto-select aspect when only one option available
  useEffect(() => {
    if (availableAspects.length === 1) {
      setSelectedAspect(availableAspects[0])
      setSelectedKey('')
    }
  }, [availableAspects])

  // Auto-select base when only one option available
  useEffect(() => {
    if (filteredBases.length === 1) {
      setSelectedKey(`${filteredBases[0].set}-${filteredBases[0].number}`)
    }
  }, [filteredBases])

  const handleSubmit = () => {
    if (!selectedBase) return
    onConfirm(selectedBase)
  }

  const selectStyle = (enabled: boolean, hasValue: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '1.5vh 2vw',
    fontSize: 'clamp(0.9rem, 3vw, 1.2rem)',
    fontWeight: '300',
    background: 'transparent',
    border: '2px solid #4fc3f7',
    borderRadius: '12px',
    color: hasValue ? '#ffffff' : '#6b7280',
    outline: 'none',
    boxSizing: 'border-box',
    boxShadow: '0 0 12px rgba(79, 195, 247, 0.3)',
    WebkitAppearance: 'none',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.4,
    width: '100%',
  })

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: starField,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      touchAction: 'none',
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      boxSizing: 'border-box',
    }}>

      {/* Star field layer */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.6) 0%, transparent 100%),
          radial-gradient(1px 1px at 25% 75%, rgba(255,255,255,0.4) 0%, transparent 100%),
          radial-gradient(1px 1px at 40% 35%, rgba(255,255,255,0.7) 0%, transparent 100%),
          radial-gradient(1px 1px at 55% 60%, rgba(255,255,255,0.3) 0%, transparent 100%),
          radial-gradient(1px 1px at 65% 15%, rgba(255,255,255,0.5) 0%, transparent 100%),
          radial-gradient(1px 1px at 75% 85%, rgba(255,255,255,0.6) 0%, transparent 100%),
          radial-gradient(1px 1px at 85% 40%, rgba(255,255,255,0.4) 0%, transparent 100%),
          radial-gradient(1px 1px at 90% 70%, rgba(255,255,255,0.5) 0%, transparent 100%),
          radial-gradient(1px 1px at 15% 90%, rgba(255,255,255,0.3) 0%, transparent 100%),
          radial-gradient(1px 1px at 50% 10%, rgba(255,255,255,0.6) 0%, transparent 100%),
          radial-gradient(2px 2px at 30% 50%, rgba(255,255,255,0.2) 0%, transparent 100%),
          radial-gradient(2px 2px at 70% 30%, rgba(255,255,255,0.15) 0%, transparent 100%)
        `,
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      {/* Scrollable content */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '5vw',
        gap: '2vh',
        overflowY: 'auto',
        flex: 1,
      }}>

        <h1 style={{
          color: '#ffffff',
          fontWeight: '300',
          fontSize: 'clamp(1.2rem, 10vw, 2rem)',
          letterSpacing: '0.1em',
          margin: 0,
        }}>
          Select Base
        </h1>

        {loading && (
          <p style={{
            color: '#4fc3f7',
            fontWeight: '300',
            fontSize: 'clamp(0.9rem, 3vw, 1.2rem)',
            margin: 0,
          }}>
            Loading bases...
          </p>
        )}

        {error && (
          <p style={{
            color: '#ff6b6b',
            fontWeight: '300',
            fontSize: 'clamp(0.9rem, 3vw, 1.2rem)',
            margin: 0,
          }}>
            {error}
          </p>
        )}

        {!loading && !error && (
          <>
            {/* Row 1: Set and Aspect with labels */}
            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'row',
              gap: '2vw',
              alignItems: 'flex-end',
            }}>

              {/* Set — 1/3 width */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '1vw',
              }}>
                <label style={{
                  color: '#a8a8b3',
                  fontWeight: '300',
                  fontSize: 'clamp(0.7rem, 6vw, 0.9rem)',
                  letterSpacing: '0.08em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>
                  Set
                </label>
                <select
                  value={selectedSet}
                  onChange={e => handleSetChange(e.target.value)}
                  style={{...selectStyle(true, selectedSet !== ''), flex: 1}}
                >
                  <option value="" disabled style={{ color: '#6b7280', background: '#0a0e1a' }}>
                    Set
                  </option>
                  {availableSets.map(set => (
                    <option key={set} value={set} style={{ color: '#ffffff', background: '#0a0e1a' }}>
                      {set}
                    </option>
                  ))}
                </select>
              </div>

              {/* Aspect — 2/3 width */}
              <div style={{
                flex: 2,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '1vw',
              }}>
                <label style={{
                  color: '#a8a8b3',
                  fontWeight: '300',
                  fontSize: 'clamp(0.7rem, 6vw, 0.9rem)',
                  letterSpacing: '0.08em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>
                  Aspect
                </label>
                <select
                  value={selectedAspect}
                  onChange={e => handleAspectChange(e.target.value)}
                  disabled={!selectedSet}
                  style={{...selectStyle(!!selectedSet, selectedAspect !== ''), flex: 1}}
                >
                  <option value="" disabled style={{ color: '#6b7280', background: '#0a0e1a' }}>
                    Aspect
                  </option>
                  {availableAspects.map(aspect => (
                    <option key={aspect} value={aspect} style={{ color: '#ffffff', background: '#0a0e1a' }}>
                      {aspect}
                    </option>
                  ))}
                </select>
              </div>

            </div>

            {/* Row 2: Base and submit */}
            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              gap: '2vw',
            }}>
              <select
                value={selectedKey}
                onChange={e => setSelectedKey(e.target.value)}
                disabled={!selectedAspect}
                style={selectStyle(!!selectedAspect, selectedKey !== '')}
              >
                <option value="" disabled style={{ color: '#6b7280', background: '#0a0e1a' }}>
                  Base
                </option>
                {filteredBases.map(base => (
                  <option
                    key={`${base.set}-${base.number}`}
                    value={`${base.set}-${base.number}`}
                    style={{ color: '#ffffff', background: '#0a0e1a' }}
                  >
                    {base.name} — {base.subtitle} {base.hp}HP
                  </option>
                ))}
              </select>

              <button
                onClick={handleSubmit}
                disabled={!selectedBase}
                style={{
                  width: '12vw',
                  height: '12vw',
                  minWidth: '44px',
                  minHeight: '44px',
                  flexShrink: 0,
                  padding: '0',
                  fontSize: 'clamp(1rem, 3vw, 1.8rem)',
                  fontWeight: '300',
                  background: 'transparent',
                  color: '#ffffff',
                  border: '2px solid #ffffff',
                  borderRadius: '12px',
                  cursor: !selectedBase ? 'not-allowed' : 'pointer',
                  boxShadow: '0 0 12px rgba(255, 255, 255, 0.2)',
                  WebkitTapHighlightColor: 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: !selectedBase ? 0.4 : 1,
                }}
              >
                &gt;
              </button>
            </div>

            {/* Row 3: Base preview */}
            {selectedBase && (
              <div style={{ width: '100%' }}>
                <ImageFallbackText base={selectedBase} />
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

export default SwuSetupScreen