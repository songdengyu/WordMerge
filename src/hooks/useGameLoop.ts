import { useEffect } from 'react'
import { useGameStore } from '../store/useGameStore'

const TICK_MS = 100

export function useGameLoop() {
  const { state, tick, clearToast, clearHit, clearGoldFlash } = useGameStore()

  useEffect(() => {
    const interval = setInterval(() => {
      tick(TICK_MS / 1000)
    }, TICK_MS)
    return () => clearInterval(interval)
  }, [tick])

  useEffect(() => {
    if (!state.monsterHit) return
    const t = setTimeout(clearHit, 220)
    return () => clearTimeout(t)
  }, [state.monsterHit, clearHit])

  useEffect(() => {
    if (!state.goldFlash) return
    const t = setTimeout(clearGoldFlash, 300)
    return () => clearTimeout(t)
  }, [state.goldFlash, clearGoldFlash])

  useEffect(() => {
    if (!state.toast) return
    const t = setTimeout(clearToast, 2000)
    return () => clearTimeout(t)
  }, [state.toast, clearToast])
}
