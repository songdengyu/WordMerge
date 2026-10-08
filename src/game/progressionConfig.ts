import { fingerprint } from './productionConfig'
import type { RegionExtension } from './world'

// First-chapter prototype content. Choice IDs and reward ownership are persistent.
export const OUTFITS = [
  { id: 'clay', name: '初来时的衣裳', color: 0xc77b64 },
  { id: 'sage', name: '鼠尾草围裙', color: 0x789977 },
  { id: 'rose', name: '蔷薇旧衫', color: 0xb87991 },
  { id: 'meadow', name: '晴日园丁', color: 0xd8b75f },
  { id: 'rain', name: '雨后漫步', color: 0x659bb4 },
  { id: 'starlight', name: '星月长裙', color: 0x9890c1 },
] as const
export const DECORATIONS = [
  { id: 'rug', name: '拼布地毯', symbol: '▧', color: '#bd927d' },
  { id: 'planter', name: '野花盆栽', symbol: '✿', color: '#9ba877' },
  { id: 'lantern', name: '暖光提灯', symbol: '✧', color: '#c5a262' },
  { id: 'chair', name: '藤编单椅', symbol: '♧', color: '#b99664' },
  { id: 'table', name: '橡木圆桌', symbol: '◉', color: '#a77c54' },
  { id: 'sofa', name: '奶油双人沙发', symbol: '▰', color: '#d5bda5' },
  { id: 'bookshelf', name: '林间书柜', symbol: '▤', color: '#957958' },
  { id: 'tea-set', name: '午后茶点', symbol: '☕', color: '#97b1ab' },
  { id: 'flowerstand', name: '蔷薇花架', symbol: '❀', color: '#b77b8d' },
] as const
export type DecorId = typeof DECORATIONS[number]['id']
export const REGIONS = [
  { id: 'brook', name: '溪谷深处', xp: 30, point: { x: 7, y: -5 }, landmark: '溪边的行李' },
  { id: 'grove', name: '静谧林地', xp: 70, point: { x: 21, y: 8 }, landmark: '树下的信匣' },
] as const
// Extension layers keep the original M1–M4 map fingerprint stable for explicit migrations.
export const REGION_EXTENSIONS: readonly RegionExtension[] = [
  { id: 'brook', patches: [
    { x: 6, y: 8, width: 3, height: 8, terrain: 'path' },
    { x: 10, y: 3, width: 3, height: 10, terrain: 'water' },
    { x: 9, y: 8, width: 5, height: 3, terrain: 'water' },
  ], objects: [
    { id: 'brook-t1', kind: 'tree', x: 2, y: -12 }, { id: 'brook-t2', kind: 'tree', x: 4, y: -9 },
    { id: 'brook-t3', kind: 'tree', x: 10, y: -14 }, { id: 'brook-t4', kind: 'tree', x: 13, y: -2 },
    { id: 'brook-t5', kind: 'tree', x: 1, y: -4 }, { id: 'brook-t6', kind: 'tree', x: 3, y: -5 },
  ] },
  { id: 'grove', patches: [{ x: 0, y: 7, width: 8, height: 3, terrain: 'path' }], objects: [
    { id: 'grove-tree', kind: 'tree', name: '信匣旁的老树', x: 21, y: 6 },
    { id: 'grove-t1', kind: 'tree', x: 19, y: 3 }, { id: 'grove-t2', kind: 'tree', x: 23, y: 4 },
    { id: 'grove-t3', kind: 'tree', x: 25, y: 10 }, { id: 'grove-t4', kind: 'tree', x: 29, y: 9 },
    { id: 'grove-t5', kind: 'tree', x: 22, y: 12 },
  ] },
]
export type StoryCondition = 'always' | 'foundation' | 'companion' | 'brook' | 'cabin' | 'grove' | 'dawn'
export interface StoryChapter {
  id: string; title: string; goal: string; hint: string; condition: StoryCondition
  action: 'build' | 'care' | 'brook' | 'grove' | 'dress' | 'story'
  requirements: number[]; rewardItems: number[]; decor?: DecorId; outfit?: string
  lines: { speaker: string; text: string }[]
  choices: { id: string; text: string; reply: string }[]
}
export const CHAPTERS: readonly StoryChapter[] = [
  { id: 'letter', title: '一封迟来的信', goal: '读一读母亲留下的信', action: 'story', condition: 'always', requirements: [], rewardItems: [],
    hint: '从这封信开始，逐步学会合成、建造与照护。自由探索不会丢失主线进度。',
    lines: [{ speaker: '你', text: '母亲离开三年后，我收到一封没有寄件人的信。里面只有营地的钥匙，和一句话：“别让这里再荒下去。”' },
      { speaker: '旧信', text: '“如果你回来了，先给自己找个能睡安稳的地方。木料箱还在，旧木枝能拼出新的家。”' },
      { speaker: '你', text: '路还通着，手机也有一点信号。我可以随时离开。但我想先弄清楚，是谁替她寄出了这封信。' }],
    choices: [{ id: 'home', text: '先把这里变成家', reply: '先铺好第一块木地基。那些没说出口的话，可以慢慢找。' }, { id: 'truth', text: '我要找到寄信的人', reply: '我记下信封上的水痕。不过，查清往事之前，也得照顾好自己。' }] },
  { id: 'foundation', title: '第一块木地板', goal: '建成一块木地基', action: 'build', condition: 'foundation', requirements: [], rewardItems: [], decor: 'rug',
    hint: '在合成工坊把两根木枝拖到一起，得到木板。放置木屋图纸后，点击绿色材料气泡建造；到达后施工 2 秒。',
    lines: [{ speaker: '你', text: '新的木地板接住了第一缕阳光。工具箱底下，压着一块母亲留下的拼布。' },
      { speaker: '手记', text: '“家不用一次造好。门墙挡住夜里的动静，屋顶挡雨，床让你缓一缓。先做最需要的那一件。”' }],
    choices: [{ id: 'keep', text: '把拼布留下来装饰', reply: '获得拼布地毯。可以在营地手记的“装扮”里摆到已建成的地板上。' }] },
  { id: 'friend', title: '第一个愿意留下的朋友', goal: '白天用野餐餐盒救助栗栗', action: 'care', condition: 'companion', requirements: [], rewardItems: [], outfit: 'sage',
    hint: '点击小犬头顶的材料气泡，准备一份 3 级野餐餐盒。食材篮产出的野莓合成果酱，再合成餐盒；加入后可跟随或驻守。',
    lines: [{ speaker: '你', text: '小犬小心地吃起餐盒里的食物，尾巴终于摇了起来。它的项圈里侧，绣着“栗栗”。' },
      { speaker: '你', text: '它把我带到一件旧围裙旁。口袋里是一张溪谷草图——有人最近沿着那条路来过。' }],
    choices: [{ id: 'together', text: '以后，我们一起守家', reply: '栗栗贴近了你的手。获得鼠尾草围裙；建筑经验达到 30 后，点击营地北侧指示牌可以开放溪谷。' }] },
  { id: 'visitor', title: '溪谷的来客', goal: '找到溪边行李，准备果酱与一壶饮水', action: 'brook', condition: 'brook', requirements: [212, 222], rewardItems: [102], decor: 'planter',
    hint: '建筑经验达到 30，点击营地北侧指示牌，角色到达后用 2 秒开放溪谷。进入溪谷寻找行李；两份野莓合成果酱，两杯饮水合成一壶。',
    lines: [{ speaker: '林岚', text: '“你和她年轻时很像。”来客看了看你手里的钥匙，又移开了目光。“我只是来取回以前落下的东西。”' },
      { speaker: '你', text: '她的鞋还滴着水，行李里却整齐收着一封写给母亲的旧信。我递过去果酱和饮水。' },
      { speaker: '林岚', text: '“谢谢。你母亲说过，这里不问人为什么来，只问愿不愿意好好留下。我会修工具，能帮你把旧工作台收拾好。”' }],
    choices: [{ id: 'welcome', text: '留下吃饭吧，过去慢慢说', reply: '林岚松了口气，决定暂住营地。她答应，等你安顿好，就一起去找树下的信匣。' },
      { id: 'ask', text: '你认识母亲，也认识寄信的人？', reply: '林岚停了一会儿：“认识。但那封信不是我寄的。”她愿意留下，带你查清这件事。' }] },
  { id: 'shelter', title: '灯亮起来的地方', goal: '完成木屋的地基、墙、门、屋顶与床', action: 'build', condition: 'cabin', requirements: [], rewardItems: [], decor: 'lantern',
    hint: '继续点击地图上的材料气泡。门墙承伤，屋顶保温，床铺休养；夜里合成时世界仍会继续，记得让栗栗驻守。',
    lines: [{ speaker: '林岚', text: '屋里有了床，门也能合上。林岚从行李中拿出一盏提灯：“这是你母亲修过的。她总给晚归的人留一盏。”' },
      { speaker: '你', text: '灯下，溪谷草图背面浮出一句铅笔字：“没寄出的信，在老树下。”' }],
    choices: [{ id: 'light', text: '明天去看看，今晚先守好家', reply: '获得暖光提灯。建设经验达到 70 后，可开放静谧林地，寻找那只信匣。' }] },
  { id: 'grove', title: '没有署名的约定', goal: '开放静谧林地，走到树下信匣旁', action: 'grove', condition: 'grove', requirements: [], rewardItems: [], outfit: 'rose',
    hint: '建筑经验达到 70，点击营地东侧指示牌，角色到达后用 2 秒开放静谧林地。拖动地图，点击空地前往树下信匣，开放后的地块也可以建设。',
    lines: [{ speaker: '旧信', text: '“她会回来的。到时候，不要替我决定她该不该知道。让她自己选。”落款被雨水洇开了。' },
      { speaker: '林岚', text: '“她说的‘她’，也许就是你。”林岚把包着信匣的蔷薇色旧衫递给你，却没有解释另一个人的身份。' },
      { speaker: '你', text: '我把信收好。这里藏着一个约定，也开始有了我的生活。我决定留下，慢慢找出答案。' }],
    choices: [{ id: 'promise', text: '留下来，把故事继续下去', reply: '获得蔷薇旧衫。给木屋添一件摆件，再和大家一起迎接清晨吧。' }] },
  { id: 'dawn', title: '我们的第一个清晨', goal: '摆放一件装饰，并平安度过一次完整夜晚', action: 'dress', condition: 'dawn', requirements: [], rewardItems: [],
    hint: '装扮里选择摆件，轻点木屋地板放置。备好饮食、安排守卫，在线自然抵达 06:00；救援跳到清晨不计入守夜。',
    lines: [{ speaker: '你', text: '晨光落在新铺的木地板上，栗栗睡在一旁，林岚把水壶放上桌。昨晚那些陌生的声音，终于退回森林。' },
      { speaker: '林岚', text: '“今天想先做什么？”她这次没有提起过去。' },
      { speaker: '你', text: '这里不再只是母亲留下的地方。它也是我们正在一起建造的家。至于寄信的人——我会找到。' }],
    choices: [{ id: 'stay', text: '先好好过今天', reply: '首章试玩完成。继续建设、照护与装扮；寄信人的故事将在后续章节继续。' }] },
]
export const PROGRESSION_VERSION = fingerprint(JSON.stringify([CHAPTERS, REGIONS, REGION_EXTENSIONS, OUTFITS, DECORATIONS]))
// Exact prior M5 catalog: map-tab unlocks, two regions, same story/reward IDs.
export const MAP_TAB_PROGRESSION_VERSION = '7a73e35c'
export const PRE_MEAL_PROGRESSION_VERSION = 'd3dd46d6'
