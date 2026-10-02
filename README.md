# jev-watch

Claude Code function-hook plugin that logs what `fast-jev-compaction` does, one
JSONL file per session and day: `~/.claude/logs/jev-watch/<UTC date>_<session id>.jsonl`.

| `kind` | When |
| --- | --- |
| `log` | every `$.ui.log` line of fast-jev; `outcome`: `kept`, `fallback`, `skipped`, `decisions` |
| `http` | every TypeSafe request: method, URL without query, status, ms, error body (redacted) |
| `compact` | every compaction that reaches this plugin: trigger, who asked, messages before/after, ms, the chain beneath with each link's outcome; `aborted: true` on a failure the turn's abort caused (Send now, Stop) |
| `hook-failure` | a fast-jev hook threw or ran out of budget (`skipped`, `kept`, `expired`, `caught`, `rejected`) |
| `not-seen` | first turn: fast-jev is not beneath jev-watch (not loaded, or seated above it); its line goes to the debug log only |

Headers, bodies and query strings are never logged; long token-like runs are replaced by `<redacted>`.

Install (function hooks need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, Claude Code 2.1.274+):

```sh
claude plugin marketplace add deadczarvc-labs/jev-watch
claude plugin install jev-watch@jev-watch
```

It watches [jev-factkeep-compaction](https://github.com/deadczarvc-labs/jev-factkeep-compaction) (plugin id
`fast-jev-compaction`). MIT license.

jev-watch must sit **above** fast-jev-compaction: only a plugin above it sees its failures and the
compactions it answers itself. `enabledPlugins` order did not hold that (after fast-jev moved to a
directory marketplace on 2026-09-30, fast-jev sat outermost for `session.compact`), so
`~/.claude/settings.json` pins it: `"prependPlugins": ["jev-watch@jev-watch"]` (honored from user settings
on a machine without managed settings, for your own plugins). Verified in `claude -p` (debug:
`prependPlugins from user settings`). The desktop app hands plugins from directory marketplaces to the CLI as
`--plugin-dir` plugins, named `<name>@inline` (2026-10-02), so it also needs `"jev-watch@inline"` in
`prependPlugins` (and `pluginConfigs` keys `<name>` for their options).

Problems only:

```powershell
Get-Content $HOME\.claude\logs\jev-watch\*.jsonl | ConvertFrom-Json |
  Where-Object { $_.kind -in 'hook-failure','not-seen' -or $_.outcome -in 'fallback','skipped' -or $_.error -or ($_.kind -eq 'http' -and -not $_.ok) }
```

Checks: `claude plugin validate .claude-plugin/plugin.json`, `claude plugin test .`,
`tsc -p tsconfig.json` (types in `.claude/types`, written by Claude Code 2.1.284; regenerate after an upgrade).
