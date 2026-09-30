# 工程与配置说明

## 新游戏模块（M1–M3）

入口 `/?game=survival`，与默认旧 Demo 互斥启动。新游戏使用独立规则状态，不能从旧 store 向新 Runtime 双向同步。

| 入口 | 职责 |
|---|---|
| `src/main.tsx` | 按查询参数懒加载对应游戏 |
| `src/game/GameRuntime.ts`、`browserLoop.ts` | 20Hz 模拟、10Hz UI 快照、命令、日历、移动及浏览器暂停 |
| `src/game/world.ts`、`navigation.ts` | JSON 配置校验、16×16 chunk 索引、四向增量 A* |
| `src/scene/CampScene.ts` | PixiJS WebGL 地图、占位角色、路径表现、裁剪与故障恢复 |
| `src/scene/camera.ts`、`mapInput.ts` | 等距坐标、镜头、轻点 / 拖动 / 双指手势 |
| `src/features/survival/` | 竖屏界面、时钟、提示、营地地图和操作指引 |
| `public/config/survival/world.json` | 地图块、地形、元素、阻挡边、出生点与日长 |
| `src/game/inventory.ts`、`stamina.ts` | 唯一物品实例、原子合成 / 交付、真实体力时钟 |
| `src/game/buildingConfig.ts`、`construction.ts` | 随构建发布的蓝图目录、部件、订单、预留 / 释放与派生格边导航 |
| `src/game/constructionValidation.ts`、`src/game/migrations/constructionTiming.ts` | 工程与库存存档交叉校验、旧 M3 工期迁移 |
| `src/features/survival/BuildingPanel.tsx`、`BuildingBubbles.tsx` | 图纸 / 定位入口、随地图投影的部件材料气泡 |
| `src/game/productionConfig.ts`、`src/data/mergeRules.ts` | 新生产表归一化；与旧 Demo 共享邻接、随机权重和仓库扩容常量 |
| `src/game/saveData.ts`、`persistence.ts`、`session.ts` | 存档校验、IndexedDB 事务 / revision、启动恢复与备份 |
| `src/features/survival/ProductionScreen.tsx`、`SaveControls.tsx` | 合成 / 仓库操作、存档恢复界面 |
| `public/config/survival/merge/` | 物品、63 格初始棋盘、使用效果与委托表 |
| `public/assets/survival/items.svg` | 新生产物品的 SVG symbol；不覆盖原素材 |
| `src/**/*.test.ts`、`tests/browser/` | 规则与浏览器验证 |

运行 `npm test`、`npm run test:e2e`、`npm run build`。浏览器首次需 `npx playwright install chromium`；推荐 Node.js 24 LTS。当前新模式使用独立数据库 `wordmerge-survival`；导入 / 导出位于探索指引。地图与图标为可替换原型，具体字段与版本边界见 [M2 开发记录](implementation/M2-PRODUCTION-SAVE.md)。

当前 schema 2、M2 迁移与建筑配置见 [M3 开发记录](implementation/M3-CONSTRUCTION.md)。M3 蓝图暂用 TypeScript 结构目录，指纹计入存档；更改材料、尺寸或施工参数需显式兼容迁移，不能只更新配置后清档。

## 继承 Demo 模块地图

| 入口 | 职责 |
|---|---|
| `src/App.tsx` | GameProvider、战斗底层、tab 及二级覆盖层 |
| `src/store/useGameStore.tsx` | 全局状态 / reducer、资源、装备、技能、队友、怪物转换及合成快照 |
| `src/hooks/useGameLoop.ts` | 100ms tick、toast / 受击状态清理 |
| `src/components/CombatView.tsx`、`src/hooks/useCombatEffects.ts` | 战斗交互和攻击表现 |
| `src/data/combatStats.ts` | 属性汇总、伤害公式及暴击期望 |
| `src/components/MergeGameScreen.tsx` | 合成页面、Pointer Events、仓库拖拽、共享资源与奖励同步 |
| `src/data/mergeGame.ts` | 合成 reducer：移动、生成、锁格、订单、仓库 |
| `src/data/*Config.ts`、`csv.ts` | 正式 CSV 加载、解析及校验 |
| `src/styles/global.css`、`theme.css` | 1:2 视口、覆盖关系、滚动和主题变量 |
| `public/assets/fantasy-pack/` | SVG symbol 资源包 |

全局资源为 `gold` / `diamonds`，合成局部状态为 `gold` / `gems`。通过 `syncMergeResources` 同步，通过 `saveMergeSnapshot` 保留合成快照；订单装备发放由 `grantEquipment` 接入全局，需留意 effect ID 去重。

## 正式配置

以下行数为迁移时数据行数，不含表头。解析器使用 `import.meta.env.BASE_URL + config/...` fetch，编辑后通常需要刷新页面重新加载；不要把 `npm run build` 当成运行时配置完整校验。

