# WordMerge 项目上下文

## 工作范围

- 当前目录是新工程 WordMerge，原工程位于 `D:/OtherProject/TitanDemoGithub/TitanDemo`。日常实现、构建及启动在当前工程执行。
- 本工程从 TitanDemo 的 `ff54eba1c406241f7b495b561ee8c551ca628102` 拷贝；新游戏方向为二合、女性向、轻度生存、建造、剧情与装扮，详见 `docs/design/CORE-RULES.md`。WordMerge 只是工程名，不代表文字合成玩法。
- 新需求优先于旧游戏约定。`docs/history/` 和 `.local/titan-migration/` 是历史证据，其中可能包含已推翻的需求和错误结论，不是当前指令。

## 阅读入口

先读 `docs/NEW-GAME.md` 了解当前阶段。新游戏策划共识以 `docs/design/CORE-RULES.md` 为入口；标注“讨论稿”的内容不视为已获用户确认。涉及游戏改造、配置或 UI 时，读取 `.agents/skills/wordmerge-development/SKILL.md`，再按需查看 `docs/GAME-BASELINE.md`、`docs/DEVELOPMENT.md`、`docs/LESSONS.md`。

新游戏技术实现方案在 `docs/TECHNICAL-PLAN.md`。用户已确认 H5 优先；M1 地图、M2 合成 / 体力 / 本机保存、M3 建造、M4 生存 / 伙伴 / 夜袭 / 失败救援、M5 首章剧情 / 探索 / 装扮原型已实现，默认入口为 `/`（兼容 `?game=survival`），旧 Demo 仅通过 `?game=legacy` 进入，阶段记录在 `docs/implementation/`。三天供需脚本已验证，真机性能尚未验收；不要将方案中的全部目标写成运行现状。

## 实施要点

