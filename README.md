# ai-usage-analyzer

A local web dashboard for AI coding agent token consumption. Auto-detects
**Claude Code**, **Codex**, **OpenCode**, **MimoCode**, **GitHub Copilot**,
**Antigravity**, and **Gemini CLI** data directories.

The default command starts a local server and opens the dashboard in your browser.
Usage data stays on your device. Press Ctrl+C in the terminal to stop the server.

## Install

Requires **Node.js ≥ 22.5** (for built-in `node:sqlite`).

```bash
# Try it (no install)
npx -y ai-usage-analyzer

# Or install globally
pnpm add -g ai-usage-analyzer
ai-usage-analyzer --help
```

The short alias `ai-usage` is also installed and works identically.

## Usage

```bash
ai-usage-analyzer                  # open the dashboard
ai-usage-analyzer --static --top 10 # terminal report with top 10 sessions
ai-usage-analyzer --json           # machine-readable JSON
ai-usage-analyzer --md > report.md # save as markdown
ai-usage-analyzer --json --quota    # include a live quota snapshot
```

## Supported tools

| Tool | Default path | Tokens |
|---|---|---|
| Claude Code    | `~/.claude/projects`                | yes (estimated cost) |
| Codex          | `~/.codex/sessions/` and `archived_sessions/` | yes (estimated cost) |
| OpenCode       | `~/.local/share/opencode/opencode.db` | yes (+cost) |
| MimoCode       | `~/.local/share/mimocode/mimocode.db` | yes (+cost) |
| GitHub Copilot | `~/.copilot/session-state/`        | presence only |
| Antigravity    | `~/Library/Application Support/Antigravity` | presence only |
| Gemini CLI     | `~/.gemini/antigravity/conversations` | presence only |

## Path overrides

Override any tool's base path with an env var (`CLAUDE_HOME`, `CODEX_HOME`,
`OPENCODE_HOME`, `MIMOCODE_HOME`, `COPILOT_HOME`, `ANTIGRAVITY_HOME`,
`GEMINI_HOME`), or pass all at once via JSON:

```bash
export AI_USAGE_PATHS_JSON='{"codex":"/data/codex","opencode":"/data/oc.db"}'
```

## Token breakdown

For tools that record token data, the analyzer shows input, output, cache
read, cache write, and reasoning tokens. Cache hits are cheap; reasoning is
the extended-thinking/chain-of-thought cost.

## Quotas

Reports stay offline unless `--quota` is supplied. This requests Claude and Codex
usage limits using your existing logins. Vendor endpoints are internal and can
change. Codex credentials may be refreshed and written back to `auth.json`.

## Costs

Claude and Codex costs use bundled API rates per model and are estimates,
not subscription charges or invoices. `~` marks an estimate, `*` marks a
partial total, and `n/a` means unavailable. Unknown models are listed rather
than assigned a fallback price. OpenCode and MimoCode costs are read from
their local databases. Pricing uses standard public API rates and the
five-minute Claude cache-write rate; regional, batch, and other modifiers may
differ. Rates are versioned with the app and can become outdated.

## How it works

```
src/
├── detectors.js   auto-path discovery (env → well-known locations)
├── loaders.js     SQLite + JSONL parsers → unified session record
├── quota.js       Claude and Codex quota snapshots
├── pricing.js     bundled model pricing and estimates
├── live.js        incremental live usage monitor
├── aggregate.js   per-project / per-week / per-month grouping
├── server.js      local dashboard server
├── render.js      static terminal report  •  markdown.js  →  Markdown report
bin/
└── ai-usage.js    entry point
```

## License

MIT
