import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted (no external font CDN) — matches the project's "bundle it
// locally" approach already used for the detection models.
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-sans/700.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