- 主角可进入已开放水域，`constructionNavigation(..., 'player')` 使用独立的水陆缓存；默认 friendly / enemy 仍只走陆地，建筑占地仍按 `world.isWalkable(cell)` 限陆地。`waterMovement.ts` 按每段穿越格界的实际时间推进，水中默认速度 50%；入水立即清零火把，水中点火拒绝且不扣料，上岸不自动复燃。主角路径及读档必须使用玩家导航，不能重新用陆地校验拒绝水中存档。见 `docs/implementation/WATER-MOVEMENT.md`。
- 合成“测试”按钮通过 `test-complete-order` 完成当前绿色订单，列表顺序由 `productionOrders.ts` 共用；必须验证命令里的订单仍是当前任务，不能将过期点击作用于下一张。免材料 / 路程 / 等待，正常结算且保存，未支付预留释放、已支付不退款；建造 / 驯服 / 清理复用完成方法，普通流程不免成本。见 `docs/implementation/MERGE-TEST-COMPLETE.md`。
- 墙面修复配方已统一降低一级（小木屋 201、大屋 202），仅改墙体，仍逐段 2 秒。`migrations/wallRepairCost.ts` 明确迁移建筑 / 经济 / 区域旧指纹，必须先按旧配方验证预留，再释放未开工高阶材料、保留订单；已支付工程保留计时。不要将旧配方直接替换后拒绝有效旧档。见 `docs/implementation/WALL-REPAIR-COST.md`。
- 寻路缓存 `navigationCache.ts` 只面向不可变通行拓扑，`constructionNavigation` 以 `WorldMap` / 实际墙门阻挡边复用；普通扣血不失效，破坏 / 修复 / 新建必须切换边拓扑，开地 / 清理须派生新地图。常驻怪区域使用独立连通缓存；动态自定义地图方法回退原检查。不将缓存写入存档，不降低 AI 决策频率。性能复现脚本及边界见 `docs/implementation/ENEMY-NAVIGATION-PERFORMANCE.md`。
- 九宫格地图：`world.json` 为 (-1～1, -1～1) 共九个地块，新增六区与 60 资源由 `mapExpansionConfig.ts` 提供。`migrations/mapExpansion.ts` 明确迁移地图 `cc0401b` → `8ceb237a`、剧情目录 `dad671cf` → `5c677ab8`；不清档、不发奖，保留旧 20 分钟折算，原清晨删档授权仍只匹配三地块历史图。`LockedRegionFog.ts` 云雾固定世界坐标采样、按块缓存半分辨率纹理，地块开放销毁；不得恢复为每帧混合大量云团。见 `docs/implementation/MAP-EXPANSION-FOG.md`。
- 装饰拆除 `decor-dismantle` 要求具体实例 ID，`decorSalvage.ts` 先克隆生产状态试发全部一级棋子，空间不足不删摆件；成功后同步删实例、不返摆件库存，保留来源记录和递增 ID，反馈复用 `recordLoot`。建筑现由 `buildingModel.ts` XYZ 实体几何 / `BuildingModelView.ts` 固定投影，墙 / 地板 / 门有厚度、屋顶按原段保留破损，重复内面剔除；不得把图纸外包矩形重新当作异形实际占格。九套 OBJ 可用 `scripts/export-building-models.mjs` 重生。见 `docs/implementation/DECOR-SALVAGE-LOWPOLY.md`。
- 包内素材后续已扩到 20 图，地图静态物件及九类家具都有 Sprite；床用 `outchair_C` 长椅替代但保留 `bed` 规则 / 存档身份。`contentPresentation.ts` 仅派生 UI 名称与剧情文字，不能用于替换 Runtime 指纹配置。`sceneArtCatalog` 共用锚点，地毯在地面层，其余家具和长椅参与墙体深度排序。映射与验证见 `docs/implementation/SCENE-ART-EXPANSION.md`。
- 首轮图片素材仅替换普通树、`chair`、`planter` 及 `cabin` 表面。`sceneArtCatalog.ts` 管理比例、脚底和气泡锚点，`SceneArt.ts` 单次加载 / alpha 点击 / 投影材质，失败保留矢量回退。家具预览与场景共用容器并参与墙段深度排序；屋顶及地板保留逐格耐久缺口、共享 UV。来源在 `public/assets/survival/scene/sources.json`，只读提取脚本为 `scripts/extract_scene_samples.py`，不修改经济 / 建筑指纹或存档。验证与桌面性能局限见 `docs/implementation/SCENE-ART-SAMPLES.md`。
- 深夜与火把见 `docs/implementation/NIGHT-LIGHTING.md`。`lighting.ts` 配置两根 201 木枝 / 60 在线模拟秒及光照半径；Runtime `torch-light` 原子扣料，`survival.torchRemaining` 保存剩余时间，旧 schema 4 缺失视为未点燃，校验有限 0～60，不清档。世界暂停时停烧，合成继续，跳时不补扣；重复点燃不扣料。`TorchButton` 位于定位右侧，仅显示和发命令。`Atmosphere` 软遮罩在深夜隐藏无光地图，用随镜头缩放的火把 / 提灯 / 营火光圈揭开；原营火现为常亮光源、场景提灯随摆放移除，暂不耗燃料或影响温度 / AI。照明动画不能参与燃料结算。
- 高阶工具与林地奖励扩展见 `docs/implementation/GROVE-TOOLS-REWARDS.md`。工具链斧头 252→253→254、石镐 262→263→264，同链高阶可替代低阶且优先最低级，预留和气泡必须使用实际选中工具。林地大屋初始地基已完成并一次计入 20 经验；旧已建损伤保留、未开工订单释放、已扣料施工继续。雕像 `grove-statue` 坐标保存在 `regionContent.statue`，避开建筑 / 角色 / 工作位 / 已保存路径，用 264 拆除暂奖 30 钻石，移除复用经济记录。目录、经济和区域版本显式迁移，不能清档。Runtime 的临时 `LootFeedback` 只在实际拆除 / 待领领取成功后发出；`ResourceDrops` 负责场景图标、名称、数量与满仓“待领取”表现，不写存档或参与发奖。

