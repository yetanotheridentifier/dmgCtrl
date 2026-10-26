import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { UserSettingsProvider } from './hooks/useUserSettings'
import { recordLaunch } from './utils/appStart'

// Once per start of the app, outside React so StrictMode's double render cannot count it twice.
recordLaunch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UserSettingsProvider><App /></UserSettingsProvider>
  </StrictMode>,
)
