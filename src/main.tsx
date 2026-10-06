import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './styles/global.css'

// Only load and mount the selected game: legacy effects and clocks cannot run underneath survival.
const Game = new URLSearchParams(window.location.search).get('game') === 'legacy'
  ? lazy(() => import('./App'))
  : lazy(() => import('./features/survival/SurvivalApp'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status" style={{ padding: 24 }}>正在载入营地…</div>}>
      <Game />
    </Suspense>
  </StrictMode>,
)
