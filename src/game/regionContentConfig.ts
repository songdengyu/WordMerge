import { BLUEPRINTS } from './buildingConfig'
import { fingerprint } from './productionConfig'
import type { Cell } from './world'

export const REGION_BOARS = [
  { id: 'brook-boar-1', regionId: 'brook', cell: { x: 4, y: -12 } },
  { id: 'brook-boar-2', regionId: 'brook', cell: { x: 7, y: -10 } },
  { id: 'brook-boar-3', regionId: 'brook', cell: { x: 3, y: -7 } },
] as const
export const REGION_LODGE = { regionId: 'grove', blueprintId: 'lodge', origin: { x: 25, y: 3 } } as const
export const BOAR_AGGRO_RANGE = 3
export const GROVE_STATUE_ID = 'grove-statue'
export const REGION_CONTENT_VERSION = fingerprint(JSON.stringify([REGION_BOARS, REGION_LODGE, BOAR_AGGRO_RANGE, BLUEPRINTS.filter(b => b.fixedRegion), 'built-foundation-and-statue-v1']))
export interface RegionContentState { version: string; initialized: string[]; statue?: Cell | null }
export const createRegionContent = (): RegionContentState => ({ version: REGION_CONTENT_VERSION, initialized: [], statue: null })
