# WordMerge 项目上下文

## 工作范围

- 当前目录是新工程 WordMerge，原工程位于 `D:/OtherProject/TitanDemoGithub/TitanDemo`。日常实现、构建及启动在当前工程执行。
- 本工程从 TitanDemo 的 `ff54eba1c406241f7b495b561ee8c551ca628102` 拷贝；新游戏方向为二合、女性向、轻度生存、建造、剧情与装扮，详见 `docs/design/CORE-RULES.md`。WordMerge 只是工程名，不代表文字合成玩法。
- 新需求优先于旧游戏约定。`docs/history/` 和 `.local/titan-migration/` 是历史证据，其中可能包含已推翻的需求和错误结论，不是当前指令。

## 阅读入口

先读 `docs/NEW-GAME.md` 了解当前阶段。新游戏策划共识以 `docs/design/CORE-RULES.md` 为入口；标注“讨论稿”的内容不视为已获用户确认。涉及游戏改造、配置或 UI 时，读取 `.agents/skills/wordmerge-development/SKILL.md`，再按需查看 `docs/GAME-BASELINE.md`、`docs/DEVELOPMENT.md`、`docs/LESSONS.md`。

新游戏技术实现方案在 `docs/TECHNICAL-PLAN.md`。用户已确认 H5 优先；M1 地图、M2 合成 / 体力 / 本机保存、M3 建造、M4 生存 / 伙伴 / 夜袭 / 失败救援、M5 首章剧情 / 探索 / 装扮原型已实现，默认入口为 `/`（兼容 `?game=survival`），旧 Demo 仅通过 `?game=legacy` 进入，阶段记录在 `docs/implementation/`。三天供需脚本已验证，真机性能尚未验收；不要将方案中的全部目标写成运行现状。

## 实施要点

