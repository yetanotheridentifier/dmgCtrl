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
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isAndroid = /Android/.test(navigator.userAgent)

  const platform: 'ios' | 'android' | null = isIOS ? 'ios' : isAndroid ? 'android' : null

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const showBanner = !isStandalone && !dismissed && (isIOS || (isAndroid && deferredPrompt !== null))

  const onInstall = () => {
    if (!deferredPrompt) return
    void deferredPrompt.prompt()
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
