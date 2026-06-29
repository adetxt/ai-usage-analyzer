# ai-usage-analyzer

TUI analyzer for local AI coding agent token consumption. Auto-detects
**Claude Code**, **Codex**, **OpenCode**, **MimoCode**, **GitHub Copilot**,
**Antigravity**, and **Gemini CLI** data directories — no hardcoded paths.

```
╭──────────────────────────────────────────────────────╮
│               ◆  AI TOKEN ANALYZER  ◆                │
│                                                      │
│  411 sessions  •  1.56B total tokens  •  $29.40 USD  │
│            range: 2026-04-01  →  2026-06-27          │
╰──────────────────────────────────────────────────────╯
```

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
ai-usage-analyzer                  # default TUI
ai-usage-analyzer --top 10         # show top 10 heaviest sessions
ai-usage-analyzer --json           # machine-readable JSON
ai-usage-analyzer --md > report.md # save as markdown
```

## Supported tools

| Tool | Default path | Tokens |
|---|---|---|
| Claude Code    | `~/.claude/projects`                | presence only |
| Codex          | `~/.codex/sessions/YYYY/MM/DD/`    | yes |
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

## How it works

```
src/
├── detectors.js   auto-path discovery (env → well-known locations)
├── loaders.js     SQLite + JSONL parsers → unified session record
├── aggregate.js   per-project / per-week / per-month grouping
├── render.js      TUI  •  markdown.js  →  Markdown report
bin/
└── ai-usage.js    entry point
```

## License

MIT
