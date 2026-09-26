# Skill 统一管理

设置页的「技能」展示 `~/.agents/skills`，并为不读取该目录的已连接 Harness 建立软链。codexhost 不复制技能，也不在打开页面时创建目录。

## 目录

| Harness | 用户级目录 | 是否需要软链 |
| --- | --- | --- |
| Codex | `~/.codex/skills` | 是，且始终显示 |
| Pi | `~/.pi/agent/skills` | 是 |
| Claude Code | `~/.claude/skills` | 是，但必须已连接。委派技能会写入这个目录，目录存在不能代替连接 |
| Grok | `~/.grok/skills` | 否，原生读取共享目录 |
| Kimi Code | `~/.kimi-code/skills` | 否 |
| Cursor | `~/.cursor/skills` | 否 |
| Qoder | `~/.qoder/skills` | 是。SDK 启动默认不读取 `~/.agents/skills` |
| Antigravity | `~/.gemini/config/skills` | 是 |

声明在 `packages/host-runtime/src/harness-skills.ts` 的 `SKILL_DIRECTORIES`。没有依据的 Harness 不列入。

## 接入

用户明确接入时，如果目标目录还不存在，Host 会创建声明中的那一层目录，再放入指向 `~/.agents/skills/<name>` 的目录软链。解除接入只删除软链；同名真实目录会拒绝删除。源技能已经不存在的断链单独列出，并走同一条解除路径。

Harness 自己的目录里如果已经有同名技能，且它不是指向 `~/.agents/skills/<name>` 的软链，技能行不显示这个 Harness。那份文件不是共享目录里的源文件。

原生读取共享目录的已连接 Harness 不提供接入按钮，页面会说明无需接入。
