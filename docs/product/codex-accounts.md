# 账号与额度设置

在 codexhost 的「设置 → 账号」查看当前 Codex 身份与额度，以及其他 Harness 的 `inspectAccount()` 快照。CodexHost 不管理多个原生 Codex 登录：不提供添加/登录/切换/退出/删除/恢复，也不消耗重置卡。官方 Desktop 登录与退出仍由官方后端处理。用户可以显式确认，将兼容的本地授权一次性复制到 Pi 的独立 Provider 配置；这是对原先全页只读边界的有限扩展，不建立 Host 凭据库，也不改变原生登录。

本地 `.codexhost-native-accounts` 文件若仍存在，启动和刷新都不会读取、改写或回收。

## 账号列表

页面只有「账号 / 剩余 / 管理」表格，不再在下方重复列出「Pi 中的账号」或「Pi 自有配置」。额度列把 5 小时、7 天和其他产品窗口放在同一格里并排展示，每个窗口的名称在左、百分比在右。提供方给出已用、上限和单位时，进度条下显示具体数量。预付费余额没有额度百分比，改显示金额和币种。管理列对 Codex 提供逐行「刷新额度」，并在有重置卡时放「重置卡 N 张」；其他 Harness 显示「原生管理」。连接页「常用」列表决定哪些 Harness 出现以及先后顺序，放进「更多」的 Harness 不出现在账号表。窄窗口下每个账号独立排列；额度窗口在额度列内并排，最窄布局再纵向堆叠。视觉沿用原设置外壳：无边框搜索、工具栏上的全局额度刷新。所有账号行统一使用各自的产品 Logo。工具栏的「账号」数量包含当前 Codex 账号和连接页常用列表中的其他 Harness 账号，不随搜索筛选改变。

- 主标题显示完整邮箱或账号名称，单行省略并可悬停查看完整身份；Agent 名称、真实套餐与「Codex 当前」标记作为次级信息，不显示本地 `CODEX_HOME` 路径。
- 搜索按邮箱、账号名称、Agent 或套餐筛选整个列表，仅在两类账号都不匹配时显示一个空状态。Codex 按 Host 返回顺序在前；其他 Harness 按连接页「常用」列表的顺序排列，放进「更多」的不显示。不按剩余额度或当前状态重排。
- 5 小时与 7 天额度在同一额度列中并排比较。两侧都有时，5 小时在左、7 天或周额度在右。同一账号只有一个模型组的 5 小时窗口时，账号级周额度与它排在同一行。没有 5 小时、只剩 7 天或周额度时，这一条铺满额度列。缺少的窗口不补成已用 0% 或剩余 100%。窗口名称保持单行：周期在前，模型组名称过长时末尾省略，悬停可看全名。月额度、套餐和资源包等没有 5 小时/7 天列的额度按出现顺序并排，两列等宽。上限为 0 的套餐显示 `0 / 0` 和空进度条，不显示剩余 100%。身份列去掉已经画在进度条上的窗口后缀。重复报告保持分开，不合并。
- 默认按「剩余」展示，也可切换为「已用」，表头同步说明口径。进度条和数字使用相同口径，风险颜色仍按已用比例判断：70% 起警示，90% 起强调。
- 每个窗口在百分比旁显示弱化的倒计时，最多两个单位：超过一天为 `6d17h`，不足一天为 `4h54m`，不足一小时为 `14m`。下方右对齐显示本地时间 `09/15 10:08`；悬停和辅助技术可读取包含年份、时区的完整重置时间。无有效重置时间时不编造日期或倒计时。
- 页面本地每分钟及重新获得焦点时更新倒计时，不重新查询 Host、不重建账号行。到点只显示「待刷新」，不会自动把额度设为 100%；关闭设置后停止计时。
- Codex 当前额度来自官方 `account/rateLimits/read`。加载、读取失败、暂无数据分别展示；失败可重试，未知数据不按 0% 处理。页面关闭后的响应不会更新页面。
- Codex 套餐类型来自官方当前身份。`prolite` 按当前产品对应关系高亮显示为 Pro 5x，`pro` 高亮显示为 Pro 20x；Plus、Team 等保持普通标签，`unknown` 不显示。5x/20x 是展示层映射，不改变协议原值。官方接口不提供订阅续期时间，因此不显示续期日期。

