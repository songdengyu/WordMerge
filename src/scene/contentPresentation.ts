import { CHAPTERS as story, DECORATIONS as decor } from '../game/progressionConfig'
import { SHOP_PRODUCTS as products, RESOURCE_RULES as resources } from '../game/economyConfig'
export * from '../game/progressionConfig'
export * from '../game/economyConfig'

// Display aliases only: keep original identities and fingerprinted catalogs intact.
const aliases: [string, string][] = [
  ['简易木床', '休憩长椅'], ['大屋木床', '休憩长椅'], ['床铺', '长椅'], ['床', '长椅'],
  ['奶油双人沙发', '湖蓝休闲椅'], ['柔软靠垫与温暖的奶油色。', '湖蓝色软垫与轻巧藤架。'],
  ['林间书柜', '日用置物架'], ['把森林里收集的故事放进书柜。', '收纳日常用品的木质小架。'],
  ['橡木圆桌', '花园圆桌'], ['蔷薇花架', '繁花花箱'], ['盛开的蔷薇与木质花架。', '粉色鲜花盛开的木质花箱。'],
  ['午后茶点', '茶杯托盘'], ['一杯清茶与小点心，纯装饰摆件。', '整齐收放茶杯的藤编托盘。'],
  ['拼布地毯', '金纹圆毯'], ['一块母亲留下的拼布', '一块母亲留下的圆毯'],
  ['暖光提灯', '庭院立灯'], ['提灯', '庭院灯'], ['苹果树', '林间棕榈'],
  ['浆果灌木', '野花灌木'], ['林地守望雕像', '琉璃喷泉摆件'], ['旧路标', '旧留言牌'],
]
export const sceneText = (text: string) => aliases.reduce((value, [from, to]) => value.split(from).join(to), text)
export const DECORATIONS = decor.map(d => ({ ...d, name: sceneText(d.name) }))
export const SHOP_PRODUCTS = products.map(p => ({ ...p, name: sceneText(p.name), description: sceneText(p.description) }))
export const RESOURCE_RULES = Object.fromEntries(Object.entries(resources).map(([key, r]) => [key, { ...r, name: sceneText(r.name) }])) as typeof resources
export const CHAPTERS = story.map(c => ({ ...c, goal: sceneText(c.goal), hint: sceneText(c.hint),
  lines: c.lines.map(l => ({ ...l, text: sceneText(l.text) })),
  choices: c.choices.map(choice => ({ ...choice, text: sceneText(choice.text), reply: sceneText(choice.reply) })) }))
