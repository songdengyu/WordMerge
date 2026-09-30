# WordMerge 项目上下文

## 工作范围

- 当前目录是新工程 WordMerge，原工程位于 `D:/OtherProject/TitanDemoGithub/TitanDemo`。日常实现、构建及启动在当前工程执行。
- 本工程从 TitanDemo 的 `ff54eba1c406241f7b495b561ee8c551ca628102` 拷贝；新游戏方向为二合、女性向、轻度生存、建造、剧情与装扮，详见 `docs/design/CORE-RULES.md`。WordMerge 只是工程名，不代表文字合成玩法。
- 新需求优先于旧游戏约定。`docs/history/` 和 `.local/titan-migration/` 是历史证据，其中可能包含已推翻的需求和错误结论，不是当前指令。

## 阅读入口

先读 `docs/NEW-GAME.md` 了解当前阶段。新游戏策划共识以 `docs/design/CORE-RULES.md` 为入口；标注“讨论稿”的内容不视为已获用户确认。涉及游戏改造、配置或 UI 时，读取 `.agents/skills/wordmerge-development/SKILL.md`，再按需查看 `docs/GAME-BASELINE.md`、`docs/DEVELOPMENT.md`、`docs/LESSONS.md`。

新游戏技术实现方案在 `docs/TECHNICAL-PLAN.md`。用户已确认 H5 优先；M1 地图、M2 合成 / 体力 / 本机保存、M3 建造已实现，入口为 `?game=survival`，阶段记录在 `docs/implementation/`。M4–M5 尚未实现，不要将方案写成运行现状。

## 实施要点

- React 18 + TypeScript + Vite 5，样式为 CSS Modules。旧 Demo 使用 Context / reducer；新模式由 `src/game/GameRuntime.ts` 管理权威状态，React 用 `useSyncExternalStore` 订阅，Pixi 仅负责地图表现。
- 运行配置是 `public/config/` 下英文表头 CSV；桌面原表和归档表不是运行输入。
- 新合成配置在 `public/config/survival/merge/`，复用原棋子表头，`open_cost` 在新模式表示体力；物品使用效果和委托奖励独立配置，不接旧装备奖励。详情见 `docs/implementation/M2-PRODUCTION-SAVE.md`。
- 新模式的物品与订单只通过 Runtime 命令改变。棋盘 / 仓库使用唯一实例 ID；禁止从 React effect 或动画回调扣料、发奖。当前 schema 2 显式迁移兼容的 M2 schema 1；其他不兼容版本拒绝覆盖，保留故障数据。
- M3 蓝图参数在 `src/game/buildingConfig.ts`，内容指纹参与存档兼容性。工程原位预留，到工作位才扣料；开工不可中断且主角 / 当前部件免伤。墙门格边导航由 Runtime 建筑状态派生，Pixi 不持有权威施工或耐久状态。
- 建造交互改为地图材料气泡：满足条件变绿、点击直接安排；缺料点击去合成，不开材料详情子界面。建造 / 修复统一 2 秒，旧 M3 工期按已完成比例迁移，不能清档或重发经验。
- 现运行基线的二级页暂停战斗属于旧游戏行为；新游戏已确认合成期间世界继续运行、离线暂停世界但体力恢复。不要将旧暂停约束误当成新游戏设计。
- 修改规则时同步维护新游戏文档；原游戏规则文档保留为迁移基线，避免将计划写成已经实现。
- 功能代码变动后执行 `npm run build`，按改动范围运行 `npm test`（规则）与 `npm run test:e2e`（浏览器）或检查实际交互；仅文档变动无需机械重复构建。浏览器测试首次需要 `npx playwright install chromium`；不要宣称未执行的验证通过。
- 文件使用 UTF-8。PowerShell 读取中文文本时显式使用 `-Encoding UTF8`，不要将控制台误解码当作源文件损坏。
- 保持本地 `.local/` 档案不进入版本管理；项目协作资料放 `docs/`。
