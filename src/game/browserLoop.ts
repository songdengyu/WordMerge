import type { GameRuntime } from './GameRuntime'

/** One simulation driver; Pixi's ticker is presentation only. Safe to attach again in StrictMode. */
export function attachBrowserLoop(runtime: GameRuntime) {
  let frame = 0
  let attached = true
  const onFrame = (timestamp: number) => {
    if (!attached) return
    runtime.advanceFrame(timestamp)
    frame = requestAnimationFrame(onFrame)
  }
  const visibility = () => {
    runtime.syncRealTime()
    runtime.setPauseReason('background', document.hidden)
    if (document.hidden) void runtime.checkpoint()
  }
  const hide = () => { runtime.setPauseReason('page-hidden', true); void runtime.checkpoint() }
  const show = () => { runtime.syncRealTime(); runtime.setPauseReason('page-hidden', false); visibility(); runtime.resetFrameClock() }
  runtime.resetFrameClock()
  runtime.setPauseReason('page-hidden', false)
  visibility()
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pagehide', hide)
  window.addEventListener('pageshow', show)
  frame = requestAnimationFrame(onFrame)
  return () => {
    attached = false
    cancelAnimationFrame(frame)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('pagehide', hide)
    window.removeEventListener('pageshow', show)
    runtime.cancelPendingCommands()
    runtime.resetFrameClock()
  }
}
