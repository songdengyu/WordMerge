import { fingerprint } from './productionConfig'
import { FLORA_KINDS, type WorldObject } from './world'
import { BLUEPRINTS } from './buildingConfig'

export const CLEAR_SECONDS = 2
export const TOOL_CHAINS = [[252, 253, 254], [262, 263, 264]] as const
export const toolMeets = (itemId: number, required: number) => itemId === required || TOOL_CHAINS.some(chain =>
  (chain as readonly number[]).includes(required) && (chain as readonly number[]).indexOf(itemId) >= (chain as readonly number[]).indexOf(required))
export const RESOURCE_RULES: Record<WorldObject['kind'], { name: string; tool: number; gold: number; gems: number; items: number[] }> = {
  tree: { name: '树木', tool: 252, gold: 25, gems: 1, items: [203] },
  boulder: { name: '石头', tool: 262, gold: 40, gems: 2, items: [203, 232] },
  campfire: { name: '废弃营火', tool: 262, gold: 20, gems: 1, items: [203] },
  sign: { name: '旧路标', tool: 252, gold: 15, gems: 1, items: [202] },
  shrub: { name: '浆果灌木', tool: 252, gold: 25, gems: 1, items: [203] },
  'fruit-tree': { name: '苹果树', tool: 252, gold: 25, gems: 1, items: [203] },
  statue: { name: '林地守望雕像', tool: 264, gold: 0, gems: 30, items: [] },
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
  { id: 'meadow-blueprint', name: '苔原草顶屋图纸', category: 'blueprint', currency: 'gold', price: 100, reward: 'meadow-hut', description: '简朴 · 3×2。草编屋顶与原木墙，主要使用三级木料。' },
  { id: 'cedar-blueprint', name: '暖杉小筑图纸', category: 'blueprint', currency: 'gold', price: 280, reward: 'cedar-home', description: '温馨 · 4×3。木板地面与青绿瓦顶，主要使用四级精选木材。' },
  { id: 'manor-blueprint', name: '蔷薇庄园图纸', category: 'blueprint', currency: 'gems', price: 40, reward: 'rose-manor', description: '精致 · 5×4。砖石外墙与紫色瓦顶，主要使用六级精工建材。' },
  { id: 'corner-blueprint', name: '森语转角屋图纸', category: 'blueprint', currency: 'gold', price: 320, reward: 'forest-corner', description: '温馨 · L 形 12 格。青绿屋顶与转角花窗，使用四级精选木材。' },
  { id: 'court-blueprint', name: '花庭小院图纸', category: 'blueprint', currency: 'gems', price: 45, reward: 'flower-court', description: '精致 · 凹形 18 格。环抱入口的小院，使用六级精工建材。' },
  { id: 'chair', name: '藤编单椅', category: 'decor', currency: 'gold', price: 45, reward: 'chair', description: '可重复购买，放在屋内地板上。' },
  { id: 'table', name: '橡木圆桌', category: 'decor', currency: 'gold', price: 75, reward: 'table', description: '为午后的闲聊留一张小桌。' },
  { id: 'sofa', name: '奶油双人沙发', category: 'decor', currency: 'gold', price: 160, reward: 'sofa', description: '柔软靠垫与温暖的奶油色。' },
  { id: 'bookshelf', name: '林间书柜', category: 'decor', currency: 'gold', price: 130, reward: 'bookshelf', description: '把森林里收集的故事放进书柜。' },
  { id: 'tea-set', name: '午后茶点', category: 'decor', currency: 'gold', price: 85, reward: 'tea-set', description: '一杯清茶与小点心，纯装饰摆件。' },
  { id: 'flowerstand', name: '蔷薇花架', category: 'decor', currency: 'gems', price: 10, reward: 'flowerstand', description: '盛开的蔷薇与木质花架。' },
  { id: 'meadow', name: '晴日园丁', category: 'outfit', currency: 'gold', price: 180, reward: 'meadow', description: '麦黄色围裙与草帽。' },
  { id: 'rain', name: '雨后漫步', category: 'outfit', currency: 'gold', price: 220, reward: 'rain', description: '蓝色斗篷与轻巧兜帽。' },
  { id: 'starlight', name: '星月长裙', category: 'outfit', currency: 'gems', price: 18, reward: 'starlight', description: '淡紫裙摆与星月发饰。' },
]
export const ECONOMY_VERSION = fingerprint(JSON.stringify([RESOURCE_RULES, SHOP_PRODUCTS, CLEAR_SECONDS,
  BLUEPRINTS.filter(b => SHOP_PRODUCTS.some(p => p.category === 'blueprint' && p.reward === b.id)), FLORA_KINDS, TOOL_CHAINS]))
export const PRE_SHAPES_PRODUCTS = SHOP_PRODUCTS.filter(p => p.id !== 'corner-blueprint' && p.id !== 'court-blueprint')
// Frozen predecessor fingerprint: future catalog edits must not silently change accepted history.
export const PRE_SHAPES_ECONOMY_VERSION = '5723f3b5'
