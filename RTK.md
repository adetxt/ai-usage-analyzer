# RTK

Use supported RTK wrappers for shell output: `rtk git status`, `rtk git diff`,
`rtk rg`, `rtk test npm test`, `rtk ls src/`. Run unsupported commands directly.
Do not add a second prefix when the host's rewrite hook already wraps a command.

# Command output

Command output is condensed to save tokens. Batch independent reads when useful.
Follow recovery paths reported by truncated results. Use `rtk proxy <cmd>` when
you need exact output for parsing, complete source, or diagnosis, or when a
filtered result is empty, contradictory, or garbled. Verify the command's exit
code before claiming success.

## About RTK

RTK (Rust Token Killer) is a CLI proxy that filters command output to save
tokens. It is intended to preserve command behavior and exit codes.

- `rtk gain` / `rtk gain --history` — token savings, overall and per command.
- `rtk proxy <cmd>` — run a command unfiltered, still tracked.
- `RTK_DISABLED=1 <cmd>` — skip RTK for one command.
- `rtk discover` — find past commands RTK could have condensed.
