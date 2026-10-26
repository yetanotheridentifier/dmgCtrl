import { useState, useEffect } from 'react'
import { launchCount } from '../utils/appStart'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

export interface UseInstallPromptReturn {
  showBanner: boolean
  platform: 'ios' | 'android' | null
  onInstall: () => void
  onDismiss: () => void
}

// Not now (or Install) hides the banner until this time, stored as epoch milliseconds.
const HIDDEN_UNTIL_KEY = 'install_banner_hidden_until'
const HIDE_FOR_MS = 30 * 24 * 60 * 60 * 1000

function readHiddenUntil(): number {
  try {
    return Number(localStorage.getItem(HIDDEN_UNTIL_KEY)) || 0
  } catch {
    return 0
  }
}

export function useInstallPrompt(): UseInstallPromptReturn {
  // The banner waits for the second launch, so a first visit is not met with it.
  const [eligible] = useState(() => launchCount() >= 2 && Date.now() > readHiddenUntil())
  const [dismissed, setDismissed] = useState(false)
  // `beforeinstallprompt` usually fires before React mounts, so an inline script in index.html
  // captures it on `window`. Read that in the initialiser rather than assigning it from an
  // effect: setting state synchronously on mount renders twice and, with the banner keyed off
  // this value, showed a frame without it.
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => (window as Window & { __dmgInstallPrompt?: BeforeInstallPromptEvent }).__dmgInstallPrompt ?? null,
  )

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isAndroid = /Android/.test(navigator.userAgent)

  const platform: 'ios' | 'android' | null = isIOS ? 'ios' : isAndroid ? 'android' : null

  useEffect(() => {
    const w = window as Window & { __dmgInstallPrompt?: BeforeInstallPromptEvent }

    const handler = (e: Event) => {
      e.preventDefault()
      const prompt = e as BeforeInstallPromptEvent
      w.__dmgInstallPrompt = prompt
      setDeferredPrompt(prompt)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const showBanner = eligible && !isStandalone && !dismissed && (isIOS || (isAndroid && deferredPrompt !== null))

  const hide = () => {
    try {
      localStorage.setItem(HIDDEN_UNTIL_KEY, String(Date.now() + HIDE_FOR_MS))
    } catch {
      // Storage refused: hidden for this launch only.
    }
    setDismissed(true)
  }

  const onInstall = () => {
    if (!deferredPrompt) return
    void deferredPrompt.prompt()
    delete (window as Window & { __dmgInstallPrompt?: BeforeInstallPromptEvent }).__dmgInstallPrompt
    hide()
    setDeferredPrompt(null)
  }

  return { showBanner, platform, onInstall, onDismiss: hide }
}
