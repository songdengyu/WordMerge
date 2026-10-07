import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { fingerprint, type ProductionCatalog } from './productionConfig'
import { configVersion, SaveError, validateSave, type RuntimeData, type SaveEnvelope } from './saveData'
import type { WorldMap } from './world'

interface SaveDatabase extends DBSchema { snapshots: { key: string; value: unknown } }
export const DATABASE_NAME = 'wordmerge-survival'

async function openSaveDatabase() {
  const db = await openDB<SaveDatabase>(DATABASE_NAME, 1, {
    upgrade(db) { db.createObjectStore('snapshots') },
    blocking() { db.close() },
  })
  return db
}

/** Explicit reset only: erase progress and backups atomically, invalidate older open tabs. */
export async function clearGameData() {
  const db = await openSaveDatabase()
  try {
    const tx = db.transaction('snapshots', 'readwrite')
    try {
      await tx.store.clear()
      // This contains no progress. Revisions alone can repeat after starting a new game.
      await tx.store.put(Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'), 'generation')
      await tx.done
    } catch (error) {
      try { tx.abort() } catch { /* Already aborted. */ }
      await tx.done.catch(() => {})
      throw error
    }
  } finally { db.close() }
}

/** User-authorized reset for the noon-start release; never erase a new noon save on reload. */
export async function clearMorningStartSave(world: WorldMap) {
  if (world.config.initialHour !== 12) return false
  const morningVersion = fingerprint(JSON.stringify({ ...world.config, initialHour: 6 }))
  const db = await openSaveDatabase()
  try {
    const tx = db.transaction('snapshots', 'readwrite')
    try {
      const current = await tx.store.get('current') ?? await tx.store.get('previous')
      const version = current && typeof current === 'object' && 'configVersion' in current ? current.configVersion : null
      const reset = typeof version === 'string' && version.split('-')[1] === morningVersion
      if (reset) {
        await tx.store.clear()
        await tx.store.put(Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'), 'generation')
      }
      await tx.done
      return reset
    } catch (error) {
      try { tx.abort() } catch { /* Already aborted. */ }
      await tx.done.catch(() => {})
      throw error
    }
  } finally { db.close() }
}

/** One serialized queue per connection + a cross-tab compare-and-swap in each IDB transaction. */
export class SaveRepository {
  private revision = 0
  private generation: unknown = undefined
  private lastGood: SaveEnvelope | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private failure: unknown = null
  private constructor(private readonly db: IDBPDatabase<SaveDatabase>, private readonly version: string) {}

  static async open(world: WorldMap, catalog: ProductionCatalog) {
    const db = await openSaveDatabase()
    return new SaveRepository(db, configVersion(world, catalog))
  }

  async inspect() {
    const tx = this.db.transaction('snapshots', 'readonly')
    const [current, previous, revision, generation] = await Promise.all([
      tx.store.get('current'), tx.store.get('previous'), tx.store.get('revision'), tx.store.get('generation'),
    ])
    await tx.done
    if (revision !== undefined && (!Number.isSafeInteger(revision) || Number(revision) < 0)) throw new SaveError('存档版本序号损坏，未覆盖原数据', 'invalid', { current, previous, revision })
    this.revision = Number(revision ?? 0)
    this.generation = generation
    if (current === undefined && previous === undefined && this.revision !== 0) throw new SaveError('存档记录缺失，未创建新进度', 'invalid', { current, previous, revision })
    return { current, previous, revision: this.revision }
  }

  async load(world: WorldMap, catalog: ProductionCatalog): Promise<{ saved: SaveEnvelope | null; notice: string | null }> {
    const raw = await this.inspect()
    if (raw.current === undefined && raw.previous === undefined) return { saved: null, notice: null }
    try {
      const saved = validateSave(raw.current, world, catalog)
      if (saved.revision !== this.revision) throw new SaveError('当前存档版本序号不一致')
      this.lastGood = saved
      return { saved, notice: (raw.current as { schemaVersion?: number }).schemaVersion === 1 ? '已升级营地存档，原有物资与进度已保留。木屋图纸与昼夜生存已开启。'
        : (raw.current as { schemaVersion?: number }).schemaVersion === 2 ? '已开启昼夜生存，原有营地与物资已保留。建造时长已更新为 2 秒。'
        : (raw.current as { schemaVersion?: number }).schemaVersion === 3 ? '营地手记已开启，原有物资、建筑与守卫进度已保留。' : null }
    } catch (error) {
      // Unknown future versions/configs are not "corruption" and must never roll back silently.
      if (error instanceof SaveError && error.kind === 'incompatible') throw new SaveError(error.message, error.kind, raw)
      try {
        const previous = validateSave(raw.previous, world, catalog)
        if (previous.revision >= this.revision) throw new SaveError('备份序号无效')
        this.lastGood = previous
        return { saved: previous, notice: '当前进度无法读取，已恢复上一份有效备份。' }
      } catch {
        throw new SaveError('当前存档和备份均无法恢复，原数据已保留。可导出故障数据或导入之前的备份。', 'invalid', raw)
      }
    }
  }

  save(data: RuntimeData, now = Date.now()): Promise<SaveEnvelope> {
    const copy = structuredClone(data)
    const task = this.tail.then(async () => {
      if (this.failure) throw this.failure
      const tx = this.db.transaction('snapshots', 'readwrite')
      try {
        const actual = Number(await tx.store.get('revision') ?? 0)
        const generation = await tx.store.get('generation')
        if (actual !== this.revision || generation !== this.generation) {
          throw new SaveError('另一页面更新或清除了营地。为避免覆盖进度，本页已暂停；请关闭多余页面后重新载入。', 'conflict')
        }
        const saved: SaveEnvelope = { schemaVersion: 4, configVersion: this.version,
          revision: this.revision + 1, savedAt: now, data: copy }
        if (this.lastGood) await tx.store.put(this.lastGood, 'previous')
        await tx.store.put(saved, 'current')
        await tx.store.put(saved.revision, 'revision')
        await tx.done
        this.revision = saved.revision
        this.lastGood = saved
        return structuredClone(saved)
      } catch (error) {
        // Synchronous clone/quota failures must abort earlier writes too, not leave a partial backup.
        try { tx.abort() } catch { /* Transaction may already have aborted. */ }
        await tx.done.catch(() => {})
        throw error
      }
    }).catch((error: unknown) => { this.failure = error; throw error })
    this.tail = task.catch(() => {})
    return task
  }
  retry() { if (!(this.failure instanceof SaveError && this.failure.kind === 'conflict')) this.failure = null }
  async close() { await this.tail; this.db.close() }
}