菜单栏 / 任务栏的当前 Codex 额度展示保持现有行为；本次不新增展示面或刷新机制。

## Codex 额度与外部 Harness 发送

ChatGPT 登录的 Codex 订阅额度耗尽时，Desktop 在 Renderer 中用两道账号级布尔门禁用 Composer 提交：账号额度门和 reserve `hardBlocked`。API Key 登录不经过这两道门。它们是界面上的订阅额度预检，不是协议限制；外部 Harness 的 `turn/start` 由 Host 路由，不会发到官方后端。

因此在单个 Composer 选中外部 Agent、Adapter 就绪且没有 codexhost 自身的提交阻塞时，`renderer-codex-usage-gate.ts` 只把该 Composer 对这两道门的订阅快照投影为 `false`，继续走原生提交链路。不写账号、atom 或额度查询缓存，Codex 额度横幅保持显示；其他 Composer、Codex 路径和空输入、附件、运行中等其他原生限制不受影响。外部 Harness 的真实额度与错误由其自身处理。切回 Codex、Composer 移除或扩展卸载时恢复实时原生结果。

门按其 selector 实际读取的字段识别，不依赖压缩名或 hook 序号；无法唯一识别时保留原生限制，并在 Agent 控件悬停提示中说明。升级后的诊断步骤见 [Desktop 更新兼容性诊断手册](../operations/codex-desktop-upgrade-diagnosis-playbook.md#检查-codex-额度门)。

## 其他 Harness 的只读账号额度

统一列表中展示连接页「常用」里的 Harness 当前原生认证可读取的真实额度。管理列写明「原生管理」，说明登录、退出和切换仍在原生客户端完成。这不是多账号管理：不提供添加、删除、切换、设为默认或重置卡操作，也不修改 Codex 当前账号。搜索和已用/剩余切换作用于所有行，刷新按钮重新查询两类额度。各 Harness 独立并行查询，任一有效结果返回后立即显示，不等待其他 Harness；全局刷新期间同样逐项恢复。

- 仅在返回有效额度窗口时显示账号。API Key、第三方 Provider、未登录、无可用数据或查询失败时不显示占位行。Host 按 Harness 缓存完成的账号检查结果 15 秒，关闭后立即重开设置页可复用该短期结果；工具栏「刷新额度」显式绕过缓存，刷新后不复用上一份账号额度，避免退出或改变认证后展示旧账号。
- 左侧展示各 Harness/供应商的产品 Logo；主标题优先显示邮箱或可识别名称，Harness 名称和套餐作为次级信息。没有账号身份时以 Harness 名称为主标题，不重复名称或显示「当前登录账号」，不会猜测邮箱。邮箱按列宽省略，悬停可查看完整身份。不记录或展示账号快照更新时间；原型中的示例套餐不作为真实数据来源。
- Pi 在配置了 DeepSeek API Key 时显示该供应商报告的预付费余额，不编造百分比。`models.json` 里带 API Key 和 base URL 的自定义 Provider 会再向该站点自己的 `GET /v1/usage` 查询 sub2api 钱包或 Key 额度；响应带明确币种的可用金额时各显示一行，币种沿用站点返回值。无限额订阅、请求失败或响应不是该接口形态时不显示该行。Key 只发给用户配置的站点，并且不跟随重定向。这些查询与其他 Harness 一样只在账号页打开和点击「刷新额度」时发生，设置页关闭后不轮询。Qoder 展示套餐 Credits 的已用和上限，以及共享资源包；套餐上限为 0 时显示空额度，不把它画成剩余 100%。Cursor 展示 Auto 与 API 的月度比例。Kimi 展示 coding usages，读取前会刷新过期的原生 access token。
- Grok Build 复用原生 xAI OAuth 认证和 billing 查询，展示周期、重置时间及产品用量。过期的 access token 会先用同一份 refresh token 向原 issuer 换新并写回原生凭据文件，失败则不展示账号。不将其他 issuer 的 Token 发到 xAI。套餐使用比例优先读取 `creditUsagePercent`；省略时按原生规则使用旧版套餐额度 `monthlyLimit` / `used`，没有正数套餐上限但有可识别的周/月周期及有效重置时间时，按原生零用量语义展示已用 0% / 剩余 100%，保留账号行。请求失败、空配置或异常用量字段不补成 0%；不使用 `onDemandCap` / `onDemandUsed` 的按需消费金额替代套餐比例。显式配置 `XAI_API_KEY`、`GROK_API_KEY` 或 `GROK_TOKEN` 时保守地不展示保存的 OAuth 账号。此页展示 Harness 账号额度，不判定某个 Thread 的逐模型凭据或实际 Billing Source。
- agy 执行原生 `--print=/usage --output-format stream-json`，由 CLI 自己解析认证，展示实际模型组与窗口。当前该输出不提供账号邮箱或套餐，以 Harness 名称为主标题。
- Claude Code 使用 Agent SDK 0.3.220 的 `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` 主动查询，并通过 `accountInfo()` 读取身份。仅投影 `rate_limits_available` 为真且有效的套餐窗口，包括原生返回的模型独立窗口；不将 session Token、会话花费或额外用量金额混为额度百分比。当前不展示 `extra_usage` 金额。旧 SDK/CLI 不支持该实验性操作时不展示。
- 查询不需要已有 Thread，不发起 Model Turn；Claude SDK 检查使用空输入流、无工具且不持久化 Session，并在成功、失败、超时后关闭检查进程。Broker 路径转发同一个只读能力。

公共数据链路是 `HarnessAdapter.inspectAccount()` → `codexhost/harness/accounts/sources` / `codexhost/harness/accounts/inspect` → 设置页；旧 Host 仍可回退到聚合的 `codexhost/harness/accounts/list`。渐进式与聚合路由共享同一份按 Harness 的 15 秒缓存和在途请求。账号快照只有可展示身份、套餐与额度，无凭据、原生路径或原始 SDK 对象；Host 不直接依赖具体 Adapter。仅查询当前 Host 已加载插件，单插件失败或超时不会阻断其他账号的返回与展示。

## 手动导入到 Pi

账号页不展示「Pi 中的账号」或「Pi 自有配置」，也不在表格里放导入图标。Pi 自己的 `auth.json` 与 `models.json` 登录只由 Pi 管理。后端仍保留一次性复制兼容授权的契约，当前设置页不提供入口。

- 契约支持的来源仍是经过字段/客户端校验的 Codex 文件型 ChatGPT OAuth 和 Grok xAI OAuth。默认入口名让人能看出账号：某个 Provider 的第一个账号用 `codex` / `grok`，之后的账号用 `codex-<邮箱前缀>`（如 `codex-alice/…`），仍冲突或没有邮箱时用 `codex2`、`codex3`…；Pi 里同一 Provider 可以并存任意多个账号，各占一个入口。名称须为 1–48 位小写字母、数字或连字符，以字母开头。
- 只支持经过字段/客户端校验的 Codex 文件型 ChatGPT OAuth 和 Grok xAI OAuth。API Key、钥匙串型 Codex 登录及 Claude Code 等来源暂不导入；不兼容或目标不可用时不显示图标。来源账号改变后提交旧来源标识会被拒绝，必须重新刷新并确认。
- Pi Adapter 在所配置 Pi 的用户目录（支持 `PI_CODING_AGENT_DIR`）写入独立 `auth.json` 条目和 `extensions/codexhost-account-<name>/` 扩展、非敏感导入记录。通过安装的 Pi 原生认证存储锁协调写入，复用该安装的 OAuth 刷新和模型传输实现。不覆盖内置名称、已有凭证、模型配置或本功能创建的同名入口；名称冲突应换名；导入前通过 Pi 离线模型目录检查已启用扩展注册的可用入口。外部扩展未来也可能注册名称，用户应选择未占用的新名称。
- 当前要求 npm 安装且暴露原生 Provider/AuthStorage 模块的 Pi。生成的扩展引用检测到的安装路径；迁移或删除该 Pi 安装后需修复/重新导入。不安装依赖、不登录、不刷新 token，也不进行收费模型探测。
- 设置页不列出 Pi 原有登录，也不把 `models.json` 里的自定义 Provider 再画一遍。导入记录的所有权规则仍在后端：用户在 Pi 中改写或删除某条导入凭据后，该记录不再属于本功能；本功能不会自动删除遗留的扩展目录。
- 从 Pi 移除前再次确认，仅移除本功能拥有的 Provider 扩展、凭证条目和记录，保留其他配置及用户追加的文件，不退出来源账号、不撤销服务端授权。新建 Pi 会话会启动新的 Pi 进程并读取最新配置，无需重启 codexhost；已打开的会话持有自己的进程，可能仍保留旧配置。当前设置页没有移除入口。
- 复制不是持续同步，也不增加额度。两端自行刷新同一 refresh token 可能互相影响登录；实际 Billing Source 遵循 Provider 规则。“已复制”不表示凭证或模型仍然可调用。“重新导入凭证”也需确认，仅允许同一来源账号更新本功能仍然拥有的入口；来源不是当前登录时不提供。换账号无需移除旧入口，直接为新账号新增一个入口即可，旧账号的入口继续保留。
- 浏览器契约仅包含来源标识、标签、Provider 类型、导入状态，以及其他登录的 Provider 名称、类型、可选的账号标签与识别出的供应商。源 Adapter 的 `credentialExport` 与目标 Adapter 的 `credentialImports` 只在后端交换授权；Codex 原生来源由 Host 的 Codex 模块提供。`codexhost/harness/credential-imports` 不接收 token 或路径，异常不转发 SDK 原始信息。没有跨 Host/SSH 的凭证搬运。

## 重置卡

有重置卡快照时，在 Codex 行的管理列显示「重置卡 N 张」入口，点击可展开最近到期时间以及接口提供的逐张到期清单。没有重置卡数据时不显示入口，也不推断为零张。CodexHost 不提供「使用重置」，也不调用官方消耗接口。额度重置时间与重置卡到期时间是两类独立信息。

## 官方认证

Desktop `account/login/*` 和 `account/logout` 原样交给官方后端。Host 不建立凭据收藏库；仅用户确认的导入写入目标 Harness 自己的存储。不替换 loginId，不重建原生结果。官方认证完成后，设置页可更新当前身份与额度展示。

SSH 维持远端原生单账号，不传输本地凭据。

## 用量浮窗

用量浮窗不重复展示 5 小时和 7 天额度；额度继续由专属额度入口展示。

选择 Codex 时，用量浮窗只读显示当前 Host 的全局账号身份，而不是 Thread 的历史绑定。切换 Host 后跟随相应 Host 的状态。即使尚无 Token 用量，也可查看当前身份；其他 Harness 不显示 Codex 账号。

## 实现与验证

- `docs/product/codex-native-account-switching-design.md`：多账号能力已删除后的只读额度边界。
- `openspec/changes/remove-codex-multi-account/`：删除 Host 多账号管理的产品契约。
- `packages/host-runtime/src/account/codex-account-control.ts`：当前官方身份的只读投影。
- `packages/host-runtime/src/native-account-host.ts`：本地当前身份读取。
- `packages/host-runtime/src/native-account-observer.ts`：原生认证后更新显示身份，不收藏凭据。
- `packages/renderer-extension/src/settings/accounts-page.ts`：身份与额度表格；不挂载 Pi 登录专区。
- `packages/renderer-extension/src/settings/credential-imports.ts`：保留的导入对话框与 Pi 登录列表实现，设置页当前不挂载。
- `packages/adapters/pi/src/pi-credential-imports.ts`：Pi 原生存储和导入配置所有权管理。
- `packages/host-runtime/src/credential-imports.ts`：通过公共 Adapter 契约路由后端凭证转移。
- `packages/renderer-extension/src/settings/accounts-list.ts`：统一账号行与重置卡数量展开。
- `packages/renderer-extension/src/settings/accounts-usage.ts`：额度窗口分列、额外具名额度和重置卡详情。
- `packages/renderer-extension/src/settings/accounts-reset-time.ts`：紧凑重置时间与页面本地倒计时。
- `packages/renderer-extension/src/settings/harness-accounts.ts`：其他 Harness 只读账号查询状态。
- `packages/host-runtime/src/harness-accounts.ts`：公共只读账号聚合与校验。
- `packages/shared-contracts/src/harness-accounts.ts`：浏览器安全的只读快照与请求契约。
- `packages/renderer-extension/src/settings/accounts.css`：明暗主题及窄窗口布局。
- `packages/renderer-extension/test/settings/`：设置页及额度单元测试。
- `tests/e2e/renderer-settings-accounts.spec.ts`：真实设置外壳与真实渲染代码，使用隔离的模拟客户端验证布局和交互；不连接真实账号服务。
