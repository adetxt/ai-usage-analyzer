# AGENTS.md

## Agent workflow tools

These are agent tools, not application dependencies. Keep them out of `package.json` and `pnpm-lock.yaml`. Repository constraints take precedence over their defaults, including the rules about comments, dependencies, and testing.

- **[RTK](https://github.com/rtk-ai/rtk)** compresses shell output. Read [RTK.md](RTK.md) at session start. Prefer supported commands such as `rtk git status`, `rtk git diff`, `rtk rg`, and `rtk test npm test`. Codex needs explicit prefixes with the installed integration; Claude Code already has a global rewrite hook. Avoid double wrapping. Use `rtk proxy <command>` for exact output needed by parsers or diagnostics; unsupported commands can run directly. Inspect savings with `rtk gain`.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** keeps chat concise. Load `~/.agents/skills/caveman/SKILL.md` (or the host's installed copy) and use **lite** by default here. Preserve technical meaning, commands, paths, and errors. Write documentation, code, and commit messages in normal prose. `$caveman` changes the mode in Codex; `stop caveman` restores normal replies.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** guides implementation. Load `~/.codex/skills/ponytail/SKILL.md` (or the host's installed copy); use **full** by default. Trace affected behavior before editing, reuse existing code and native features, and make the smallest complete change. Preserve validation, error handling, security, accessibility, and necessary tests. Use the installed `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, and `ponytail-help` skills when their workflows are requested. The repository's no-comments rule also applies to Ponytail's suggested `shortcut:` comments.
- **[Anti Slop](https://github.com/miqdadbadjuber/anti-slop)** filters generic output. Load `~/.agents/skills/antislop/SKILL.md` (or the host's installed copy) every session. Use **during** for implementation and **after** for requested audits. Load the matching companion skill as needed: `antislop-ui` for visual work, `antislop-copywriting` for prose, `antislop-human` for accessibility, `antislop-layoutmobile` for responsive layouts, and `antislop-code` for comment cleanup. Preserve the project's visual direction and ground claims in evidence.

Check for existing binaries and skills before installing. On a new macOS machine, install missing pieces with:

```sh
brew install rtk
rtk init --codex
npx skills add JuliusBrussee/caveman -g
npx skills add DietrichGebert/ponytail -g --agent codex --skill '*'
npx skills add miqdadbadjuber/anti-slop -g --agent codex --skill '*'
```

Skills installed through the Skills CLI normally live under `~/.agents/skills`; Codex-specific installs may live under `~/.codex/skills`. Load the existing copy rather than duplicating it. Newly installed skills are available on the next turn; start a new thread if the host does not refresh them.

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

- `detectors.js` is a thin orchestrator: it imports `TOOLS` from `src/tools.js`, probes paths, applies `$AI_USAGE_PATHS_JSON` overrides, and returns `present` / `absent` per tool. It does **not** parse data.
- `tools.js` is the single source of truth for every supported tool — color, bar character, label, name, kind, env var, candidate paths, count function, `hasTokens`, and description. **Adding a new tool means appending one entry to `TOOLS` here.** Display tweaks (color, bar char) also live here, not in the renderers.
- `loaders.js` has parsers for **`claude` (JSONL sessions — per-message `usage`, deduped by `message.id` since Claude Code emits streaming duplicates), `codex` (JSONL rollouts), and `opencode` / `mimocode` (SQLite, shared schema)**. The other three tools — `copilot`, `antigravity`, `gemini` — are **presence-only**: those tools don't store token counts locally, so there is nothing to load. Don't write a loader for them without first checking what data the tool actually persists.

## Detector path gotchas (real Claude Code layout, not the docs)

- **Claude Code**: `~/.claude/projects/<encoded-cwd>/<UUID>.jsonl` — count function must recurse; the old `~/.claude/transcripts/ses_*.jsonl` layout is gone. The detector must NOT do a flat `readdirSync` on `projects/`. The loader walks top-level files only and **skips `*/subagents/*`** (subagent usage is already represented in the parent session's assistant messages; counting it twice would inflate totals).
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

@RTK.md
