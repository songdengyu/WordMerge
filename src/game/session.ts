import { GameRuntime } from './GameRuntime'
import { SaveRepository } from './persistence'
import { loadProductionConfig } from './productionConfig'
import { parseSaveFile } from './saveData'
import { syncStamina } from './stamina'
import { loadWorld } from './world'
import { validateBuildingCatalog } from './buildingConfig'
import { validateProgressionCatalog } from './progression'

export async function loadGameSession(signal: AbortSignal) {
  const [world, catalog] = await Promise.all([loadWorld(signal), loadProductionConfig(signal)])
  validateBuildingCatalog(catalog)
  validateProgressionCatalog(world, catalog)
  signal.throwIfAborted()
  const repository = await SaveRepository.open(world, catalog)
  try {
    const { saved, notice } = await repository.load(world, catalog)
    signal.throwIfAborted()
    return { runtime: new GameRuntime(world, { catalog, saved, repository }), notice }
  } catch (error) { await repository.close(); throw error }
}

/** Explicit user-selected restore when boot cannot read the current save. */
export async function recoverFromFile(text: string) {
  const signal = new AbortController().signal
  const [world, catalog] = await Promise.all([loadWorld(signal), loadProductionConfig(signal)])
  validateBuildingCatalog(catalog)
  validateProgressionCatalog(world, catalog)
  const saved = parseSaveFile(text, world, catalog)
  const repository = await SaveRepository.open(world, catalog)
  try {
    // A corrupt payload does not prevent an explicit import; the revision check still protects other tabs.
    await repository.inspect()
    try { await repository.load(world, catalog) } catch { /* Keep the original records until the import commits. */ }
    saved.data.production.stamina = syncStamina(saved.data.production.stamina, Date.now())
    await repository.save(saved.data)
  } finally { await repository.close() }
}

export function downloadJson(text: string, name = 'wordmerge-backup') {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
