import { fingerprint } from './productionConfig'
import type { WorldObject } from './world'
import { BLUEPRINTS } from './buildingConfig'

export const CLEAR_SECONDS = 2
export const RESOURCE_RULES: Record<WorldObject['kind'], { name: string; tool: number; gold: number; gems: number; items: number[] }> = {
  tree: { name: '树木', tool: 252, gold: 25, gems: 1, items: [203] },
  boulder: { name: '石头', tool: 262, gold: 40, gems: 2, items: [203, 232] },
  campfire: { name: '废弃营火', tool: 262, gold: 20, gems: 1, items: [203] },
  sign: { name: '旧路标', tool: 252, gold: 15, gems: 1, items: [202] },
}
export interface ShopProduct {
  id: string; name: string; category: 'tools' | 'blueprint' | 'decor' | 'outfit'
  currency: 'gold' | 'gems'; price: number; reward: string; description: string
}
export const SHOP_PRODUCTS: readonly ShopProduct[] = [
  { id: 'starter-tools', name: '工具箱', category: 'tools', currency: 'gold', price: 0, reward: '141', description: '免费领取一次。生产工具零件，二合制作斧头与石镐。' },
  { id: 'garden-blueprint', name: '花园木屋图纸', category: 'blueprint', currency: 'gold', price: 150, reward: 'garden-cabin', description: '3×2 木屋图纸，可重复放置；建造仍需材料。' },
  { id: 'guest-blueprint', name: '林间客舍图纸', category: 'blueprint', currency: 'gems', price: 20, reward: 'guest-cabin', description: '5×4 客舍图纸，可重复放置；建造仍需材料。' },
  { id: 'rug', name: '拼布地毯', category: 'decor', currency: 'gold', price: 60, reward: 'rug', description: '摆放在已建好的地板上。' },
  { id: 'planter', name: '野花盆栽', category: 'decor', currency: 'gold', price: 80, reward: 'planter', description: '给营地添一抹花色。' },
  { id: 'lantern', name: '暖光提灯', category: 'decor', currency: 'gems', price: 8, reward: 'lantern', description: '营地装饰提灯。' },
  { id: 'sage', name: '鼠尾草围裙', category: 'outfit', currency: 'gold', price: 120, reward: 'sage', description: '购买后可在装扮中换上。' },
  { id: 'rose', name: '蔷薇旧衫', category: 'outfit', currency: 'gems', price: 12, reward: 'rose', description: '购买后可在装扮中换上。' },
]
export const ECONOMY_VERSION = fingerprint(JSON.stringify([RESOURCE_RULES, SHOP_PRODUCTS, CLEAR_SECONDS,
  BLUEPRINTS.filter(b => SHOP_PRODUCTS.some(p => p.category === 'blueprint' && p.reward === b.id))]))
