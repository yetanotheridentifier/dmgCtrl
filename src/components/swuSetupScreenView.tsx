import { Base } from '../hooks/useBases'
import AppScreenLayout from './layout/AppScreenLayout'
import ImagePreview from './imagePreview'
import { useOrientation } from '../hooks/useOrientation'

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

const selectStyle = (enabled: boolean, hasValue: boolean, small = false): React.CSSProperties => ({
  flex: 1,
  padding: small ? '0.8vh 1.5vw' : '1.5vh 2vw',
  fontSize: small ? 'clamp(0.75rem, 1.8vw, 0.9rem)' : 'clamp(0.9rem, 3vw, 1.2rem)',
  ...(small && { height: 'max(44px, 8vh)' }),
  fontWeight: '300',
  background: 'transparent',
  border: '2px solid var(--color-accent)',
  borderRadius: '12px',
  color: hasValue ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
  outline: 'none',
  boxSizing: 'border-box',
  boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
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
  const { isPortrait } = useOrientation()

  const hyperspaceToggle = showHyperspaceToggle && (
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
          accentColor: 'var(--color-accent)',
          flexShrink: 0,
        }}
      />
      <label
        htmlFor="hyperspace-toggle"
        style={{
          color: 'var(--color-text-muted)',
          fontWeight: '300',
          fontSize: 'clamp(0.7rem, 3vw, 0.9rem)',
          letterSpacing: '0.08em',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Hyperspace variant
      </label>
    </div>
  )

  if (!isPortrait) {
    return (
      <AppScreenLayout>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '3vw 4vw 3vw',
        }}>

          {/* Title row: full width, help button on the right */}
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <h1 style={{
              color: 'var(--color-text-primary)',
              fontWeight: '200',
              fontSize: 'clamp(1.2rem, 4vw, 1.8rem)',
              letterSpacing: '0.15em',
              margin: 0,
            }}>
              dmgCtrl
            </h1>

            <button
              onClick={onHelp}
              style={{
                width: '5vh',
                height: '5vh',
                minWidth: '36px',
                minHeight: '36px',
                flexShrink: 0,
                background: 'transparent',
                border: '2px solid var(--color-ui-border)',
                borderRadius: '8px',
                color: 'var(--color-ui-border-muted)',
                fontSize: 'clamp(0.8rem, 2vh, 1.2rem)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
              }}
            >
              ?
            </button>
          </div>

          {/* Content row: selectors left, preview right-aligned below help button */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            minHeight: 0,
            padding: '1.5vh 0 0',
            gap: '3vw',
          }}>

            {/* Left: selectors */}
            <div style={{
              flex: '0 0 45%',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              gap: '1.5vh',
            }}>

              <h2 style={{
                color: 'var(--color-accent)',
                fontWeight: '300',
                fontSize: 'clamp(0.8rem, 3vw, 1rem)',
                letterSpacing: '0.12em',
                margin: 0,
                textTransform: 'uppercase',
              }}>
                Select Base
              </h2>

              {loading && (
                <p style={{
                  color: 'var(--color-accent)',
                  fontWeight: '300',
                  fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
                  margin: 0,
                }}>
                  Loading bases...
                </p>
              )}

              {error && (
                <p style={{
                  color: 'var(--color-error)',
                  fontWeight: '300',
                  fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
                  margin: 0,
                }}>
                  {error}
                </p>
              )}

              {!loading && !error && (
                <>
                  {/* Set + Aspect row */}
                  <div style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'row',
                    gap: '2vw',
                    alignItems: 'flex-end',
                  }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
                      <label style={{
                        color: 'var(--color-text-muted)',
                        fontWeight: '300',
                        fontSize: 'clamp(0.7rem, 2vw, 0.9rem)',
                        letterSpacing: '0.08em',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}>
                        Set
                      </label>
                      <select
                        value={selectedSet}
                        onChange={e => onSetChange(e.target.value)}
                        style={selectStyle(true, selectedSet !== '', true)}
                      >
                        <option value="" disabled style={{ color: 'var(--color-text-disabled)', background: 'var(--color-bg-deep)' }}>Set</option>
                        {availableSets.map(set => (
                          <option key={set} value={set} style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>{set}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ flex: 2, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '1vw' }}>
                      <label style={{
                        color: 'var(--color-text-muted)',
                        fontWeight: '300',
                        fontSize: 'clamp(0.7rem, 2vw, 0.9rem)',
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
                        style={selectStyle(!!selectedSet, selectedAspect !== '', true)}
                      >
                        <option value="" disabled style={{ color: 'var(--color-text-disabled)', background: 'var(--color-bg-deep)' }}>Aspect</option>
                        {availableAspects.map(aspect => (
                          <option key={aspect} value={aspect} style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>{aspect}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Base + submit row */}
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
                      style={selectStyle(!!selectedAspect, selectedKey !== '', true)}
                    >
                      <option value="" disabled style={{ color: 'var(--color-text-disabled)', background: 'var(--color-bg-deep)' }}>Base</option>
                      {filteredBases.map(base => (
                        <option
                          key={`${base.set}-${base.number}`}
                          value={`${base.set}-${base.number}`}
                          style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}
                        >
                          {base.name} — {base.hp}HP
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={onSubmit}
                      disabled={!selectedBase}
                      style={{
                        width: '8vh',
                        height: '8vh',
                        minWidth: '44px',
                        minHeight: '44px',
                        flexShrink: 0,
                        padding: '0',
                        fontSize: 'clamp(1rem, 3vh, 1.8rem)',
                        fontWeight: '300',
                        background: 'transparent',
                        color: 'var(--color-text-primary)',
                        border: '2px solid var(--color-text-primary)',
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

                  {hyperspaceToggle}
                </>
              )}
            </div>

            {/* Right: preview, top-right aligned under the help button */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'flex-end',
            }}>
              {selectedBase && (
                <div style={{ width: '100%' }}>
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
                </div>
              )}
            </div>

          </div>
        </div>
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>

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

        {/* Title row: app name + help button */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <h1 style={{
            color: 'var(--color-text-primary)',
            fontWeight: '200',
            fontSize: 'clamp(1.8rem, 8vw, 3rem)',
            letterSpacing: '0.15em',
            margin: 0,
          }}>
            dmgCtrl
          </h1>

          <button
            onClick={onHelp}
            style={{
              width: '5vw',
              height: '5vw',
              minWidth: '36px',
              minHeight: '36px',
              flexShrink: 0,
              background: 'transparent',
              border: '2px solid var(--color-ui-border)',
              borderRadius: '8px',
              color: 'var(--color-ui-border-muted)',
              fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
              boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
            }}
          >
            ?
          </button>
        </div>

        <h2 style={{
          color: 'var(--color-accent)',
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
            color: 'var(--color-accent)',
            fontWeight: '300',
            fontSize: 'clamp(0.9rem, 3vw, 1.2rem)',
            margin: 0,
          }}>
            Loading bases...
          </p>
        )}

        {error && (
          <p style={{
            color: 'var(--color-error)',
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
                  color: 'var(--color-text-muted)',
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
                  <option value="" disabled style={{ color: 'var(--color-text-disabled)', background: 'var(--color-bg-deep)' }}>
                    Set
                  </option>
                  {availableSets.map(set => (
                    <option key={set} value={set} style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>
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
                  color: 'var(--color-text-muted)',
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
                  <option value="" disabled style={{ color: 'var(--color-text-disabled)', background: 'var(--color-bg-deep)' }}>
                    Aspect
                  </option>
                  {availableAspects.map(aspect => (
                    <option key={aspect} value={aspect} style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}>
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
                <option value="" disabled style={{ color: 'var(--color-text-disabled)', background: 'var(--color-bg-deep)' }}>
                  Base
                </option>
                {filteredBases.map(base => (
                  <option
                    key={`${base.set}-${base.number}`}
                    value={`${base.set}-${base.number}`}
                    style={{ color: 'var(--color-text-primary)', background: 'var(--color-bg-deep)' }}
                  >
                    {base.name} — {base.hp}HP
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
                  color: 'var(--color-text-primary)',
                  border: '2px solid var(--color-text-primary)',
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

                {hyperspaceToggle}
              </div>
            )}
          </>
        )}

      </div>
    </AppScreenLayout>
  )
}

export default SwuSetupScreenView