import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { UserSettingsProvider } from './hooks/useUserSettings'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UserSettingsProvider><App /></UserSettingsProvider>
  </StrictMode>,
)