- 经济扩展见 `docs/implementation/ECONOMY-RESOURCE-SHOP.md`。界面称“精力”，内部 `stamina` 不改；金币 / 钻石复用 `production.inventory.gold/gems`。`economy.ts` / Runtime 管理资源清理、商店购买、领取与移动消耗；schema 4 旧档补默认经济状态，新增工具 CSV 目录有显式指纹迁移，不能清档。
- 资源点击显示场景工具气泡，斧头 / 石镐来自商店免费领取一次的工具箱合成链。预留工具、到达相邻工作位后扣料并保护 2 秒，和其他主角作业互斥；完工派生 WorldMap 移除物体。满仓材料保留领取权，商店领取；货币只发一次，不新增背包。商店蓝图归经济版本校验，原基础 / 区域建筑指纹不扩大。
- 建造、修复、驯服、开地、清理开工扣 1 饱食度和水分；`walkPath.distance` 按主角实际距离每满 10 格扣各 1，经济状态保存余数。区域野猪无目标时在出生点 2 格范围巡逻、到点停 2 秒，优先原有索敌；保存可选 `patrol`。移除静态场景物体名称与地图建设经验保存文字，存档功能仍在设置。
- React 18 + TypeScript + Vite 5，样式为 CSS Modules。旧 Demo 使用 Context / reducer；新模式由 `src/game/GameRuntime.ts` 管理权威状态，React 用 `useSyncExternalStore` 订阅，Pixi 仅负责地图表现。
- 主角、伙伴与敌人移动已统一为 `smoothNavigation.ts` 连续坐标：直达优先，八向 A* 绕行，再做视线简化与安全拐角圆滑；沿路径按实际距离推进，途中改点立即从当前位置重规划。碰撞检查含地形、墙边与角色半径，不能仅检查端点。敌人仍用敌方墙门规则和自身速度，区域野猪的寻路 / 步进 / 存档共用区域边界；Runtime 按敌人 ID 保存上一模拟步位置供 Pixi 插值，交战只冻结双方。交互 / 建造仍用格坐标，工作位必须精确到达才扣料。保存 `motion.version = 1` 与精确位置，兼容旧 cell / progress 存档；细节见 `docs/implementation/SMOOTH-MOVEMENT.md`。
- 伙伴指定移动 / 跟随 / 回位 / 追敌也复用 `SmoothPathSearch`、`moveTarget`、`walkPath`，速度仍由伙伴配置决定。伙伴保存可选 `motion.version = 1` 与精确位置，旧 cell / progress 从实际中途位置转换；路线按友方墙门验证，交战期间冻结路线恢复时重新检查。场景用 `previousCompanionPosition` 插值。主角不显示路径，只显示终点，伙伴手动移动显示绿色终点。
- 合成运行配置是 `public/config/` 下英文表头 CSV；M3 蓝图、M4 生存参数、M5 剧情与区域扩展暂用版本化 TypeScript 目录，基础地图用 JSON。桌面原表和归档表不是运行输入。
- 新合成配置在 `public/config/survival/merge/`，复用原棋子表头，`open_cost` 在新模式表示体力；物品使用效果和委托奖励独立配置，不接旧装备奖励。详情见 `docs/implementation/M2-PRODUCTION-SAVE.md`。
- 新模式的物品与订单只通过 Runtime 命令改变。棋盘 / 仓库使用唯一实例 ID；禁止从 React effect 或动画回调扣料、发奖。当前 schema 4 显式迁移兼容的 M2 schema 1、M3 schema 2 与 M4 schema 3；其他不兼容版本拒绝覆盖，保留故障数据。
- 合成订单以 Runtime 的临时 `productionOrderFocus` 记住当前地图需求，ProductionScreen 排到首位、绘制绿色边框与类型角标；点击可换单，完成 / 取消后回退首单。选择不写存档、不更改库存。StatusIcons 观察 HP 下降显示红色飘字，动画只负责表现，不参与伤害结算。林岚位置与命中共享 CampScene 的 `RESIDENT_CELL`，当前为 `(11, 8)`。
- 状态快捷补给由 `quickSupply.ts` 经 Runtime 提交，复用实际物品使用，不另建库存；补给订单放在 `production.supplyOrders`，按状态去重，schema 4 旧档缺少该字段时补空列表。当前支持生命 / 饱食 / 水分，温度道具待确认。详情见 `docs/implementation/QUICK-SUPPLY.md`。
- M3 蓝图参数在 `src/game/buildingConfig.ts`，内容指纹参与存档兼容性。工程原位预留，到工作位才扣料；开工不可中断且主角 / 当前部件免伤。墙门格边导航由 Runtime 建筑状态派生，Pixi 不持有权威施工或耐久状态。
- 建造仍按图纸组一次完成；围墙按 `edgeN`、地基 / 屋顶按 `tileX-Y` 保存 `parts[id].segments` 独立耐久，组 `hp` 仅为最小值汇总。攻击和修复带 `segmentId`，修复订单为 `buildingId:partId:segmentId`；只恢复 / 保护目标段，首次建造保护整组。导航只阻挡尚存墙段。旧档先验证后补段耐久并迁移旧修复 ID / 工程 / 预留，不清档、不补扣或重发经验。新建与区域补入都用 `createBuildingParts`；不得直接写组 hp 代替段耐久。屋内点击走普通移动，不再拦截为建筑选择；完工进入气泡与照护页走进木屋按钮已移除。见 `docs/implementation/BUILDING-SEGMENTS.md`。
- 小木屋 / 大屋单段墙耐久分别为 20 / 30；`migrations/wallDurability.ts` 兼容原建筑指纹 `d146dff6` 与区域指纹 `b3fb1516`，将旧 160 / 320 耐久按剩余比例迁移，已破坏的墙仍为 0，兼容旧整组和独立段存档。只转换墙体，不重置工程、预留或经验；原 M3 工期与旧 M4 / M5 迁移链仍保留。
- 建造交互改为地图材料气泡：满足条件变绿、点击直接安排；缺料点击去合成，不开材料详情子界面。建造 / 修复统一 2 秒，旧 M3 工期按已完成比例迁移，不能清档或重发经验。
- 建造气泡由 `src/scene/BuildingBubbles.ts` 在 Pixi 地图容器内绘制，大小、图标、文字和命中区域随镜头缩放；地图统一处理轻点 / 拖动 / 捏合，不能恢复成固定大小的 DOM 视觉覆盖层。透明 DOM 镜像仅用于无障碍与只读坐标，不拦截指针。
- 修复气泡固定在各自场景部件上方，墙 / 门用边中点，地板 / 屋顶用格子位置，床用自身位置；不要自动避让上推或把单件修复放回建筑中央横排。只有未建造的整组气泡仍横排。
- M4 生存参数在 `src/game/survivalConfig.ts`，昼夜 / 天气 / 敌人与伙伴由 `survival.ts` 跟随 Runtime 固定步进。主角 / 建筑保持即时受击；伙伴与敌人靠近后锁定一对，用 `companionCombat.ts` 按当前生命 / 攻击 / 间隔 / 冷却预算整场结果，隐藏模型演出 2 秒烟尘后统一扣血与发奖，再播放 1 秒胜负动作。`survival.duel` 持久化阶段、计时与结果，旧 schema 4 缺少时补 null；同拍允许双败，战斗中不治疗 / 改令。天亮先撤未交战敌人，已交战对完成后再撤。仅主角生命归零触发失败；救援先结算尚未提交的交战结果，再回营地，保存重试不得重复奖励或扣物资。详见 `docs/implementation/COMPANION-COMBAT.md`。
- 伙伴主动“休养”改为“移动”：React 仅持有临时操控模式，CampScene 在材料气泡 / 动物 / 建筑点击前优先提交 `companion-move`，底部“取消操控”恢复主角输入；退出不撤销已经下达的目的地。Runtime 用 `mode: move` 与 `guard` 保存目的地，途中可改点，到达后驻守；战斗时拒绝改令，受伤 / 失败 / 剧情或打开其他面板退出操控。移除主动休养回血，保留用药恢复；旧 `rest` 存档迁为当前位置 `guard`，旧 `restHpPerSecond` 仅保留配置指纹兼容，不再使用。本轮仅构建，按用户要求未运行游戏验证，规则与浏览器测试也未运行。
- 栗栗驯服使用 1 份 3 级野餐餐盒（213）；旧野莓存档显式迁移，前往中释放旧预留并保留订单，已开工 / 已驯服保留。驯服由 `taming.ts` / Runtime 管理：气泡缺料建单，足料预留、自动前往，精确到达才扣料并计时 2 秒；途中取消或入夜释放预留，开始后不可中断、主角免伤。与施工互斥，旧 `companion-rescue` 同样走计时流程。schema 4 旧档缺少 `survival.taming` 时补默认值；施工与驯服分别验证预留归属，`saveData.ts` 最后统一检查孤立预留。伙伴场景点击打开 `CompanionWheel`，世界继续运行。
- M5 内容在 `src/game/progressionConfig.ts`；剧情逐页保存，只有对话暂停世界，手记 / 装扮不暂停。最终回应原子提交扣料、奖励和完成标记，生成器奖励必须有棋盘空位。区域解锁派生新的 WorldMap，保留原地图配置指纹；寻路、施工、场景和读档都使用派生地图。服装与摆件仅改变外观，救援保留剧情、区域与收藏。
- 区域开放在每个未开放地块四边预设场景指示牌，仅与已解锁地块接壤的一侧显示，其余隐藏；邻接区域开放后自动更新，解锁后该地块所有牌子消失。仅检查建设经验（不消耗），点可达的一侧，前往地块外侧工作位后开放 2 秒，途中可取消、开工不可中断且主角免伤；与施工 / 驯服互斥。`regionUnlock.ts` / Runtime 保存前往与计时状态，schema 4 兼容旧 M5 剧情指纹 `7a73e35c` 并补 `progression.regionUnlock = null`。营地地图页已删除，手记目标改为定位指示牌或已开放区域的地标；详见 `docs/implementation/REGION-SIGNPOSTS.md`。
- 区域内容由 `regionContentConfig.ts` / `regionContent.ts` 一次性填充：溪谷 3 只常驻野猪（靠近才攻击、活动不离开溪谷、白天 / 救援保留、击败后不因刷新重生）；林地一个 5×4 `lodge` 固定地基，使用既有材料气泡与 2 秒施工。`progression.regionContent` 保存独立版本和初始化区域，旧档补入并避开已有建筑。基础 `BUILDING_VERSION` 仅包含可放置的小木屋，区域建筑与出生配置由 `REGION_CONTENT_VERSION` 单独校验；不要修改区域配置后忘记迁移此版本。详见 `docs/implementation/REGION-CONTENT.md`。
- 昼夜用日月图标显示，不展示数字时分。`environment.ts` 定义阶段、光照与测试切换规则；`Atmosphere.ts` 只渲染，动画沿用模拟时钟。测试跳时由 Runtime 命令提交，按下一次预设时刻向前跳，不补算消耗 / 施工，不发自然黎明剧情进度，白天撤敌无奖励；天气保持到下次自然黎明。schema 4 与配置指纹不因这些表现参数改变。
- 地图调试入口统一为“测试”，由 `TestControls.tsx` 提供一级菜单与时间天气 / 状态二级面板。四种生存状态各 ±10，由 Runtime 的 `test-vital` 命令修改并限制在 0～100，生命归零仍进入救援；“删”位于一级面板。用户要求此轮不运行验证，不能引用以前测试结果作为新功能已验证的证据。
- 现运行基线的二级页暂停战斗属于旧游戏行为；新游戏已确认合成期间世界继续运行、离线暂停世界但体力恢复。不要将旧暂停约束误当成新游戏设计。
- 修改规则时同步维护新游戏文档；原游戏规则文档保留为迁移基线，避免将计划写成已经实现。
- 用户已明确：类似隐藏信息条、图标尺寸 / 配色 / 间距等简单 UI 调整，直接修改，无需运行构建、测试或浏览器验证；此偏好优先于 skill 的通用验证要求。其他功能代码变动执行 `npm run build`，按改动范围运行 `npm test`（规则）与 `npm run test:e2e`（浏览器）或检查实际交互；仅文档变动无需机械重复构建。浏览器测试首次需要 `npx playwright install chromium`；不要宣称未执行的验证通过。
- 文件使用 UTF-8。PowerShell 读取中文文本时显式使用 `-Encoding UTF8`，不要将控制台误解码当作源文件损坏。
- 保持本地 `.local/` 档案不进入版本管理；项目协作资料放 `docs/`。