- 一天时长在 `world.json` 改为 600 秒，保留中午 12:00 开局及 06:00–19:00 白天。`saveData.ts` 仅对原 1200 秒中午地图指纹 `54404a5a` 显式迁移，将 `elapsedSeconds` 减半以保留日期时刻；施工、交战、警觉与刷怪等相对秒数不缩放，不补算、不清档。原清晨删档授权仍只匹配 1200 秒 / 06:00 的旧地图。
- 第一批内容扩展见 `docs/implementation/CONTENT-EXPANSION-01.md`：合成新增 204–206 / 214–215 / 223–224 / 233–234 / 243，商店新增 3 图纸、6 摆件、3 服装。`migrations/contentExpansion.ts` 显式迁移旧合成 / 剧情 / 经济指纹，不能清档；旧档回归夹具在 `tests/fixtures/pre-content-expansion.json`。商店新房纳入经济指纹，基础与区域建筑指纹保留。`WorldMap` 按 `FLORA_KINDS` 将指定原树木 ID 派生为灌木 / 苹果树，不变更原地图配置、占位或清理奖励；暂不支持采摘。`houseStyle.ts` 管理视觉分类，斜屋顶 / 两端封板按原屋顶段耐久绘制，保持进屋隐藏和自动门。
- 昼夜动态遭遇参数在 `encounters.ts`：白天 / 夜晚间隔 160 / 65 秒、动态在场上限 2 / 5；在主角周围 6～14 格的可达地面选点，排除 CampScene 上报的镜头可见范围，无位置则 5 秒后重试。出生时持久化 `Enemy.roaming / tameable`，新单位天亮保留；溪谷常驻巡逻不变。可驯服动物中立靠近，使用 `taming.targetId` 绑定同一只动物的气泡、合成订单、预留和 2 秒作业，支持夜间驯服；栗栗保留白天限制。`survival.recruits` 保存新增伙伴，旧档缺省为空，不替换 `companion`；命令可带 `companionId`，交战用 `duel.companionId` 锁定实际双方，并按物种核算数值。伙伴当前容量 6，原单对交战槽保留；其他伙伴仍移动 / 选敌。救援清除失效野生驯服订单、保留已招募伙伴。详见 `docs/implementation/DYNAMIC-ENCOUNTERS.md`。
- 装饰独立入口在建造旁，`DecorationPanel` 替代手记装扮页，商店购买的皮肤 / 摆件由此使用。同款摆件可重复购买；`progression.decorStock` 保存剩余库存、`decorations[].id` 标识独立场景实例、`nextDecorationId` 递增。放置扣 1，取消预览 / 指定移动不扣，收回指定实例返还 1；同类物件可共存但不能重叠。旧 schema 4 缺少库存时按旧唯一物件规则验证后补库存与 ID，不清档；`ownedDecor` 和去重购买列表仍用于来源校验。剧情可在已购买同款后再赠 1 件，皮肤仍永久解锁 / 去重。详见 `docs/implementation/DECORATION-COLLECTION.md`。
- `world.json` 开局为 12:00。用户在 2026-10-07 明确授权这次直接删旧档：`clearMorningStartSave` 在启动前按原 06:00 地图指纹原子清除旧进度和备份并更新 generation；新中午版本存档不重复清除。该授权仅限本次开局变更，不代表今后配置不兼容都可以删档。
- 经济扩展见 `docs/implementation/ECONOMY-RESOURCE-SHOP.md`。界面称“精力”，内部 `stamina` 不改；金币 / 钻石复用 `production.inventory.gold/gems`。`economy.ts` / Runtime 管理资源清理、商店购买、领取与移动消耗；schema 4 旧档补默认经济状态，新增工具 CSV 目录有显式指纹迁移，不能清档。
- 资源点击显示场景工具气泡，斧头 / 石镐来自商店免费领取一次的工具箱合成链。预留工具、到达相邻工作位后扣料并保护 2 秒，和其他主角作业互斥；完工派生 WorldMap 移除物体。满仓材料保留领取权，商店领取；货币只发一次，不新增背包。商店蓝图归经济版本校验，原基础 / 区域建筑指纹不扩大。
- 建造、修复、驯服、开地、清理开工扣 1 饱食度和水分；`walkPath.distance` 按主角实际距离每满 10 格扣各 1，经济状态保存余数。区域野猪无目标时在出生点 2 格范围巡逻、到点停 2 秒，优先原有索敌；保存可选 `patrol`。移除静态场景物体名称与地图建设经验保存文字，存档功能仍在设置。
- React 18 + TypeScript + Vite 5，样式为 CSS Modules。旧 Demo 使用 Context / reducer；新模式由 `src/game/GameRuntime.ts` 管理权威状态，React 用 `useSyncExternalStore` 订阅，Pixi 仅负责地图表现。
- 主角、伙伴与敌人移动已统一为 `smoothNavigation.ts` 连续坐标：直达优先，八向 A* 绕行，再做视线简化与安全拐角圆滑；沿路径按实际距离推进，途中改点立即从当前位置重规划。碰撞检查含地形、墙边与角色半径，不能仅检查端点。敌人仍用敌方墙门规则和自身速度，区域野猪的寻路 / 步进 / 存档共用区域边界；Runtime 按敌人 ID 保存上一模拟步位置供 Pixi 插值，交战只冻结双方。交互 / 建造仍用格坐标，工作位必须精确到达才扣料。保存 `motion.version = 1` 与精确位置，兼容旧 cell / progress 存档；细节见 `docs/implementation/SMOOTH-MOVEMENT.md`。
- 手动移动命令使用 `manualMovePath`：普通目标保留原平滑寻路；障碍、未开放 / 地图外及不连通目标，在当前连通区域内寻找靠近点击处的安全终点。主角现可进入水面；指定移动伙伴仍在岸边停止，两者共用算法但传入各自通行网格。仅保存可达终点 / 路线，重复点击边缘不后退。施工、驯服、清理、开地与 AI 仍用严格目的地，不允许以靠近工作位代替抵达。
- 伙伴指定移动 / 跟随 / 回位 / 追敌也复用 `SmoothPathSearch`、`moveTarget`、`walkPath`，速度仍由伙伴配置决定。伙伴保存可选 `motion.version = 1` 与精确位置，旧 cell / progress 从实际中途位置转换；路线按友方墙门验证，交战期间冻结路线恢复时重新检查。场景用 `previousCompanionPosition` 插值。主角不显示路径，只显示终点，伙伴手动移动显示绿色终点。
- 合成运行配置是 `public/config/` 下英文表头 CSV；M3 蓝图、M4 生存参数、M5 剧情与区域扩展暂用版本化 TypeScript 目录，基础地图用 JSON。桌面原表和归档表不是运行输入。
- 新合成配置在 `public/config/survival/merge/`，复用原棋子表头，`open_cost` 在新模式表示体力；物品使用效果和委托奖励独立配置，不接旧装备奖励。详情见 `docs/implementation/M2-PRODUCTION-SAVE.md`。
- 新模式的物品与订单只通过 Runtime 命令改变。棋盘 / 仓库使用唯一实例 ID；禁止从 React effect 或动画回调扣料、发奖。当前 schema 4 显式迁移兼容的 M2 schema 1、M3 schema 2 与 M4 schema 3；其他不兼容版本拒绝覆盖，保留故障数据。
- 合成订单以 Runtime 的临时 `productionOrderFocus` 记住当前地图需求，ProductionScreen 排到首位、绘制绿色边框与类型角标；点击可换单，完成 / 取消后回退首单。选择不写存档、不更改库存。StatusIcons 观察 HP 下降显示红色飘字，动画只负责表现，不参与伤害结算。林岚位置与命中共享 CampScene 的 `RESIDENT_CELL`，当前为 `(11, 8)`。
- 状态快捷补给由 `quickSupply.ts` 经 Runtime 提交，复用实际物品使用，不另建库存；补给订单放在 `production.supplyOrders`，按状态去重，schema 4 旧档缺少该字段时补空列表。当前支持生命 / 饱食 / 水分，温度道具待确认。详情见 `docs/implementation/QUICK-SUPPLY.md`。
- M3 蓝图参数在 `src/game/buildingConfig.ts`，内容指纹参与存档兼容性。工程原位预留，到工作位才扣料；开工不可中断且主角 / 当前部件免伤。墙门格边导航由 Runtime 建筑状态派生，Pixi 不持有权威施工或耐久状态。
- 异形图纸用可选 `Blueprint.cells` 保存本地占格，`blueprintCells` 为旧图纸生成原矩形并保留顺序；所有占地、室内、地板 / 屋顶分段与摆放检查使用实际占格，宽高仅为外包尺寸。森语转角屋 12 格 / 320 金币，花庭小院 18 格 / 45 钻石；新外围墙顺序固定，旧墙段 ID 不改变。凹口是室外，屋顶不能覆盖；旧经济指纹 `5723f3b5` 显式迁移，旧购买列表拒绝伪造新增商品，不清档。详见 `docs/implementation/FOREST-ART-SHAPED-HOUSES.md`。
- 场景自然变体由 `objectAppearance` 按物件 ID 派生，绘制 / 命中 / 气泡共用尺寸；不要移动逻辑落地位置。`TerrainArt` 在基础地形之后画边缘与小细节；`ShapedRoof` 按真实占格共享顶点拼顶。墙段 / 床独立加入 actors 深度排序，家具同层、地毯在地面层，屋顶仍交由 BuildingAppearance 管理。静态图形仅在相关状态变化时重建。
- 建造仍按图纸组一次完成；围墙按 `edgeN`、地基 / 屋顶按 `tileX-Y` 保存 `parts[id].segments` 独立耐久，组 `hp` 仅为最小值汇总。攻击和修复带 `segmentId`，修复订单为 `buildingId:partId:segmentId`；只恢复 / 保护目标段，首次建造保护整组。导航只阻挡尚存墙段。旧档先验证后补段耐久并迁移旧修复 ID / 工程 / 预留，不清档、不补扣或重发经验。新建与区域补入都用 `createBuildingParts`；不得直接写组 hp 代替段耐久。屋内点击走普通移动，不再拦截为建筑选择；完工进入气泡与照护页走进木屋按钮已移除。见 `docs/implementation/BUILDING-SEGMENTS.md`。
- 所有房屋单段墙耐久已翻倍：小木屋 / 花园木屋 / 草顶屋 40，大屋 / 客舍 60，暖杉 / 转角屋 80，庄园 / 小院 120。`migrations/doubleWallDurability.ts` 显式兼容此前建筑 `ef8cf350`、经济 `432066d2`、区域 `e4ca7944` 指纹；旧伤按比例转换、破墙保持 0。更早 160 / 320 版本继续由 `wallDurability.ts` 直接迁到当前上限，避免重复翻倍。只转换墙体，不重置工程、预留或经验，不清档。
- 建造交互改为地图材料气泡：满足条件变绿、点击直接安排；缺料点击去合成，不开材料详情子界面。建造 / 修复统一 2 秒，旧 M3 工期按已完成比例迁移，不能清档或重发经验。
- 建造气泡由 `src/scene/BuildingBubbles.ts` 在 Pixi 地图容器内绘制，大小、图标、文字和命中区域随镜头缩放；地图统一处理轻点 / 拖动 / 捏合，不能恢复成固定大小的 DOM 视觉覆盖层。透明 DOM 镜像仅用于无障碍与只读坐标，不拦截指针。
- 修复气泡固定在各自场景部件上方，墙 / 门用边中点，地板 / 屋顶用格子位置，床用自身位置；不要自动避让上推或把单件修复放回建筑中央横排。只有未建造的整组气泡仍横排。
- M4 生存参数在 `src/game/survivalConfig.ts`，昼夜 / 天气 / 敌人与伙伴由 `survival.ts` 跟随 Runtime 固定步进。主角 / 建筑保持即时受击；伙伴与敌人靠近后锁定一对，用 `companionCombat.ts` 按当前生命 / 攻击 / 间隔 / 冷却预算整场结果，隐藏模型演出 2 秒烟尘后统一扣血与发奖，再播放 1 秒胜负动作。`survival.duel` 持久化阶段、计时与结果，旧 schema 4 缺少时补 null；同拍允许双败，战斗中不治疗 / 改令。天亮先撤未交战敌人，已交战对完成后再撤。仅主角生命归零触发失败；救援先结算尚未提交的交战结果，再回营地，保存重试不得重复奖励或扣物资。详见 `docs/implementation/COMPANION-COMBAT.md`。
- 伙伴主动“休养”改为“移动”：React 仅持有临时操控模式，CampScene 在材料气泡 / 动物 / 建筑点击前优先提交 `companion-move`，底部“取消操控”恢复主角输入；退出不撤销已经下达的目的地。Runtime 用 `mode: move` 与 `guard` 保存目的地，途中可改点，到达后驻守；战斗时拒绝改令，受伤 / 失败 / 剧情或打开其他面板退出操控。移除主动休养回血，保留用药恢复；旧 `rest` 存档迁为当前位置 `guard`，旧 `restHpPerSecond` 仅保留配置指纹兼容，不再使用。本轮仅构建，按用户要求未运行游戏验证，规则与浏览器测试也未运行。
- 栗栗驯服使用 1 份 3 级野餐餐盒（213）；旧野莓存档显式迁移，前往中释放旧预留并保留订单，已开工 / 已驯服保留。驯服由 `taming.ts` / Runtime 管理：气泡缺料建单，足料预留、自动前往，精确到达才扣料并计时 2 秒；途中取消或入夜释放预留，开始后不可中断、主角免伤。与施工互斥，旧 `companion-rescue` 同样走计时流程。schema 4 旧档缺少 `survival.taming` 时补默认值；施工与驯服分别验证预留归属，`saveData.ts` 最后统一检查孤立预留。伙伴场景点击打开 `CompanionWheel`，世界继续运行。
- M5 内容在 `src/game/progressionConfig.ts`；剧情逐页保存，只有对话暂停世界，手记 / 装扮不暂停。最终回应原子提交扣料、奖励和完成标记，生成器奖励必须有棋盘空位。区域解锁派生新的 WorldMap，保留原地图配置指纹；寻路、施工、场景和读档都使用派生地图。服装与摆件仅改变外观，救援保留剧情、区域与收藏。
- “准备野餐”委托 2 的既有 `completedOrders` 记录满足 `visitor` 剧情物资需求；`chapterMaterials` 同时用于就绪检查与回应扣料，已交付不重复扣 212 / 222。前置章节与溪谷发现仍必需，合成提交后符合条件直接打开剧情，回应后才完成章节 / 发剧情奖励。旧档直接认可已有记录，无配置或存档迁移；见 `docs/implementation/PICNIC-STORY-DELIVERY.md`。
- 区域开放在每个未开放地块四边预设场景指示牌，仅与已解锁地块接壤的一侧显示，其余隐藏；邻接区域开放后自动更新，解锁后该地块所有牌子消失。仅检查建设经验（不消耗），点可达的一侧，前往地块外侧工作位后开放 2 秒，途中可取消、开工不可中断且主角免伤；与施工 / 驯服互斥。`regionUnlock.ts` / Runtime 保存前往与计时状态，schema 4 兼容旧 M5 剧情指纹 `7a73e35c` 并补 `progression.regionUnlock = null`。营地地图页已删除，手记目标改为定位指示牌或已开放区域的地标；详见 `docs/implementation/REGION-SIGNPOSTS.md`。
- 区域内容由 `regionContentConfig.ts` / `regionContent.ts` 一次性填充：溪谷 3 只常驻野猪（靠近才攻击、活动不离开溪谷、白天 / 救援保留、击败后不因刷新重生）；林地一个 5×4 `lodge` 固定地基，使用既有材料气泡与 2 秒施工。`progression.regionContent` 保存独立版本和初始化区域，旧档补入并避开已有建筑。基础 `BUILDING_VERSION` 仅包含可放置的小木屋，区域建筑与出生配置由 `REGION_CONTENT_VERSION` 单独校验；不要修改区域配置后忘记迁移此版本。详见 `docs/implementation/REGION-CONTENT.md`。
- 昼夜用日月图标显示，不展示数字时分。`environment.ts` 定义阶段、光照与测试切换规则；`Atmosphere.ts` 只渲染，动画沿用模拟时钟。测试跳时由 Runtime 命令提交，按下一次预设时刻向前跳，不补算消耗 / 施工，不发自然黎明剧情进度，白天撤敌无奖励；天气保持到下次自然黎明。schema 4 与配置指纹不因这些表现参数改变。
- 地图调试入口统一为“测试”，由 `TestControls.tsx` 提供一级菜单与时间天气 / 状态二级面板。四种生存状态各 ±10，由 Runtime 的 `test-vital` 命令修改并限制在 0～100，生命归零仍进入救援；“删”位于一级面板。用户要求此轮不运行验证，不能引用以前测试结果作为新功能已验证的证据。
- 现运行基线的二级页暂停战斗属于旧游戏行为；新游戏已确认合成期间世界继续运行、离线暂停世界但体力恢复。不要将旧暂停约束误当成新游戏设计。
- 修改规则时同步维护新游戏文档；原游戏规则文档保留为迁移基线，避免将计划写成已经实现。
- 用户已明确：类似隐藏信息条、图标尺寸 / 配色 / 间距等简单 UI 调整，直接修改，无需运行构建、测试或浏览器验证；此偏好优先于 skill 的通用验证要求。其他功能代码变动执行 `npm run build`，按改动范围运行 `npm test`（规则）与 `npm run test:e2e`（浏览器）或检查实际交互；仅文档变动无需机械重复构建。浏览器测试首次需要 `npx playwright install chromium`；不要宣称未执行的验证通过。
- 文件使用 UTF-8。PowerShell 读取中文文本时显式使用 `-Encoding UTF8`，不要将控制台误解码当作源文件损坏。
- 保持本地 `.local/` 档案不进入版本管理；项目协作资料放 `docs/`。
