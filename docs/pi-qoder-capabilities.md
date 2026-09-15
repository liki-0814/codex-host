# Pi approval extension and Qoder native capabilities

## Pi tool approval

Settings → Models → Pi provides an explicit **Install approval extension** button.
Inspection does not install anything. Installation writes the bundled extension to
`~/.codexhost/extensions/pi-permissions/index.mjs`; it does not modify Pi global
settings or the user's extensions. New or reopened Pi sessions load that exact
extension using native `--extension`. Permission controls are advertised only when
installation content matches the bundled version. Installation also starts Pi and
verifies that the extension command loaded before reporting success, then invalidates
the inspection cache and refreshes draft permission controls.

Settings recognizes existing Host-owned installations. If their content differs from
the current bundled version, an **Update extension** button replaces **Installed**.
Updates are explicit, apply to new/reopened sessions and never overwrite unrelated
Pi extensions. Older versions are not loaded until updated.

Selecting a permission mode changes the local draft immediately. Before the next
prompt the adapter verifies the native command and applies the final mode through
the extension's RPC slash command. Unchanged modes are not resent. Approval mode
uses Pi's `tool_call` hook and native `ctx.ui.confirm`; missing UI, rejection and
interaction errors block execution. Automatic mode removes this extension's gate
only; other native extensions retain their own rules. Native project trust flags
are separate from tool approval. Pi transport carriers preserve approval independently
of thinking. Confirmations associated with shell/file tools use a synthetic question
item because Desktop question projection only accepts generic tool items.

## Pi Codex Fast

Settings → Models → Pi also provides an optional **Install Fast extension** button.
It requires an available Pi `openai-codex` model whose native Codex
`models_cache.json` advertises a `priority` service tier. Missing capability metadata
never expands to a guessed GPT allowlist. The Host-owned extension is installed at
`~/.codexhost/extensions/pi-codex-fast/index.mjs` and loaded via `--extension`.

Fast defaults off. The model menu stages its value locally; sending applies the final
value through a Pi extension command. The adapter advertises `modelSelectionScope: turn`
so Host forwards the draft Model Ref on existing-thread submissions too, without restarting Pi or changing reasoning.
The extension uses Pi's public provider registration and native Codex Responses
stream with `serviceTier: "priority"`; native reasoning clamping and service-tier
pricing remain owned by Pi. Backend availability and actual speed depend on OpenAI;
a successful switch is not proof of a particular latency improvement. Global Pi
and Codex configurations are unchanged. This installer recognizes only the bundled
Host extension, not unrelated community Fast plugins.

## Qoder credits and subagents

Account inspection uses SDK `getUsageInfo()` and `accountInfo()` with the discovered
native CLI and existing authentication. It displays the native user quota and
actual used/total Credits. Available native organization resource packages are
displayed separately with their own used/total Credits. Subscription expiry is not interpreted as a five-hour,
weekly or monthly reset. Session Usage displays native cumulative
`session.total_credits` (or result `total_credits`) as **Session credits spent**;
refresh replaces that cumulative value instead of adding it again. Host retains
Usage in memory only; reopening a native Qoder session reloads its persisted
cumulative Credits through the SDK. Account quota
percentages are not projected into a fictitious five-hour session limit.

SDK SubagentStart/SubagentStop hooks expose native agent IDs. Host displays child
lifecycle and reads transcripts using `listSubagents` and `getSubagentMessages`,
verifying membership in the parent session. The selected child transcript treats its
task prompt as root input while retaining native message IDs; SDK parent-tool links
do not suppress the child history. Native `agent-result` tool metadata
preserves links on history replay. A parent ending before a child stop is observed
leaves that child interrupted, not successful. Unattended delegation selects the
native `bypassPermissions` policy.

The earlier assertion that the public SDK has no subagent capability is obsolete.
A native smoke run successfully emitted both hooks and read three child messages.
Native `/usage` and `/context` headless smoke runs returned
`error_during_execution`; they are not advertised as working slash commands.
Their SDK control APIs provide Usage/context data independently. The existing
verified compaction commands remain supported; a command appearing in
`supportedCommands()` alone is not evidence that it executes headlessly.
