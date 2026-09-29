# jev-watch

Claude Code function-hook plugin that logs what `fast-jev-compaction` does, one
JSONL file per session and day: `~/.claude/logs/jev-watch/<UTC date>_<session id>.jsonl`.

| `kind` | When |
| --- | --- |
| `log` | every `$.ui.log` line of fast-jev; `outcome`: `kept`, `fallback`, `skipped`, `decisions` |
| `http` | every TypeSafe request: method, URL without query, status, ms, error body (redacted) |
| `compact` | every compaction that reaches this plugin: trigger, who asked, messages before/after, ms, the chain beneath with each link's outcome |
| `hook-failure` | a fast-jev hook threw or ran out of budget (`skipped`, `kept`, `expired`, `caught`, `rejected`) |
| `not-seen` | first turn: fast-jev is not beneath jev-watch (not loaded, or listed before it in `enabledPlugins`) |

Headers, bodies and query strings are never logged; long token-like runs are replaced by `<redacted>`.

`jev-watch@jev-watch` must come **before** `fast-jev-compaction@fast-jev-compaction` in
`enabledPlugins` (`~/.claude/settings.json`): the chain follows that order, and only a
plugin above fast-jev sees its failures and the compactions it answers itself.

Problems only:

```powershell
Get-Content $HOME\.claude\logs\jev-watch\*.jsonl | ConvertFrom-Json |
  Where-Object { $_.kind -in 'hook-failure','not-seen' -or $_.outcome -in 'fallback','skipped' -or $_.error -or ($_.kind -eq 'http' -and -not $_.ok) }
```

Checks: `claude plugin validate .claude-plugin/plugin.json`, `claude plugin test .`,
`tsc -p tsconfig.json` (types in `.claude/types`, written by Claude Code 2.1.284; regenerate after an upgrade).
