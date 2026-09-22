<div align="center">

# CodexHost

**在 Codex Desktop 中运行 Pi 和其他 Harness**

我们认为 **Codex Desktop** 提供了目前最好的桌面开发体验

但 **Codex** 并不是唯一优秀的 **Agent Harness**，还有 **Claude Code**、**Pi**

**CodexHost** 让你在 **Codex Desktop** 中原生使用其他 **Harness**，并让它们协作完成任务

⭐ 如果这个项目对你有帮助，请给我们一个 Star！⭐

<p>
  <a href="https://pi.dev/"><img alt="Pi" src="https://img.shields.io/badge/Pi-000000?logo=pi&logoColor=white" /></a>
  <a href="https://openai.com/codex/"><img alt="Codex" src="../imgs/badge-codex.svg" /></a>
  <a href="https://code.claude.com/docs/en/quickstart"><img alt="Claude Code" src="https://img.shields.io/badge/Claude_Code-D97757?logo=claudecode&logoColor=white" /></a>
  <a href="https://opencode.ai/docs/"><img alt="OpenCode" src="../imgs/badge-opencode.svg" /></a>
  <a href="https://grok.com/"><img alt="Grok" src="https://img.shields.io/badge/Grok-000000?logo=x&logoColor=white" /></a>
  <a href="https://github.com/can1357/oh-my-pi"><img alt="Oh My Pi" src="../imgs/badge-omp-v5.svg" /></a><br />
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="DeepSeek Harness" src="https://img.shields.io/badge/DeepSeek_Harness-4D6BFE?logo=deepseek&logoColor=white" /></a>
  <a href="https://antigravity.google/product/antigravity-cli"><img alt="AGY" src="../imgs/badge-agy.svg" /></a>
  <a href="https://kiro.dev/docs/cli/"><img alt="Kiro CLI" src="../imgs/badge-kiro.svg" /></a>
  <a href="https://www.codebuddy.cn/home/"><img alt="CodeBuddy" src="../imgs/badge-codebuddy.svg" /></a>
  <a href="https://www.workbuddy.ai/docs/workbuddy/Quickstart"><img alt="WorkBuddy" src="../imgs/badge-workbuddy.svg" /></a>
  <a href="https://cursor.com/docs/cli/overview"><img alt="Cursor" src="../imgs/badge-cursor.svg" /></a>
  <a href="https://hermes-agent.nousresearch.com/docs"><img alt="Hermes" src="../imgs/badge-hermes.svg" /></a>
  <a href="https://qoder.com/cli"><img alt="Qoder" src="../imgs/badge-qoder.svg" /></a>
  <a href="https://moonshotai.github.io/kimi-code/en/"><img alt="Kimi Code" src="https://img.shields.io/badge/Kimi_Code-171717" /></a>
</p>
<br />

<p align="center"><a href="https://github.com/BytePioneer-AI/codex-host/releases"><strong>下载</strong></a> · <a href="#跨-agent-协作">跨 Agent 协作</a> · <a href="#远程连接-harness">远程连接</a> · <a href="#加入交流群">交流群</a> · <a href="../../README.md">English</a> · <a href="README.ko.md">한국어</a></p>

<br />

</div>

## 界面预览

无需切换应用，**Pi、Claude Code、Grok Build 等十余个 Harness** 都可以在同一个 Codex Desktop 窗口中直接使用。

https://github.com/user-attachments/assets/c48192d7-23ff-4f6e-b61a-6345a655bb76

### 界面

<div align="center">
  <img width="90%" src="../imgs/codexhost-interface-overview.png" alt="Pi、Claude Code、OpenCode、Oh My Pi、Grok Build 和 DeepSeek Harness 作为独立 Thread 运行在 Codex Desktop 中">
</div>

## 快速使用

**方式一：npm**（macOS / Windows / Linux）

```bash
npm install -g @codexhost/cli
codexhost
```

**方式二：安装包**（macOS / Windows）

