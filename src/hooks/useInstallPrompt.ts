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
    // Pick up the event if it fired before this hook mounted (captured in index.html inline script)
    const w = window as Window & { __dmgInstallPrompt?: BeforeInstallPromptEvent }
    if (w.__dmgInstallPrompt) {
      setDeferredPrompt(w.__dmgInstallPrompt)
    }

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
