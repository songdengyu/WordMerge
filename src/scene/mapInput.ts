import { type Camera, type Point, worldToGrid } from './camera'
import type { Cell } from '../game/world'

type Pointer = { start: Point; last: Point }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function attachMapInput(canvas: HTMLCanvasElement, camera: Camera, onTap: (cell: Cell) => void) {
  const pointers = new Map<number, Pointer>()
  let suppressTap = false
  const local = (event: PointerEvent | WheelEvent): Point => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    if (!pointers.size) suppressTap = false
    const point = local(event)
    pointers.set(event.pointerId, { start: point, last: point })
    if (pointers.size > 1) suppressTap = true
    canvas.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    const pointer = pointers.get(event.pointerId)
    if (!pointer) return
    event.preventDefault()
    const point = local(event)
    if (pointers.size === 1) {
      if (distance(pointer.start, point) > 8) suppressTap = true
      if (suppressTap) camera.pan(point.x - pointer.last.x, point.y - pointer.last.y)
      pointer.last = point
    } else {
      const pair = [...pointers.values()].slice(0, 2)
      const oldCenter = midpoint(pair[0].last, pair[1].last)
      const oldDistance = distance(pair[0].last, pair[1].last)
      pointer.last = point
      const center = midpoint(pair[0].last, pair[1].last)
      const newDistance = distance(pair[0].last, pair[1].last)
      if (oldDistance > 2) camera.zoomAt(camera.zoom * newDistance / oldDistance, oldCenter)
      camera.pan(center.x - oldCenter.x, center.y - oldCenter.y)
    }
  }
  const finish = (event: PointerEvent, cancelled: boolean) => {
    const pointer = pointers.get(event.pointerId)
    if (!pointer) return
    pointers.delete(event.pointerId)
    const point = local(event)
    if (cancelled) suppressTap = true
    if (!cancelled && !suppressTap && pointers.size === 0 && distance(pointer.start, point) <= 8) {
      onTap(worldToGrid(camera.toWorld(point)))
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    if (!pointers.size) suppressTap = false
  }
  const up = (event: PointerEvent) => finish(event, false)
  const cancel = (event: PointerEvent) => finish(event, true)
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    camera.zoomAt(camera.zoom * Math.exp(-event.deltaY * 0.0015), local(event))
  }
  const context = (event: Event) => event.preventDefault()
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', cancel)
  canvas.addEventListener('lostpointercapture', cancel)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('contextmenu', context)
  return () => {
    const captured = [...pointers.keys()]
    pointers.clear()
    captured.forEach(id => { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id) })
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', cancel)
    canvas.removeEventListener('lostpointercapture', cancel)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('contextmenu', context)
  }
}
