export interface StaminaClock { value: number; anchorMs: number; remainderMs: number }
export const STAMINA_CAP = 100
export const STAMINA_INTERVAL_MS = 10_000

export function syncStamina(clock: StaminaClock, now: number): StaminaClock {
  if (now < clock.anchorMs) return { ...clock, anchorMs: now, remainderMs: 0 }
  if (clock.value >= STAMINA_CAP) return { value: clock.value, anchorMs: now, remainderMs: 0 }
  const elapsed = clock.remainderMs + now - clock.anchorMs
  const value = Math.min(STAMINA_CAP, clock.value + Math.floor(elapsed / STAMINA_INTERVAL_MS))
  return { value, anchorMs: now, remainderMs: value === STAMINA_CAP ? 0 : elapsed % STAMINA_INTERVAL_MS }
}
export function spendStamina(clock: StaminaClock, amount: number, now: number): StaminaClock | null {
  const synced = syncStamina(clock, now)
  if (synced.value < amount) return null
  return { ...synced, value: synced.value - amount }
}
export function addStamina(clock: StaminaClock, amount: number, now: number): StaminaClock {
  const synced = syncStamina(clock, now)
  const value = synced.value + amount
  return { ...synced, value, remainderMs: value >= STAMINA_CAP ? 0 : synced.remainderMs }
}
