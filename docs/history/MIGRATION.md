# TitanDemo → WordMerge 迁移记录

日期：2026-09-28。此记录描述开发上下文迁移，不代表已完成新游戏玩法改造。

## 来源与基线

| 项目 | 位置 / 版本 |
|---|---|
| 原工程 | `D:/OtherProject/TitanDemoGithub/TitanDemo` |
| 当前工程 | `D:/OtherProject/TitanDemoGithub/WordMerge` |
| 原工程提交 | `ff54eba1c406241f7b495b561ee8c551ca628102`，master，共 18 次提交 |
| 拷贝工程初始提交 | `31fa67a041c508ae3de2cf9cddca5cc2e65ecaca`，独立历史 |
| 更早会话目录 | `D:/OtherProject/TitanDemo/TitanDemo/src` |
| 原始策划附件 | `C:/Users/cf/Desktop/合成文档` |
| OpenCode 数据 | 当前用户本地 `~/.local/share/opencode/opencode.db`，只读查询 |

开始时两个工程工作区均无未提交修改，93 个原工程跟踪文件逐字节一致。原工程没有项目内 AGENTS、skill 或完整游戏文档，只有根 README 和美术包 README。因此此次 skill 与大部分 Markdown 是基于实际材料新整理，并非伪称复制已有文件。

## 交付清单

| 内容 | 位置 | 是否随正常 Git 提交 |
|---|---|---|
| 新工程入口与协作规则 | 根 `README.md`、`AGENTS.md` | 是 |
| 规则、架构、经验、新游戏记录 | `docs/` | 是 |
| 项目经验 skill | `.agents/skills/wordmerge-development/SKILL.md` | 是 |
| 原根 README 原件 | [TITAN-README.original.md](TITAN-README.original.md) | 是 |
| 原策划图 5 张、CSV 5 份 | [original-design/](original-design/README.md) | 是 |
| 需求演变、会话索引、原 Git 日志 | 本目录 Markdown、[titan-git-log.txt](titan-git-log.txt) | 是 |
| 来源、哈希及数量清单 | [migration-manifest.json](migration-manifest.json) | 是 |
| 完整可见文本档案 | `.local/titan-migration/opencode/`，JSON + Markdown | 否，本地忽略 |
| 原仓库完整 Git bundle | `.local/titan-migration/TitanDemo.bundle` | 否，本地忽略 |
| 本次一次性导出脚本 | `.local/titan-migration/archive.py` | 否，本地忽略 |

“随正常 Git 提交”表示文件未被忽略、可纳入版本管理，本次未代做 commit 或 push。

## OpenCode 档案边界

按原工程及更早 TitanDemo 的完整目录路径匹配，含子目录与子会话，共 11 个会话、559 条数据库消息，其中 456 条含导出的可见用户 / 助手文本。

未复制 OpenCode 数据库、账号认证、provider 配置、推理、工具输入输出或内嵌图片。部分用户消息中的 `[Image 1]` 只保留文字标记；找回的 10 份策划原件单独归档，不能视为恢复了全部历史截图。

这是独立的可读历史档案，不是 OpenCode 会话导入包，也没有篡改原会话的项目归属。短问候会话仍按项目归属保留，未用作需求依据。

在当前仓库检索原话示例：

```powershell
rg -n '生成器|装备替换|存档' .local/titan-migration/opencode -g '*.md'
```

## Git 历史恢复

新仓库维持自己的提交历史；原历史以完整 bundle 留存，没有覆盖当前 `.git` 或修改远程仓库配置。

```powershell
# 在 WordMerge 根目录验证历史包
git bundle verify .local/titan-migration/TitanDemo.bundle

# 需要查阅全部旧提交时，克隆到一个尚不存在的本地目录
git clone .local/titan-migration/TitanDemo.bundle .local/TitanDemo-history
git -C .local/TitanDemo-history log --oneline
```

跨机器迁移时，普通 Git clone 不包含被忽略的 `.local/`。需要带走完整对话与旧 Git 历史时，另行复制 `.local/titan-migration/`。

## 核验记录

- 开始前确认 93 个跟踪文件与原工程字节一致。
- 10 份策划附件复制后 SHA-256 一致；原 README 按原件保留。
- `git bundle verify` 通过，包含完整历史与 4 个 refs。
- `npm ci --no-audit --no-fund` 成功，按原 lockfile 安装 68 个包。
- `npm run build` 通过：TypeScript 编译及 Vite 5.4.21 构建成功，转换 92 个模块；输出到本工程 `dist/`。
- `python -X utf8 .../skill-creator/scripts/quick_validate.py .agents/skills/wordmerge-development` 通过。Windows 默认 GBK 会误读 UTF-8 中文 skill，使用 Python UTF-8 模式完成校验，未修改验证器或文件编码。
- 检查 13 份 Markdown、44 处本地链接，全部目标存在，无 Unicode 替换字符；历史 JSON 数量与哈希、Git bundle 哈希一致。
- 收尾再次比对原工程 93 个文件：原工程无改动；新工程原有文件中仅 `.gitignore` 与根 README 不同，其余新增内容为资料与项目 skill。
- `git diff --check` 通过。本次未执行完整浏览器交互回归；构建通过不代表所有旧游戏行为均已重新试玩。

迁移清单中的文件哈希记录于补充 `.gitignore` 后、重写 README 前，因此 `.gitignore` 的目标哈希不同是预期。运行源码、正式 CSV、美术资源和包配置保持原版；原工程与桌面资料未改写。
