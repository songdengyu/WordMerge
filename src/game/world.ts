export type Cell = Readonly<{ x: number; y: number }>
export type Terrain = 'grass' | 'path' | 'water' | 'rock'
export type WorldObject = Cell & Readonly<{
  id: string
  kind: 'tree' | 'boulder' | 'campfire' | 'sign' | 'shrub' | 'fruit-tree' | 'statue'
  name?: string
}>
export interface WorldChunk {
  readonly id: string
  readonly name: string
  readonly x: number
  readonly y: number
  readonly unlocked: boolean
  readonly patches: readonly (Cell & { width: number; height: number; terrain: Terrain })[]
}
export interface WorldConfig {
  readonly version: 1
  readonly dayDurationSeconds: number
  readonly initialHour: number
  readonly spawn: Cell
  readonly chunks: readonly WorldChunk[]
  readonly objects: readonly WorldObject[]
  readonly blockedEdges: readonly { from: Cell; to: Cell }[]
}
export interface RegionExtension { readonly id: string; readonly patches: WorldChunk['patches']; readonly objects: readonly WorldObject[] }

export const CHUNK_SIZE = 16
// Reuse occupied resource cells: old paths, house foundations and removed IDs stay valid.
export const FLORA_KINDS: Readonly<Record<string, 'shrub' | 'fruit-tree'>> = {
  t02: 'shrub', t07: 'shrub', t16: 'shrub', 'brook-t2': 'shrub',
  t03: 'fruit-tree', t09: 'fruit-tree', t13: 'fruit-tree', 'brook-t4': 'fruit-tree',
}
export const cellKey = ({ x, y }: Cell) => `${x},${y}`
export const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y
export const edgeKey = (a: Cell, b: Cell) => [cellKey(a), cellKey(b)].sort().join('|')

/** Static catalog. Runtime progress never lives in this map or its rendering objects. */
export class WorldMap {
  readonly config: WorldConfig
  private readonly chunks = new Map<string, WorldChunk>()
  private readonly objects = new Map<string, WorldObject>()
  private readonly configuredObjects: WorldObject[] = []
  private readonly blockedEdges = new Set<string>()

  constructor(config: WorldConfig, unlocked: readonly string[] = [], extensions: readonly RegionExtension[] = [], removed: readonly string[] = []) {
    this.config = config
    config.chunks.forEach(chunk => this.chunks.set(cellKey(chunk), { ...chunk, patches: extensions.find(e => e.id === chunk.id)?.patches ?? chunk.patches,
      unlocked: chunk.unlocked || unlocked.includes(chunk.id) }))
    this.configuredObjects = [...config.objects, ...extensions.flatMap(extension => extension.objects)]
      .map(object => object.kind === 'tree' && FLORA_KINDS[object.id] ? { ...object, kind: FLORA_KINDS[object.id] } : object)
    this.configuredObjects.filter(object => !removed.includes(object.id)).forEach(object => this.objects.set(cellKey(object), object))
    config.blockedEdges.forEach(edge => this.blockedEdges.add(edgeKey(edge.from, edge.to)))
  }

  chunkAt(cell: Cell) {
    return this.chunks.get(cellKey({ x: Math.floor(cell.x / CHUNK_SIZE), y: Math.floor(cell.y / CHUNK_SIZE) }))
  }

  objectAt(cell: Cell) { return this.objects.get(cellKey(cell)) }
  allObjects() { return [...this.objects.values()] }
  allConfiguredObjects() { return this.configuredObjects }

  terrainAt(cell: Cell): Terrain | undefined {
    const chunk = this.chunkAt(cell)
    if (!chunk) return undefined
    const x = cell.x - chunk.x * CHUNK_SIZE
    const y = cell.y - chunk.y * CHUNK_SIZE
    let terrain: Terrain = 'grass'
    for (const patch of chunk.patches) {
      if (x >= patch.x && y >= patch.y && x < patch.x + patch.width && y < patch.y + patch.height) {
        terrain = patch.terrain
      }
    }
    return terrain
  }

  isWalkable(cell: Cell) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !this.chunkAt(cell)?.unlocked) return false
    const terrain = this.terrainAt(cell)
    return terrain !== 'water' && terrain !== 'rock' && !this.objectAt(cell)
  }

  canStep(from: Cell, to: Cell) {
    return Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1
      && this.isWalkable(to) && !this.blockedEdges.has(edgeKey(from, to))
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`world.json：${message}`)
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isInteger = (v: unknown): v is number => Number.isSafeInteger(v)
const isCell = (v: unknown): v is Cell & Record<string, unknown> => isRecord(v) && isInteger(v.x) && isInteger(v.y)

