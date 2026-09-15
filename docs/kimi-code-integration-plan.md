# Kimi Code 接入与验收

2026-09-16：已实现插件、预装发行和 Desktop 接入；本机验证版本为 Kimi Code 0.42.0。

## 协议与边界

使用新版 Kimi Code 原生 Server REST API + WebSocket，支持 0.42.x。旧 Python kimi-cli 不作为兼容依赖。原生实验接口升级后需要重新核验版本与响应结构。

每个活动会话运行独立的回环服务，传递该 Thread 的完整环境；只读模型和账户发现使用独立服务。仅管理 Adapter 自己启动的进程。鉴权令牌保留在后端，不进入 Renderer 或日志；不改写用户全局配置。

Host Runtime 通过插件公共契约加载，发行清单位于 `scripts/release/harness-plugins.json`。Renderer 复用公共路由、账户、模型隐藏与会话导入功能。

## 能力和限制

| 能力 | 实现 |
| --- | --- |
| 流式回复、工具状态 | 原生 WebSocket 通知配合活动回合 Transcript 增量读取，历史复用同一投影 |
| Edit Diff | 原生按轮次保存的文件历史生成文本新增、修改、删除 Diff；跳过二进制、超限及未记录内容 |
| 提问、审批、取消 | 原生问题选择/自由输入、允许一次/会话允许/拒绝、abort；不自动代答 |
| Model / Thinking | 从原生目录读取模型及 Effort，仅保留一套 Effort 选择器 |
| 权限 | Agent/Plan 与 manual/yolo/auto 分组展示，发送时通过 profile 应用 |
| 子 Agent | 原生子任务状态、结果、历史；跨 Harness 复用公共委派环境 |
| Usage | 原生输入、输出、缓存 Token 和上下文；账户订阅额度独立展示 |
| Fork、修订上一条消息 | 原生 Fork 副本后按目标轮次 Undo，核对历史前缀；不回滚文件，不能跨目录或越过原生压缩撤回边界 |
| 压缩、斜杠命令 | `/compact` 等待原生完成事件后结束；不宣称支持其他 TUI 命令 |
| 导入 | 原生会话列表，验证 ID/cwd 后恢复；跨进程活动未知时保留未知状态 |
| 模型隐藏 | 复用前端持久化偏好，不修改原生模型目录 |

当前模型均声明 always_thinking，因此不增加独立关闭按钮。Highspeed 和 256k 保留原生模型身份，不伪造 Fast 或上下文参数。

## 前端交互

选择模型、Effort 或权限先更新前端待发送配置；发送时将完整配置应用到原生会话，不因每次选择而重启进程。权限选择按 Host、会话和 Harness 保存到本地，切换会话或重启后恢复；已有会话的下一次发送同样携带当前权限。使用稳定 prompt_id，并在发送响应丢失时查询原生是否已接受，避免重复执行。

原生 profile 更新后重新订阅该会话事件，避免代理重建后漏掉子任务或压缩通知。活动回合通过 Transcript 读取补齐事件；当前未实现 WebSocket 通用断线重连，压缩通知丢失会超时报告失败。

权限菜单使用可区分的图标：Agent 为终端、Plan 为清单、需要审批为手掌、按需审批为问号盾牌、自动执行为闪电。模型子菜单同底对齐，只有一套 Effort 控件。

## 已执行验证

- 类型检查、lint/边界检查通过；最终 Adapter、插件加载、Renderer 定向测试 116 项通过，启动脚本测试 15 项通过。
- 原生真实回合：文本流、Bash 工具审批、问题回答、取消后继续、关闭恢复后继续。
- 工具进程读取到当前会话注入的环境变量。
- 原生子 Agent 执行、父任务完成、子任务历史读取；公共 `/compact` 完成。
- 真实 Desktop 跨 Harness 链路：Kimi → Qoder → Kimi；Qoder 通过公共 CLI 创建 Kimi 子会话并向同一会话续发，两轮分别返回验收标记，父任务关系由 Host 自动推断。Pi 默认模型因余额/订阅错误（402）失败，未计为通过。
- Fork、指定前缀派生和撤回副本最后一轮。
- 原生 Write/Edit 后从轮次文件快照恢复 Diff。
- Desktop 实际选择 Kimi、创建 Thread、发送并收到 `KIMI_DESKTOP_OK`；新版菜单确认无重复 Thinking，子菜单同底对齐，审批图标区分生效。
- 发行插件从 Workspace 外的独立目录加载，确认无源码路径依赖。
- Desktop 重启后原会话及隐藏模型偏好保留；账号页实际显示周额度和 5 小时额度。修正启动脚本误将 Resources 内独立工具进程识别为 Desktop 的问题。

以上覆盖已列的成功路径，不代表所有故障场景均经过实机测试。跨 Harness 已验证 Kimi/Qoder 双向路径；其他 Harness 组合、多进程同时修改同一原生会话、所有权限组合的每种工具行为尚未完成完整实机组合测试。原生账户当前没有额外额度样本，不推断未知字段。

## 依据

- [Kimi Code Server API](https://moonshotai.github.io/kimi-code/en/reference/server-api.html)
- [原生命令](https://moonshotai.github.io/kimi-code/en/reference/slash-commands)
- [原生配置](https://moonshotai.github.io/kimi-code/en/configuration/config-files)
- 本机 0.42.0 的 OpenAPI、模型/账户响应、真实会话及文件历史结果。
