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

jev-watch must sit **above** fast-jev-compaction: only a plugin above it sees its failures and the
compactions it answers itself. `enabledPlugins` order did not hold that (after fast-jev moved to a
directory marketplace on 2026-09-30, fast-jev sat outermost for `session.compact`), so
`~/.claude/settings.json` pins it: `"prependPlugins": ["jev-watch@jev-watch"]` (honored from user settings
on a machine without managed settings, for your own plugins). Verified in `claude -p` (debug:
`prependPlugins from user settings`); the desktop app's SDK sessions did not honor it on 2026-10-02
(`not-seen` there), so in the desktop fast-jev's own answers show only as its `kept` / `fallback` log rows.

Problems only:

```powershell
Get-Content $HOME\.claude\logs\jev-watch\*.jsonl | ConvertFrom-Json |
  Where-Object { $_.kind -in 'hook-failure','not-seen' -or $_.outcome -in 'fallback','skipped' -or $_.error -or ($_.kind -eq 'http' -and -not $_.ok) }
```

Checks: `claude plugin validate .claude-plugin/plugin.json`, `claude plugin test .`,
`tsc -p tsconfig.json` (types in `.claude/types`, written by Claude Code 2.1.284; regenerate after an upgrade).
