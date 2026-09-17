# Experimental Cursor CLI Harness

Cursor can execute native CLI sessions through codexhost's public Harness plugin
contract. This package remains experimental. The preinstalled distribution
connects it to the Desktop Agent
Picker, configuration preferences, sidebar ownership and Connections page. Live
Desktop adoption remains separate from packaging and Host protocol validation.

## Transport choice

The adapter launches `cursor-agent acp` and uses the official ACP SDK over stdio.
This preserves Cursor's existing CLI authentication, native tools and interactive
approval requests. Cursor-specific translation remains inside `adapter-cursor-cli`.
Host Runtime, Protocol Core and Renderer do not import the adapter.

The [TypeScript SDK](https://cursor.com/docs/sdk/typescript) is suitable for
headless runs, but its local execution model does not offer the same interactive
approval round trip. The [SDK Bridge](https://cursor.com/docs/sdk/bridge) embeds
that SDK for other languages and would add another server to this TypeScript
integration. [CLI ACP](https://cursor.com/docs/cli/acp) is the selected interface.

## Implemented boundary

- Native create, text prompt, streaming text/reasoning, tool progress and cancellation.
- Structured Edit Diff for successful tools carrying native ACP diff content,
  including new files and updates, in live output and native history replay.
- Native model and parameter configuration through ACP. The client advertises
  `clientCapabilities._meta.parameterizedModelPicker = true` during initialization.
  Cursor returns model-specific `configOptions` for Fast, Thinking, Context and
  Effort where supported. The native `cursor/list_available_models` ACP extension
  supplies parameter definitions for all models. Picker changes update local draft
  configuration immediately, with no native configuration requests. At submission,
  only the final model and changed parameters are applied through
  `session/set_config_option` before prompting; failure prevents prompt submission.
  Returned options replace the previous configuration.
  Opaque model selections preserve parameters across draft submission and resume.
  The Renderer uses generic controls and never decodes Cursor model strings.
- Separate execution (Agent, Plan, Ask) and approval (native rules, automatic) controls.
  Picker changes are local until the next submission. Automatic execution uses Cursor's
  native `--force` startup option; it does not manufacture ACP approval responses or
  bypass explicit deny rules/team policy. Switching this option on an existing session
  closes its owned transport and loads the same native session with the new option,
  inside the accepted turn, before prompting. Unchanged approval settings reuse the
  connection. Mode-only changes use native ACP configuration without restarting.
  Questions and plan confirmations remain native interactions. `--force` does not
  imply disabling the sandbox or approving new MCP server registrations.
- Native tool approvals and Cursor's blocking question/plan extensions, with
  exact interaction correlation, response validation and cancellation cleanup.
- Session resume and read-only snapshots, with strict native turn identity checks.
- Negative discovery caching and bounded startup/configuration/close. There is no
  polling timer, automatic provider substitution or Codex fallback.
- Direct Windows bundle invocation avoids leaving a PowerShell/cmd launcher owner
  in between Host and the ACP process. Configuration may select an executable via
  `CODEXHOST_CURSOR_COMMAND`. User authentication is never copied into the plugin.

## Experimental history gate

The tested Cursor CLI `2026.09.08-6caf4ff` emits no persistent user-turn ID in either
ACP prompt completion or replay. The prototype reads only user-turn identity and
prompt text from its native `~/.cursor/acp-sessions/<id>/store.db`, using a read-only
SQLite connection. A small bounded decoder follows the observed native root/turn
references. This is an undocumented native format, not a supported Cursor API.

The snapshot body comes from a fresh native ACP `session/load`. It is accepted only
when session, workspace, turn count, order and exact prompt text match native
history. Advertised native slash commands may expand their prompt text; their
completion still requires exactly one appended native user-turn ID and an unchanged
preexisting turn sequence. A successful live turn must introduce exactly one native user-turn ID.
Missing/ambiguous history is an error; generated UUIDs, array positions and text
hashes are never used as native turn keys. The adapter keeps no shadow transcript.

The real Windows restart smoke demonstrates that completed turn IDs remain equal
after the adapter process is replaced, and a follow-up retains earlier context.
This does not establish compatibility with other Cursor versions, compacted
histories, externally modified sessions or every tool payload.

Cursor can cancel before persisting a native turn. In that case the cancelled
terminal intentionally has no `nativeTurnRef`. ACP history also omits historical
stop reasons, so snapshot outcomes are `unknown`. Do not infer a historical success
from the presence of assistant text. Cancellation persistence needs further native
contract investigation before release acceptance.

## Current limitations

- The Desktop Agent Picker is still based on a static Harness list. This integration
  adds Cursor explicitly and uses the shared plugin carrier. Its independent model
  and mode preferences do not inherit another Harness's Thinking selection.
- Fork, rollback, session Usage and native session import are not advertised.
  Account quota and native subagent transcript browsing are supported. Unattended
  delegation maps to native `--force`, subject to the same Cursor restrictions above. Image/audio
  prompt inputs are outside the current Host text contract. Parameter choices and labels come from the currently selected model
  in ACP; no CLI model-list subprocess, suffix inference or guessed ranges are used.
- Edit Diff is partial: it requires native ACP diff content. Delete/rename semantics,
  shell edits and missing historical diffs are not inferred. Other Cursor notification
  extensions are not all implemented.
- Model inspection opens one empty native ACP session per cache refresh because
  the catalog is returned by `session/new`. It submits no model prompt. Both
  successful and failed inspection results are cached per working directory without
  time-based expiry, until explicit refresh or Adapter shutdown. Concurrent checks,
  including refresh requests, reuse an in-flight inspection.
- The native history format and operating-system authentication behavior require
  platform/version acceptance before formal product support is claimed.

## Native Edit Diff

The adapter converts ACP `diff` content (`path`, `oldText`, `newText`) into public
`fileChange` Items for the existing Desktop patch and Turn Diff projection. Absent
or null `oldText` means a new file per ACP; an empty string means an existing empty
file. Whitespace and line endings in accepted native bodies are preserved.
Unchanged content is omitted.

Diffs are published only after the native tool reports success. Pending proposals,
failed tools and unconfirmed/cancelled calls do not create applied changes; changes
from a tool that already succeeded remain visible if the rest of the Turn is cancelled.
ACP content updates replace previous content, and repeated terminal notifications do
not create extra file-change Items. Native `session/load` uses the same projection;
it cannot recover diffs omitted by the native replay.

Whole patches share a 100,000-character budget per tool, with a 100 ms generation
budget per file. Oversized or timed-out patches are omitted rather than truncated;
the existing bounded tool output remains available. No file watcher, Git comparison,
filesystem baseline or separate diff history is added.

The macOS arm64 CLI `2026.09.10-fd3934a`, using native `cursor_login` and Model
`default[]`, was checked with real edits in an isolated workspace. An existing-file
patch reproduced the actual file from its known previous contents. A relocated
plugin loaded through the public Loader resumed that Session, completed another
real edit, and emitted one Desktop File Change Item and patch update. A fresh
Adapter/native process recovered identical patches and Native Turn IDs.

That same CLI's new-file `diffString` fallback was observed to put `-- /dev/null`
in `oldText` and `++ b/<path>` in `newText`, losing final-newline information. The
same corruption appears in replay. This known malformed pair stays as tool output;
it is not repaired from the current file or guessed into a File Change. Valid ACP
new-file content remains supported, but this native creation case does not have a
reliable Diff.

Automated fixtures cover complete patches, content replacement, success/failure/
cancellation, duplicate notifications, limits and the captured malformed creation
case in live and history projection. These checks are not visual Desktop acceptance
and do not establish coverage for every Cursor Edit/Write path or other versions
and platforms.

## Brand assets

`docs/imgs/badge-cursor.svg` embeds the original 2D Cube path, aspect ratio and
`#EDECEC` fill from `General Logos/Cube/SVG/CUBE_2D_DARK.svg` in the
[official brand kit](https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip)
linked by [Cursor's brand page](https://cursor.com/brand). It uses the existing
20px README badge style and links to the Cursor CLI documentation.

The Renderer and plugin icons are byte-identical copies of the
[official favicon](https://cursor.com/favicon.svg), preserving its rounded dark
plate and light Cube mark. They replace the integration's neutral pointer
placeholder and are bundled locally without runtime network requests.

The Cursor name and marks remain the property of Anysphere, Inc.; their public
availability is not an open-source license or a claim of endorsement.

## Build a separate candidate

From the repository root, after `cursor-agent login` has completed in the user's
own terminal:

```powershell
npm ci --ignore-scripts
npm run typecheck
npx vitest run --config tests/vitest.config.js packages/adapters/cursor-cli/test
node tools/build-cursor-plugin.mjs <new-absolute-candidate-directory>
```

The builder refuses an existing output directory. It creates a relocatable plugin
bundle and an `enabled.json` for that candidate root. It does not install, modify
user configuration, restart Desktop or change the preinstalled plugin list.

## Reproducible probes

Use a dedicated empty smoke workspace: these commands execute real Cursor turns
using the user's native account. Receipts contain only synthetic test identities,
responses and aggregate results; no raw credentials or native store copies.

```powershell
# Real multi-turn execution, then a NEW process that resumes the same session.
node tools/cursor-harness-smoke.mjs <smoke-workspace>
node tools/cursor-harness-smoke.mjs <smoke-workspace> --resume

# Load the packaged plugin through the actual Host plugin loader, deny a native
# harmless shell request, and cancel a streaming turn.
node tools/cursor-controls-smoke.mjs <candidate-directory> <smoke-workspace>

# Actual AppServerHost JSON-RPC route with isolated mapping/account state.
# Only the unused official Codex child is synthetic; Cursor execution is real.
node tools/cursor-host-protocol-smoke.mjs <candidate-directory> <smoke-workspace> <new-host-state-directory>
```

Passing these probes establishes the tested Host/adapter boundary. Do not run
`npm start` as a validation shortcut: on Windows/macOS it stops the current Desktop
processes.

## Native Task cards and replay identity

Native Task pending/running/terminal events become Host collaboration cards and
read-only child Threads. The `cursor/task` extension confirms final native model
metadata. Current ACP does not expose the child's internal message/tool stream;
the child view contains its real prompt and the full text result ACP provides,
including after reconnect. The 2,000-character result limit applies only to card
summaries, not child view content. Native pending and in-progress Task notifications
remain distinct pending/running card states. Internal steps are not synthesized.
A successful background launch is not child completion; observation ends as
interrupted if parent exit leaves completion unconfirmed.

Cursor rewrites live tool-call IDs to `replay-N-M` during `session/load`. Child
inspection therefore uses a parent-scoped native invocation address: verified
Turn position, Task position and input fingerprint. This address is not a native
user-Turn ID or a fabricated child Session. The native Turn sequence is checked
before/after history reads, and changed inputs or missing Tasks fail closed.

## macOS SSH and Remote Control

Direct SSH startup can report a locked login keychain despite native GUI login.
Managed remote plugin construction selects the [native Aqua broker](../../platforms/macos/native-aqua-broker.md)
and preserves that login session:

```sh
codexhost broker install --harness cursor-cli
codexhost broker status --harness cursor-cli
```

There is no direct SSH/native-provider fallback if the broker is unavailable.
Neither credentials nor native stores are copied into Host state.

The implementation was packaged on Windows/macOS in a combined 0.6.2 candidate
before this independent Cursor PR. Native Task lifecycle, Plan/Agent switching,
and the same child handle after process/Host reconnect were verified. The user
also verified local Desktop subagents, Windows-to-Mac remote sessions, and
Mac-to-Windows Remote Control. These deployed-candidate/user checks are distinct
from automated tests of this branch, and do not establish compatibility with
unobserved future versions of Cursor's private history format.

## Native slash commands

Open sessions consume ACP `available_commands_update`. Their declared prompt commands
are exposed through the existing command picker and may also be typed directly.
The clipboard-only `copy-request-id` command is excluded. An unopened session has
no dynamic command catalog: opening the picker never launches a discovery process.
Cursor ACP does not expose the CLI's TUI fork/summarize operations or session Usage.

## Frontend model visibility and native account quota

Settings → Models keeps independent hidden-model preferences for Pi, Qoder,
Cursor and Grok in Desktop local storage. The picker filters its visible entries
only; native catalogs, selected conversation models and Harness settings are
unchanged. Configured variants share the base model's visibility preference.

Cursor account inspection reads the native CLI OAuth credential store (macOS
Keychain by default; the native auth file for file-store/Linux/Windows) without
writing or copying credentials into Host state. It calls Cursor DashboardService
`GetCurrentPeriodUsage`, `GetMe` and `GetPlanInfo`. The account page reports the
native Auto and API percentages with the billing-cycle end date, as monthly
quota rather than a seven-day limit. Spend/limit is deliberately not used because
it excludes bonus/bucket semantics. Missing native percentage data yields no quota
snapshot. API-key and memory-store sessions do not use unrelated saved OAuth.

Verified native schema: Cursor CLI `2026.09.10-fd3934a`. These undocumented service
and credential-store contracts may change; failures must not invent quota or
include credentials in Renderer diagnostics.


## Native Harness version maintenance

Settings → Models shows the installed CLI and latest version for Pi, Qoder,
Cursor, Kimi Code and Grok. Opening a tab checks versions; the visible tab checks
again every five minutes, with an explicit refresh button. Only an explicit Update
click installs anything. The update button is disabled when current or unsupported.
Failures remain visible and can be retried with a fresh check. A successful command
is followed by version readback; an unchanged version is not reported as success.

The optional `HarnessAdapter.installation` capability owns native behavior. Host
only validates and routes `codexhost/harness/installation`; it never accepts a
command, path, download URL or package name from Renderer. These are CLI updates,
not Host plugin updates, and existing sessions are not restarted.

- Pi: the actual installed npm package, retaining its package name and global prefix.
  Source checkouts and unrecognized package-manager layouts require their original installer.
- Qoder: native `update --check` and `update`.
- Cursor: native `about --format json` and `update`, preserving its channel.
- Grok: native `update --check --json` and `update`, preserving its channel.
- Kimi Code: native CDN version check and its checksum-verifying manual staging worker
  (`__update_download VERSION --manual`), gated by executable and help checks. This
  is the native path used by Kimi 0.42's interactive updater; native startup applies
  the staged release, then Host reads back the version. Recognized npm installations
  use their existing package and prefix. Unknown layouts remain manual.

Older plugins and brokered connections without this optional capability report it
as unavailable. No local update is substituted for a remote installation.

## New delegated Threads in manual project order

After a delegation is persisted, Host emits `codexhost/delegation/created` with
its Thread ID and cwd. Renderer uses Desktop's existing project-order registration
helper, including its serialized persistence and cache refresh. Only newly created
delegations participate; resuming or finding an existing delegation does not move it.
The native project filters and Host scope select the project. Date-based ordering
is unaffected, and existing manual order is preserved below the new Thread.

The private binding is validated for Desktop asset
`app-initial-4d7ea7f81c2d.js`. Unknown assets or ambiguous projects skip registration
without breaking delegation; they do not fall back to writing Desktop state directly.