export function parseWorld(value: unknown): WorldMap {
  assert(isRecord(value), '根节点必须为对象')
  assert(value.version === 1, 'version 必须为 1')
  assert(typeof value.dayDurationSeconds === 'number' && Number.isFinite(value.dayDurationSeconds)
    && value.dayDurationSeconds >= 60, 'dayDurationSeconds 必须至少为 60 秒')
  assert(typeof value.initialHour === 'number' && value.initialHour >= 0 && value.initialHour < 24, 'initialHour 超出范围')
  assert(isCell(value.spawn), 'spawn 必须是整数格坐标')
  assert(Array.isArray(value.chunks) && value.chunks.length > 0, 'chunks 不能为空')
  const ids = new Set<string>()
  const positions = new Set<string>()
  for (const [i, chunk] of value.chunks.entries()) {
    assert(isRecord(chunk) && isCell(chunk), `chunks[${i}] 坐标无效`)
    assert(typeof chunk.id === 'string' && chunk.id.length > 0 && !ids.has(chunk.id), `chunks[${i}].id 重复或为空`)
    assert(!positions.has(cellKey(chunk)), `chunks[${i}] 与其他区域重叠`)
    ids.add(chunk.id); positions.add(cellKey(chunk))
    assert(typeof chunk.name === 'string' && typeof chunk.unlocked === 'boolean', `chunks[${i}] 缺少名称或解锁状态`)
    assert(Array.isArray(chunk.patches), `chunks[${i}].patches 必须为数组`)
    for (const [j, patch] of chunk.patches.entries()) {
      assert(isRecord(patch) && isCell(patch) && isInteger(patch.width) && isInteger(patch.height), `chunks[${i}].patches[${j}] 坐标或尺寸无效`)
      assert(patch.x >= 0 && patch.y >= 0 && patch.width > 0 && patch.height > 0
        && patch.x + patch.width <= CHUNK_SIZE && patch.y + patch.height <= CHUNK_SIZE, `chunks[${i}].patches[${j}] 超出区域边界`)
      assert(['grass', 'path', 'water', 'rock'].includes(String(patch.terrain)), `chunks[${i}].patches[${j}].terrain 无效`)
    }
  }
  assert(Array.isArray(value.objects), 'objects 必须为数组')
  const objectIds = new Set<string>()
  const objectPositions = new Set<string>()
  for (const [i, object] of value.objects.entries()) {
    assert(isRecord(object) && isCell(object), `objects[${i}] 坐标无效`)
    assert(typeof object.id === 'string' && object.id.length > 0 && !objectIds.has(object.id), `objects[${i}].id 重复或为空`)
    assert(!objectPositions.has(cellKey(object)), `objects[${i}] 与其他元素重叠`)
    assert(['tree', 'boulder', 'campfire', 'sign', 'shrub', 'fruit-tree', 'statue'].includes(String(object.kind)), `objects[${i}].kind 无效`)
    assert(object.name === undefined || typeof object.name === 'string', `objects[${i}].name 必须为文本`)
    objectIds.add(object.id); objectPositions.add(cellKey(object))
  }
  assert(Array.isArray(value.blockedEdges), 'blockedEdges 必须为数组')
  for (const [i, edge] of value.blockedEdges.entries()) {
    assert(isRecord(edge) && isCell(edge.from) && isCell(edge.to)
      && Math.abs(edge.from.x - edge.to.x) + Math.abs(edge.from.y - edge.to.y) === 1, `blockedEdges[${i}] 必须连接相邻格`)
  }
  const world = new WorldMap(value as unknown as WorldConfig)
  for (const object of world.config.objects) assert(world.chunkAt(object), `元素 ${object.id} 位于未配置区域`)
  for (const edge of world.config.blockedEdges) assert(world.chunkAt(edge.from) && world.chunkAt(edge.to), '阻挡边位于未配置区域')
  assert(world.isWalkable(world.config.spawn), '出生点必须位于已解锁的可通行地面')
  return world
}

export async function loadWorld(signal: AbortSignal) {
  const response = await fetch(`${import.meta.env.BASE_URL}config/survival/world.json`, { signal })
  if (!response.ok) throw new Error(`world.json：加载失败（${response.status}）`)
  return parseWorld(await response.json())
}
