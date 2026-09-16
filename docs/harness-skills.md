# Skill 统一管理

Agent Skill 是一个包含 `SKILL.md` 的目录。codexhost 不新增一套自己的 Skill 机制，只做两件事：展示 `~/.agents/skills` 里的共享技能，以及为那些不读这个目录的 Harness 建立软链。

## 各 Harness 的实际行为

`~/.agents/skills` 已经是多个 Harness 共同支持的跨工具约定。是否需要软链，取决于目标 Harness 是否原生读取它。依据来自各 Harness 自身的可执行文件，不是推断：

| Harness | 用户级目录 | 原生读取共享目录 | 依据 |
|---|---|---|---|
| Codex | `~/.codex/skills` | 否 | 二进制中仅 `.codex/skills` 为加载路径，`.agents/skills` 出现在外部 Agent 导入上下文 |
| Pi | `~/.pi/agent/skills` | 否 | `skills.js` 的用户级路径是 `getAgentDir()/skills`；它扫描的 `.agents/skills` 是从工作目录向上走到仓库根的项目级路径 |
| Claude Code | `~/.claude/skills` | 否 | 只读取自身目录 |
| Grok | `~/.grok/skills` | 是 | 内嵌文档：「Grok also scans `.agents/skills/` at each tier」 |
| Kimi Code | `~/.kimi-code/skills` | 是 | `USER_GENERIC_DIRS = [".agents/skills"]` |
| Cursor | `~/.cursor/skills` | 是 | 加载表包含 `.cursor/skills`、`.claude/skills`、`.codex/skills`、`.grok/skills`、`.agents/skills` |
| Qoder | `~/.qoder/skills` | 是 | 设置项 `loadFromAgentsDirectory` 默认开启，加载 `<home>/.agents/skills` |

声明表在 `packages/host-runtime/src/harness-skills.ts` 的 `SKILL_DIRECTORIES`，补充一个来源就是加一行；没有依据的 Harness 不会凭猜测列入。

原生读取共享目录的 Harness 在界面上不提供接入按钮，而是明确说明无需接入——否则会让人误以为功能缺失，也会产生没有作用的软链。

## 可接入的目标

一个 Harness 出现在这一页需要同时满足：

- 在声明表中且 `access` 为 `link`；
- 在连接页显示为已连接。**不能用目录是否存在来判断**：`delegation-skill.ts` 会把委派技能写进 `~/.claude/skills`，因此即便没有安装 Claude Code，这个目录也存在；
- 目录已存在才允许写入。目录不存在说明该 Harness 从未在本机运行过，此时不替它创建目录。

Codex 始终视为存在，不需要连接判断。

## 接入语义

接入是在目标目录下创建一个指向 `~/.agents/skills/<name>` 的软链，不复制内容，源目录始终是唯一副本。

解除接入只删除软链。若目标目录下的同名条目是真实目录而非软链，操作失败——那是用户自己的内容。

源技能被删除后残留的断链会单独列出并标记，复用解除接入的路径清理。

## 契约与所有权

- 契约：`packages/shared-contracts/src/harness-skills.ts`，方法为 `codexhost/harness/skills/inspect` 与 `codexhost/harness/skills/link`。
- 文件系统逻辑：`packages/host-runtime/src/harness-skills.ts`。Host 只返回事实（目录、是否存在、访问方式、技能名称与描述、链接关系），显示名称、图标与可见性由 Renderer 决定。
- 界面：`packages/renderer-extension/src/settings/skills-page.ts`，位于设置的「技能」页。
- 链接操作返回刷新后的完整目录，界面据此重绘，避免本地状态与磁盘不一致。

Skill 存放在用户主目录下，因此该页始终连接本地 Host，即使当前 Thread 由远程 Host 拥有。
