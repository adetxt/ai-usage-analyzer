# AGENTS.md

## Commands

- `pnpm install` — install deps (uses pnpm, pinned via `packageManager` field)
- `npm test` — runs `node --test test/*.test.js` (Node's built-in test runner, **not** jest/vitest)
- `npm start` — runs `node bin/ai-usage.js` directly
- There is **no lint, no typecheck, no formatter configured**. Do not add husky/prettier/ESLint without asking — they don't exist yet.
- Single-test focus: `node --test test/aggregate.test.js` (any file-glob the runner accepts).

## Constraints

- **Node ≥ 22.5 is required** (`engines.node` in `package.json`). The reason is the built-in `node:sqlite` module — older Node will fail with `ERR_MODULE_NOT_FOUND` or missing `DatabaseSync`. Do not try to add `better-sqlite3` as a polyfill.
- The `node:sqlite` import emits `ExperimentalWarning: SQLite is an experimental feature…` on every run. This is **expected**, not a bug. Don't suppress it unless adding a real replacement.
- Project is **pure ESM** (`"type": "module"`). All `import` paths must include the `.js` extension, even for local files. There is no TypeScript, no transpile step.
- Package manager is **pnpm** (`pnpm@10.33.0` in `packageManager`). `pnpm-lock.yaml` is the source of truth. Do not introduce a `package-lock.json`.

## Architecture (only the non-obvious bits)

```
bin/ai-usage.js    argv + dispatch (--json | --md | TUI)
src/detectors.js   per-tool data-dir auto-discovery
src/loaders.js     → unified session records
src/aggregate.js   per-project/week/month/tool grouping
src/render.js      TUI       src/markdown.js  →  Markdown
```

- `detectors.js` returns one of `present` / `absent` per tool. It does **not** parse data.
- `loaders.js` only has parsers for **`codex` (JSONL rollouts), `opencode` and `mimocode` (SQLite, shared schema)**. The other four tools — `claude`, `copilot`, `antigravity`, `gemini` — are **presence-only** by design: those tools don't store token counts locally, so there is nothing to load. Don't write a loader for them without first checking what data the tool actually persists.
- To add a new tool, append a `DETECTORS` entry in `src/detectors.js`; if the tool has token data, add a loader branch in `src/loaders.js`. `TOOL_ORDER` is derived from `DETECTORS` order — keep it stable.

## Detector path gotchas (real Claude Code layout, not the docs)

- **Claude Code**: `~/.claude/projects/<encoded-cwd>/<UUID>.jsonl` — count function must recurse; the old `~/.claude/transcripts/ses_*.jsonl` layout is gone. The detector must NOT do a flat `readdirSync` on `projects/`.
- **Codex**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — files are nested under date dirs.
- **OpenCode / MimoCode**: single SQLite file (`opencode.db` / `mimocode.db`) with a `session` table; schema is shared, so loader introspects columns.
- **macOS** `Antigravity` lives in `~/Library/Application Support/Antigravity`; **Linux** uses `~/.local/share` (via `XDG_DATA_HOME` fallback).
- Per-tool env overrides: `CLAUDE_HOME`, `CODEX_HOME`, `OPENCODE_HOME`, `MIMOCODE_HOME`, `COPILOT_HOME`, `ANTIGRAVITY_HOME`, `GEMINI_HOME`. Or pass `AI_USAGE_PATHS_JSON='{"codex":"/data/..."}'` to override many at once. Env vars are read at detector-call time (top of `detectors.js` imports `env` from `node:process`), so set them in the calling shell, not via dotenv at module load.

## Testing

- Framework is `node:test` + `node:assert/strict`. No fixtures directory, no snapshot files.
- `test/aggregate.test.js` has a Claude detector test that creates a temp dir under `os.tmpdir()` and overrides `CLAUDE_HOME`. Use the same pattern (mkdtemp + try/finally env restore + `rmSync` cleanup) when writing tests that need filesystem fixtures.
- `loadAll` is async — tests that call it must be `async`.
- Running tests with the user's real `~/.claude` populated is fine: the Claude test only fires when `CLAUDE_HOME` is overridden; the other tests are pure unit tests.

## Style

- No comments in code unless the user asks (existing `detectors.js` has banner comments from the original author — those are pre-existing, not a convention to follow blindly).
- Match the existing 2-space indent, single quotes, trailing commas in `package.json`-style.
- The TUI uses `chalk`/`cli-table3`/`boxen`/`gradient-string`; the Markdown renderer is a separate module with no color codes (must render in plain markdown viewers).

## Releases

- Bump version in `package.json` (currently `0.2.1`).
- Tag format: `vX.Y.Z`, push the tag — `.github/workflows/publish.yml` runs tests and publishes via npm OIDC trusted publishing (no `NPM_TOKEN` secret needed).
- One-time npm-side setup (already done for `ai-usage-analyzer`): add this workflow as a trusted publisher at https://www.npmjs.com/package/ai-usage-analyzer/access (GitHub repo, workflow file `publish.yml`, environment left blank).
- No changelog file.
