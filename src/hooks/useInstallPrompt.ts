import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

export interface UseInstallPromptReturn {
  showBanner: boolean
  platform: 'ios' | 'android' | null
  onInstall: () => void
  onDismiss: () => void
}

export function useInstallPrompt(): UseInstallPromptReturn {
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem('install_banner_dismissed') === '1'
  )
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

  const showBanner = !isStandalone && !dismissed && (isIOS || (isAndroid && deferredPrompt !== null))

  const onInstall = () => {
    if (!deferredPrompt) return
    void deferredPrompt.prompt()
    delete (window as Window & { __dmgInstallPrompt?: BeforeInstallPromptEvent }).__dmgInstallPrompt
    sessionStorage.setItem('install_banner_dismissed', '1')
    setDismissed(true)
    setDeferredPrompt(null)
  }

  const onDismiss = () => {
    sessionStorage.setItem('install_banner_dismissed', '1')
    setDismissed(true)
  }

  return { showBanner, platform, onInstall, onDismiss }
}
