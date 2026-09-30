# WordMerge

基于 TitanDemo 拷贝建立的新游戏工程，已开始分阶段开发。方向为二合、女性向、轻度生存、建造、剧情与装扮的竖屏游戏，首个版本优先手机浏览器 H5；`WordMerge` 暂作工程名，正式名称待定。

新游戏已完成 M1–M3：等距营地、点击寻路、触控镜头、7×9 合成棋盘、仓库与委托、体力恢复、本机存档，以及图纸放置到分部件施工的建造闭环。开发入口为 `/?game=survival`，默认 `/` 仍为原版 Demo。两种模式互斥运行。持续生存消耗、夜袭、伙伴与正式剧情将在后续阶段接入。

营地底部“合成物资”打开工坊；单击生成器，拖动相同物品合成，仓库中也能直接使用补给。合成时营地继续运行；离线只恢复体力。自然恢复上限 100，道具可突破。进度自动保存，备份导入 / 导出在“探索指引 → 本机存档”。

“营地建设 → 放置图纸”开始建造：材料直接显示在地图气泡中，缺料时点击去合成，满足条件变绿后点击直接建造。主角到达后扣料，建造 / 修复统一 2 秒；开工不可中断且主角与当前部件无敌。后台暂停施工，旧 M2 / M3 存档自动迁移。详见 [M3 试玩与规则](docs/implementation/M3-CONSTRUCTION.md)。

## 启动

建议使用 Node.js 24 LTS；当前验证环境为 Node.js 24.14.1、npm 11.11.0。

```sh
npm ci
npm run dev
```

打开终端显示的地址并加上 `/?game=survival`（默认 `http://localhost:5173/?game=survival`）。手机调试可在可信局域网内使用 `npm run dev -- --host 0.0.0.0`，手机访问电脑局域网 IP 对应的地址。构建与预览：

```sh
npm run build
npm run preview
```

生产输出目录为 `dist/`。运行验证：

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

规则测试使用 Vitest 与 fake-indexeddb；浏览器测试自动在 `127.0.0.1:5178` 启动服务，覆盖触控、暂停、合成 / 仓库、刷新与存档异常恢复，并回归旧入口。详情见 [M1 地图记录](docs/implementation/M1-MAP.md)与 [M2 合成 / 存档记录](docs/implementation/M2-PRODUCTION-SAVE.md)。

## 开发入口

- [文档导航](docs/README.md)：资料地图和阅读顺序。
- [新游戏改造记录](docs/NEW-GAME.md)：当前范围、待定设计及下一阶段入口。
- [新游戏已确认规则](docs/design/CORE-RULES.md)：当前策划共识、待试玩数值及已替代方案。
- [技术实现方案](docs/TECHNICAL-PLAN.md)：H5 技术路线、地图与逻辑架构、存档、配置及实施阶段。
- [现有游戏规则](docs/GAME-BASELINE.md)：基于当前代码核对的原游戏规则。
- [工程与配置说明](docs/DEVELOPMENT.md)：模块入口、CSV、SVG、启动和验证方式。
- [开发经验](docs/LESSONS.md)：历史返工原因、需保留的实现约束。
- [迁移记录](docs/history/MIGRATION.md)：来源、核验、Git 历史与 OpenCode 档案。
- [项目协作规则](AGENTS.md)与 [wordmerge-development skill](.agents/skills/wordmerge-development/SKILL.md)。

原策划图和表格已复制到 [docs/history/original-design](docs/history/original-design/README.md)。它们是历史参考，正式运行配置位于 `public/config/`。

OpenCode 可见对话档案和原仓库 Git bundle 存在本地 `.local/titan-migration/`，已忽略、不随普通 Git 提交迁移。跨机器迁移时请单独复制此目录；可共享的整理文档及原始策划附件在 `docs/`。