从 [Releases](https://github.com/BytePioneer-AI/codex-host/releases) 下载对应平台的安装包。

> Linux 支持 x64 / ARM64，详见 [Linux 说明](../platforms/linux/linux.zh-CN.md)。

<details>
<summary>安装问题排查</summary>

**macOS：首次打开提示「应用无法验证」**

```bash
xattr -dr com.apple.quarantine /Applications/codexhost.app
```

**Windows：使用绿色解压版 Codex Desktop**

1. 将 `CODEXHOST_INSTALL_ROOT` 设置为 Codex Desktop 的解压目录：

   ```powershell
   [Environment]::SetEnvironmentVariable("CODEXHOST_INSTALL_ROOT", "D:\CodexPortable", "User")
   ```

2. 完全退出 Codex Desktop，重新打开终端，再运行 `codexhost`。

</details>

### 交互展示

<table>
  <tr>
    <td colspan="2" valign="top">
      <p><strong>完整工作界面</strong></p>
      <div align="center">
        <img width="90%" src="../imgs/codexhost-full-workspace.png" alt="Codex Desktop 中 codexhost 的完整工作界面，展示项目结构、对话区域和多个 Agent 选择器">
      </div>
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <p><strong>剩余额度显示</strong></p>
      <img src="../imgs/grok-usage-limits.png" alt="五小时与七天窗口的剩余额度和重置时间">
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <p><strong>Mermaid 图表可视化渲染</strong></p>
      <div align="center">
        <img width="90%" src="../imgs/codex-vs-pi-agent-tui.png" alt="Pi + Codex Desktop 与 Pi Agent TUI 的 Mermaid 图表可视化渲染对比">
      </div>
    </td>
  </tr>
</table>

## 模型与设置

点击右上角 **CodexHost** 打开设置。先在“连接”中检查本机 Harness 的安装与登录状态，再从输入框选择 Harness 和模型。

### 模型选择与隐藏

“设置 → 模型”支持 **Pi、Qoder、Cursor、Grok、Kimi Code**：可以搜索模型、逐个显示或隐藏，也可以一键全部隐藏、全部显示。隐藏仅影响 CodexHost 的模型菜单，不删除原生配置，也不改变已有会话；偏好在正常退出、重新启动及重新构建后保留。

模型目录来自当前 Harness 的原生接口或配置。原生新增模型后，通过目录刷新获取，不维护另一份固定模型清单。

- **Cursor**：按 ACP 返回的配置提供 Fast、Thinking、Context、Effort 等选项；仅展示当前模型实际提供的参数。
- **Kimi Code**：模型与 Effort 使用原生目录，只显示一套思考强度选择器。Highspeed、256k 等保留为原生模型选项。
- **交互**：模型、参数和权限选择先更新前端待发送配置，真正发送时应用到会话；首次发现模型或恢复原生会话仍可能需要等待。

### 权限与 Pi 扩展

执行模式和审批方式分组展示，选项取决于 Harness 原生能力。Kimi Code 支持 Agent / 计划模式，以及需要审批 / 按需审批 / 自动执行；使用不同图标区分。

Pi 用户可在“设置 → 模型”安装专用工具审批扩展或 Codex Fast 扩展。页面显示安装状态，扩展用于新会话，不修改 Pi 全局配置。Fast 仅对受支持的 Codex 模型提供，默认关闭。

### 账号额度与会话导入

“设置 → 账号”按原生返回的窗口显示额度，不固定为 5 小时或 7 天：Cursor 显示 Auto / API 月额度，Qoder 显示套餐 Credits 和可用的共享资源包，Kimi Code 显示订阅额度及刷新时间。账户额度与单次会话 Usage 分开，不互相换算。

“设置 → 会话导入”支持已接入的原生会话来源，包括 Pi、Qoder、Grok、Cursor 和 Kimi Code。本地未安装或在连接页隐藏的 Harness 不显示为可选来源。导入保留原项目路径与原生会话身份；运行状态未知时，应先在原生客户端关闭该会话，避免同时写入。

Kimi Code 适配新版 **Server API（backend v2）**，已在 0.42.x 与 0.43.x 上验证，不兼容旧 Python kimi-cli；详细实现、验证范围和限制见 [Kimi Code 接入与验收](../kimi-code-integration-plan.md)。本节和下表描述当前源码能力，安装包是否包含这些功能取决于发行版本。

## 功能状态

每个 Harness 都能使用 Codex Desktop 原生的 Edit Diff、Fork、消息修订和斜杠命令。

<details>
<summary>查看完整功能矩阵</summary>

| 能力 | <a href="https://pi.dev/"><img alt="Pi" src="https://img.shields.io/badge/-000000?logo=pi&logoColor=white" /></a> | <a href="https://github.com/can1357/oh-my-pi"><img alt="Oh My Pi" src="../imgs/harness-icon-omp-v5.svg" /></a> | <a href="https://code.claude.com/docs/en/quickstart"><img alt="Claude Code" src="https://img.shields.io/badge/-D97757?logo=claudecode&logoColor=white" /></a> | <a href="https://opencode.ai/docs/"><img alt="OpenCode" src="../imgs/harness-icon-opencode.svg" /></a> | <a href="https://grok.com/"><img alt="Grok" src="https://img.shields.io/badge/-000000?logo=x&logoColor=white" /></a> | <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="DeepSeek Harness" src="https://img.shields.io/badge/-4D6BFE?logo=deepseek&logoColor=white" /></a> | <a href="https://antigravity.google/product/antigravity-cli"><img alt="AGY" src="../imgs/harness-icon-agy.svg" /></a> | <a href="https://www.codebuddy.cn/home/"><img alt="CodeBuddy" src="../imgs/harness-icon-codebuddy.svg" width="24" height="24" /></a> | <a href="https://www.workbuddy.ai/docs/workbuddy/Quickstart"><img alt="WorkBuddy" src="../../packages/adapters/workbuddy/assets/icon.svg" width="24" height="24" /></a> | <a href="https://cursor.com/docs/cli/overview"><img alt="Cursor" src="../imgs/harness-icon-cursor.svg" /></a> | <a href="https://hermes-agent.nousresearch.com/docs"><img alt="Hermes" src="../imgs/harness-icon-hermes.svg" /></a> | <a href="https://qoder.com/cli"><img alt="Qoder" src="../../packages/adapters/qoder/assets/icon.svg" width="28" height="28" /></a> | <a href="https://moonshotai.github.io/kimi-code/en/"><img alt="Kimi Code" src="../../packages/adapters/kimi-code/assets/icon.svg" width="24" height="24" /></a> |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 流式回复 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 工具状态 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit Diff | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅¹ |
| 提问 / 取消 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Model / Thinking 选择 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² |
| 工具审批 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 权限模式 | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Agent 间任务协作 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅³ |
| Usage | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅⁴ |
| Fork | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅⁵ |
| 上下文压缩 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| 斜杠命令 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅⁶ |
| 修订上一条消息 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅⁵ |


¹ Kimi Edit Diff 使用原生按轮次保存的文件历史，支持文本文件新增、修改和删除；二进制、原生超限或未记录的内容不生成猜测 Diff。

² Kimi 的思考强度通过 **Effort** 控制，只显示一套选择器；可用值来自当前模型。Highspeed、256k 是原生模型选项，不伪造独立 Fast 或上下文开关。

³ Kimi 支持原生子 Agent 的状态、结果和历史读取。跨 Harness 委派使用公共 Host 路径；与原生子 Agent 是不同能力。

⁴ Kimi 会话 Usage 展示原生输入、输出、缓存 Token 和上下文用量；账号页显示原生订阅额度和刷新时间，不将订阅额度换算成会话花费。

⁵ Kimi Fork 保留截至指定轮次（含该轮次）的完整前缀；修订上一条消息先派生副本，再撤回副本的最后一轮。两者不回滚工作区文件。

⁶ Kimi 接入 `/compact`；Qoder 仅开放当前原生 Headless 接口可执行的命令，不把 TUI 专用命令标成可用。

</details>

## 跨 Agent 协作

你可以让当前 Agent 把独立任务交给另一个 Harness。例如：

> 让 `claude-code` 独立审查这次修改，并指出兼容性风险。
>
> 让 `pi` 调查这个测试为什么偶发失败。
>
> 让 `omp` 实现这个功能，我继续整理文档。
>
> 让 `opencode` 在独立 Thread 中验证这个修复，并运行相关测试。

CodexHost 会为目标 Harness 创建独立的 Native Session。委派会话将出现在 Codex Desktop 的会话列表中，你可以随时打开、查看进度或继续对话。

<details>
<summary><h3 id="远程连接-harness">远程连接 Harness</h3></summary>

在本机 Codex Desktop 中使用被控机器上的 Harness，任务在被控机器执行，界面仍在本地。两端需安装相同版本的 codexhost。

| 被控机器 | 连接方式 |
| --- | --- |
| macOS / Linux | [SSH 远程](#ssh-远程) |
| Windows | [Remote Control 远程](#remote-control-远程实验)（实验） |

#### SSH 远程

前提：已在 Codex Desktop「设置 → 连接 → SSH」中添加被控机器。客户端支持 macOS / Linux / Windows。

<div align="center">
  <img width="70%" src="../imgs/remote-ssh-connections.png" alt="Codex Desktop 设置 → 连接 → SSH 页面中已添加的 SSH 连接">
</div>

1. 在被控机器上安装并启动：

   ```bash
   npm install -g @codexhost/cli
   codexhost remote install
   codexhost remote start
   codexhost remote status
   ```

2. 在本地通过 codexhost 启动 Codex Desktop，打开 SSH 工作区。
3. 在输入框的 Agent / Model 选择器中选择目标 Harness。

[SSH 配置、诊断与卸载 →](../platforms/remote/remote-ssh-host.zh-CN.md)

#### Remote Control 远程（实验）

复用 Codex Desktop 官方 Remote Control 的配对与认证，在另一台电脑上使用 Windows 上的 Harness。

前提：官方 Remote Control 已能正常运行 Codex 任务。不新增公网服务或端口，Harness 凭据只保留在 Windows 上。

[Remote Control 配置、传输边界与诊断 →](../platforms/remote/remote-control-host.zh-CN.md)

</details>

<details>
<summary><h3>怎么做的</h3></summary>

多数「多 Agent 客户端」会自己重做一套聊天界面，再用统一协议接入不同 Harness。

CodexHost 的做法不同：

- **Desktop 侧**：通过 CDP / Electron Inspector 增强官方 Codex Desktop，不重做聊天界面，也不修改官方安装包
- **协议侧**：通过 CLI Shim 接入官方 app-server，原生 Codex 请求原样转发，不受影响
- **Harness 侧**：优先使用各自的原生接口（Pi 走 RPC，Claude Code 走 Agent SDK），没有原生接口的通过 [ACP](https://agentclientprotocol.com/) 接入；流式输出、工具状态、Diff、审批和提问统一投影到 Codex Desktop 的原生界面
- **编排侧**：委派任务在目标 Harness 中作为独立的原生会话运行，发起方可以选择等待结果或让它在后台运行

</details>

## 加入交流群

<table align="center">
  <tr>
    <td>
      <strong>加入交流群</strong><br />
      <sub>对 CodexHost 用法、功能感兴趣的开发者可以扫码加入微信群交流。</sub>
      <ul>
        <li><sub>安装问题可以加群询问</sub></li>
        <li><sub>功能建议与反馈</sub></li>
        <li><sub>开发问题讨论</sub></li>
        <li><sub>Bug 问题建议提交 <strong>issue</strong></sub></li>
      </ul>
      <sub><strong>欢迎一起贡献~ </strong></sub>
    </td>
    <td align="center">
      <img width="230" alt="7ba6eda891ba4c8d091f2a71a8b8e81d" src="https://github.com/user-attachments/assets/0e3c7269-c0c5-4f62-984a-f78b59166d6d" />
    </td>
  </tr>
</table>

## 开发

提交 Issue 或 PR 前可阅读[贡献说明](../../CONTRIBUTING.md)；PR 标题标签、简短 CI 结果和发布前校验见[仓库维护自动化](../operations/repository-maintenance.md)。

环境要求：官方 Codex Desktop、Node.js 22.19+ 或 24、Rust。

```bash
git clone https://github.com/BytePioneer-AI/codex-host
cd codex-host
npm ci
npm start
```

### 运行架构

以 Pi 为例。从左到右是一次请求的调用链：Desktop → 公共层 → Pi 插件 → 原生进程。

<div align="center">
  <img width="100%" src="../imgs/pi-runtime-architecture.png" alt="以 Pi 为例的运行架构：Desktop 到公共层，再到 Pi 插件和原生进程">
</div>

### 新增 Harness

主要实现插件的 Manifest、工厂、Adapter、Session 及原生通信与转换逻辑。当前 Renderer 仍有静态接线，完整 Desktop 接入还需单独处理。
新增 Harness 时，可以让编码 Agent 使用仓库内的 [codexhost-add-harness Skill](../../.agents/skills/codexhost-add-harness/SKILL.md)。它说明了插件结构、公共 Adapter 接口、能力实现与测试要求。

## 鸣谢

- 感谢 [LINUX DO](https://linux.do/) 社区一直以来的支持。
- 感谢 [Paseo](https://github.com/getpaseo/paseo) 项目在多 Harness 接入思路与架构设计方面带来的启发与参考。

## Star History

<a href="https://www.star-history.com/?repos=bytepioneer-ai%2Fcodex-host&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=bytepioneer-ai/codex-host&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=bytepioneer-ai/codex-host&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=bytepioneer-ai/codex-host&type=date&legend=top-left" />
  </picture>
</a>
