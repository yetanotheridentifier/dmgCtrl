import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { applyFavicon } from './favicon'

// White dmgCtrl icon under the dev server, blue in prod — makes the dev tab
// easy to spot next to the live site.
applyFavicon(import.meta.env.DEV, import.meta.env.BASE_URL)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
