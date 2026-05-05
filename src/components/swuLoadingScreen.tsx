import { useEffect } from 'react'
import AppScreenLayout from './layout/AppScreenLayout'

interface Props {
  loading: boolean
  onReady: () => void
}

function SwuLoadingScreen({ loading, onReady }: Props) {
  useEffect(() => {
    if (!loading) onReady()
  }, [loading, onReady])

  return (
    <AppScreenLayout>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2rem',
        zIndex: 1,
      }}>
        <img
          src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`}
          alt="dmgCtrl"
          style={{
            width: 'clamp(64px, 15vmin, 120px)',
            height: 'clamp(64px, 15vmin, 120px)',
          }}
        />
        <p style={{
          color: 'var(--color-accent)',
          fontWeight: '300',
          fontSize: 'clamp(0.8rem, 3vmin, 1.2rem)',
          letterSpacing: '0.4em',
          margin: 0,
          textTransform: 'uppercase',
        }}>
          LOADING
        </p>
      </div>
    </AppScreenLayout>
  )
}

export default SwuLoadingScreen
