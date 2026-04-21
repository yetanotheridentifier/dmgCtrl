import { Base } from '../hooks/useBases'
import AppScreenLayout from './layout/AppScreenLayout'
import ImagePreview from './imagePreview'

interface Props {
  loading: boolean
  error: string | null
  availableSets: string[]
  availableAspects: string[]
  filteredBases: Base[]
  selectedSet: string
  selectedAspect: string
  selectedKey: string
  selectedBase: Base | null
  useHyperspace: boolean
  showHyperspaceToggle: boolean
  artSrc: string | null
  artIsHyperspace: boolean
  artAllFailed: boolean
  artImageLoaded: boolean
  artRotationDeg: number
  onArtLoad: () => void
  onArtError: () => void
  onSetChange: (set: string) => void
  onAspectChange: (aspect: string) => void
  onKeyChange: (key: string) => void
  onHyperspaceToggle: (value: boolean) => void
  onSubmit: () => void
  onHelp: () => void
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

function SwuSetupScreenView({
  loading,
  error,
  availableSets,
  availableAspects,
  filteredBases,
  selectedSet,
  selectedAspect,
  selectedKey,
  selectedBase,
  useHyperspace,
  showHyperspaceToggle,
  artSrc,
  artIsHyperspace,
  artAllFailed,
  artImageLoaded,
  artRotationDeg,
  onArtLoad,
  onArtError,
  onSetChange,
  onAspectChange,
  onKeyChange,
  onHyperspaceToggle,
  onSubmit,
  onHelp,
}: Props) {
  return (
    <AppScreenLayout>

      {/* Help button */}
      <button
        onClick={onHelp}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 1vh)',
          right: 'calc(env(safe-area-inset-right) + 1vw)',
          width: '5vw',
          height: '5vw',
          minWidth: '36px',
          minHeight: '36px',
          background: 'transparent',
          border: '2px solid #6b7280',
          borderRadius: '8px',
          color: '#9ca3af',
          fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 0 8px rgba(156, 163, 175, 0.2)',
        }}
      >
        ?
      </button>

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
          fontWeight: '200',
          fontSize: 'clamp(1.8rem, 8vw, 3rem)',
          letterSpacing: '0.15em',
          margin: 0,
        }}>
          dmgCtrl
        </h1>

        <h2 style={{
          color: '#4fc3f7',
          fontWeight: '300',
          fontSize: 'clamp(0.9rem, 4vw, 1.2rem)',
          letterSpacing: '0.12em',
          margin: 0,
          textTransform: 'uppercase',
        }}>
          Select Base
        </h2>

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
            {/* Row 1: Set and Aspect */}
            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'row',
              gap: '2vw',
              alignItems: 'flex-end',
            }}>
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
                  fontSize: 'clamp(0.7rem, 5vw, 0.9rem)',
                  letterSpacing: '0.08em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>
                  Set
                </label>
                <select
                  value={selectedSet}
                  onChange={e => onSetChange(e.target.value)}
                  style={selectStyle(true, selectedSet !== '')}
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
                  fontSize: 'clamp(0.7rem, 5vw, 0.9rem)',
                  letterSpacing: '0.08em',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>
                  Aspect
                </label>
                <select
                  value={selectedAspect}
                  onChange={e => onAspectChange(e.target.value)}
                  disabled={!selectedSet}
                  style={selectStyle(!!selectedSet, selectedAspect !== '')}
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
                onChange={e => onKeyChange(e.target.value)}
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
                onClick={onSubmit}
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
              <div style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1vh',
              }}>
                <ImagePreview
                  base={selectedBase}
                  src={artSrc}
                  isHyperspace={artIsHyperspace}
                  allFailed={artAllFailed}
                  imageLoaded={artImageLoaded}
                  rotationDeg={artRotationDeg}
                  useHyperspace={useHyperspace}
                  onLoad={onArtLoad}
                  onError={onArtError}
                />

                {/* Row 4: Hyperspace toggle */}
                {showHyperspaceToggle && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: '2vw',
                  }}>
                    <input
                      type="checkbox"
                      id="hyperspace-toggle"
                      checked={useHyperspace}
                      onChange={e => onHyperspaceToggle(e.target.checked)}
                      style={{
                        width: '24px',
                        height: '24px',
                        cursor: 'pointer',
                        accentColor: '#4fc3f7',
                        flexShrink: 0,
                      }}
                    />
                    <label
                      htmlFor="hyperspace-toggle"
                      style={{
                        color: '#ffffff',
                        fontWeight: '300',
                        fontSize: 'clamp(0.9rem, 3vw, 1.2rem)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Hyperspace variant
                    </label>
                  </div>
                )}
              </div>
            )}
          </>
        )}

      </div>
    </AppScreenLayout>
  )
}

export default SwuSetupScreenView