| 文件（相对 public/config） | 行数 | 关键字段与关系 |
|---|---:|---|
| `merge/items.csv` | 82 | `item_id,item_type,chain_type,level,next_id,name,open_cost,drop_pool,icon,iconName,description` |
| `merge/orders.csv` | 100 | `order_id,max_concurrent,requirements,equipment_id,quantity` |
| `merge/equipment.csv` | 43 | 物品目录、购买价格、属性、分解价值、图标 |
| `merge/initial-board.csv` | 63 | `cell_index,item_id,lock_state` |
| `monsters.csv` | 100 | `monster_id,hp,has_time_limit,time_limit,gold_reward` |
| `skills.csv` | 75 | 技能所属角色、类型、系数、解锁与升级、特效参数 |

### 棋子、订单、棋盘

- `item_type` 是 `generator / normal / special`；`next_id` 为空表示不能继续合成，非空需引用现存棋子。
- `drop_pool` 格式为 `itemId;weight|itemId;weight`，权重为正整数；非生成器不能带产出配置。
- 订单 `requirements` 用 `|` 或中文分号 `；` 分隔多个棋子 ID。每次出现代表一枚需求，不能按集合去重。
- `order_id` 从 1 连续排列；`equipment_id` 指向装备表；最大并存数在解析 / reducer 中限制为 3。
- `initial-board.csv` 必须覆盖 0–62 且不重复，锁状态为 0 / 1 / 2。改棋盘尺寸需要同步修改解析器、邻接计算与页面布局。

### 装备与技能

装备表字段：

```text
equipment_id,equipment_type,name,diamond,description,icon,iconName,
attack,attack_bonus,crit_rate,crit_damage,damage_bonus,
normal_attack_damage,skill_damage,power,dismantle_gold
```

`diamond` 为空不能购买；可选属性为空解析为 null；百分比可填 `20%` 或 `0.2`，填 `20` 的含义是数值 20。`power` 可覆盖显示战力，空时按属性估算；`dismantle_gold` 为非负整数。

技能表字段：

```text
skill_id,owner_id,name,skill_type,description,coefficient,cooldown_seconds,
unlock_level,upgrade_cost,per_level_increase,effect_stat,shape,color,accent
```

`skill_type=1/2/3` 表示普攻 / 主动 / 被动；被动必须填写有效 `effect_stat`。数值按 `coefficient + (level - 1) × per_level_increase` 增长；描述中的 `[1]` 在显示时替换。特效 `shape` 支持 slash、fireball、lightning、frost、meteor、void。

### 怪物

`monster_id` 从 1 连续排列；HP 大于 0、金币非负、限时怪的 `time_limit` 大于 0，Boss 必须配置限时。ID 与“关卡轮次”不同，100 行覆盖 10 轮。

## SVG 资源

`icon` 是文件名，例如 `items.svg`；`iconName` 是其中 `<symbol id>`，例如 `item-1004001`。文件存在不代表 key 正确，还要验证引用和 viewBox。

- `EquipmentArt` 当前允许 weapons / heroes / ui 三类表；viewBox 分别为 96×96 / 96×96 / 64×64。
- `MergePiece` 另允许 monsters（120×120）和 items（96×96）。增加资源表需同时检查组件白名单与 `ArtSheet` 类型。
- 订单奖励使用 `EquipmentArt`；棋盘棋子使用 `MergePiece`，同一个物品的奖励预览应读装备配置。
- `scripts/generate-item-icons.ps1` 会根据棋子 CSV **重写** `items.svg`。只在明确要重新生成时运行；手工精修图形前检查脚本是否需要同步调整。
- `public/assets/fantasy-pack/README.md` 是原项目的美术来源说明，保留原文；不将它当作外部素材授权审计。

## 本地开发与针对性验证

在 WordMerge 根目录执行 `npm ci`、`npm run dev`、`npm run build`；从 dev 终端实际地址访问，避免误连仍在运行的 TitanDemo 服务。构建产物是 `dist/`。

根据实际改动挑选相关流程：

| 改动 | 建议核验 |
|---|---|
| 战斗 / 导航 | 手动与自动攻击、死亡切怪、Boss 失败与撤退、二级页暂停恢复 |
| 合成 | 交换 / 合成 / 锁格、最高生成器、满棋盘与满仓库、订单扣料和奖励 |
| 仓库 / 保存 | 拖入空格、失败落点、扩容、离开合成再返回；区分内存保存与刷新保存 |
| UI | 1:2 小屏、tab 关闭位置不变、列表可滚动、提示不挤布局 |
| 配置 / 图标 | 正式 fetch 地址、解析错误、ID 引用、SVG symbol 与 viewBox、刷新后数值 |

本次迁移只做资料准备及构建基线验证，未宣称完成上述所有浏览器交互回归。可按未来变更风险增加核心规则测试，无需为了文档改动引入测试框架。
