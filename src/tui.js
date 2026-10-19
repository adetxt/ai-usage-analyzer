// Interactive TUI: tab bar + scrollable content + keyboard navigation.
// Falls back gracefully when stdout is not a TTY.

import chalk from "chalk";
import process from "node:process";
import readline from "node:readline";
import { perProject } from "./aggregate.js";
import {
    CURSOR_MARK,
    renderDetections,
    renderNotes,
    renderOverview,
    renderPerMonth,
    renderPerProjectCursor,
    renderPerTool,
    renderPerToolPerMonth,
    renderPerWeek,
    renderProjectSessions,
    renderTopSessions,
} from "./render.js";

// Strip ANSI escape codes to measure visible string length.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function visLen(s) {
  return s.replace(ANSI_RE, "").length;
}

export async function runInteractive({ records, detections, errors, topN }) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) return false;

  const PROJECTS_VIEW = 1; // index into VIEWS

  const VIEWS = [
    {
      key: "1",
      label: "Overview",
      fn: () => renderOverview(records, detections),
    },
    {
      key: "2",
      label: "Projects",
      // rendered specially via proj state — fn used only for non-interactive fallback
      fn: () => renderPerProjectCursor(records, proj.cursor),
    },
    { key: "3", label: "Per Tool", fn: () => renderPerTool(records) },
    { key: "4", label: "Tool/Month", fn: () => renderPerToolPerMonth(records) },
    { key: "5", label: "Per Month", fn: () => renderPerMonth(records) },
    { key: "6", label: "Per Week", fn: () => renderPerWeek(records) },
    {
      key: "7",
      label: `Top ${topN}`,
      fn: () => renderTopSessions(records, topN),
    },
    { key: "8", label: "Detections", fn: () => renderDetections(detections) },
    { key: "9", label: "Notes", fn: () => renderNotes(detections, errors) },
  ];

  // Project drill-down state (only active when current === PROJECTS_VIEW).
  const proj = { mode: "list", cursor: 0, name: null };
  const projectItems = () => perProject(records);

  // One reserved row each for tab bar and status bar.
  const CHROME = 2;

  function usableRows() {
    return Math.max(1, (process.stdout.rows || 24) - CHROME);
  }
  function termWidth() {
    return process.stdout.columns || 100;
  }

  let current = 0;
  let scrollY = 0;
  let lines = []; // raw rendered lines of the current view
  let dirty = true; // full redraw needed (e.g. after resize)

  function loadView() {
    let raw;
    if (current === PROJECTS_VIEW) {
      raw =
        proj.mode === "detail"
          ? renderProjectSessions(records, proj.name)
          : renderPerProjectCursor(records, proj.cursor);
    } else {
      raw = VIEWS[current].fn() || chalk.dim("  (no data)");
    }
    lines = raw.split("\n");
    // Auto-scroll so the cursor row stays visible in list mode.
    if (current === PROJECTS_VIEW && proj.mode === "list") {
      const markerLine = lines.findIndex((l) => l.includes(CURSOR_MARK));
      if (markerLine >= 0) {
        const usable = usableRows();
        if (markerLine < scrollY) scrollY = markerLine;
        else if (markerLine >= scrollY + usable)
          scrollY = markerLine - usable + 1;
      }
    } else {
      scrollY = 0;
    }
  }

  function tabBar() {
    const w = termWidth();
    const tabs = VIEWS.map((v, i) => {
      const label = ` ${v.key}:${v.label} `;
      return i === current ? chalk.bgCyan.black.bold(label) : chalk.dim(label);
    }).join(chalk.dim("│"));
    const pad = Math.max(0, w - visLen(tabs));
    return tabs + " ".repeat(pad);
  }

  function statusBar() {
    const w = termWidth();
    const usable = usableRows();
    const total = lines.length;
    const pct =
      total <= usable
        ? chalk.dim(" all ")
        : chalk.dim(` ${Math.round(((scrollY + usable) / total) * 100)}% `);

    let hint;
    if (current === PROJECTS_VIEW && proj.mode === "list") {
      hint = chalk.dim("  ↑/↓ navigate  Enter select  ←/→ switch view  q quit");
    } else if (current === PROJECTS_VIEW && proj.mode === "detail") {
      hint = chalk.dim("  ↑/↓ j/k scroll  PgUp/PgDn  Esc back  q quit");
    } else {
      hint = chalk.dim(
        "  ←/→ h/l switch  ↑/↓ j/k scroll  PgUp/PgDn  g/G top/bot  q quit",
      );
    }
    const gap = Math.max(1, w - visLen(hint) - visLen(pct));
    return chalk.bgBlack(hint + " ".repeat(gap) + pct);
  }

  // Clip a line to w visible chars, preserving ANSI sequences.
  function clipLine(line, w) {
    const visible = line.replace(ANSI_RE, "");
    if (visible.length <= w) return line;
    let kept = 0,
      out = "";
    for (let i = 0; i < line.length; ) {
      if (line[i] === "\x1b") {
        const end = line.indexOf("m", i);
        if (end !== -1) {
          out += line.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }
      if (kept < w) {
        out += line[i];
        kept++;
      }
      i++;
    }
    return out + "\x1b[0m";
  }

  function draw(forceFullClear) {
    const rows = process.stdout.rows || 24;
    const usable = Math.max(1, rows - CHROME);
    const w = termWidth();
    const maxScroll = Math.max(0, lines.length - usable);
    if (scrollY > maxScroll) scrollY = maxScroll;

    // Full clear on first draw or resize; partial rewrite otherwise.
    if (forceFullClear) process.stdout.write("\x1b[2J");

    // Tab bar pinned to row 1.
    process.stdout.write("\x1b[1;1H" + clipLine(tabBar(), w) + "\x1b[K");

    // Content rows 2 … rows-1.
    const slice = lines.slice(scrollY, scrollY + usable);
    while (slice.length < usable) slice.push("");
    for (let i = 0; i < slice.length; i++) {
      process.stdout.write(
        `\x1b[${i + 2};1H` + clipLine(slice[i], w) + "\x1b[K",
      );
    }

    // Status bar pinned to last row.
    process.stdout.write(
      `\x1b[${rows};1H` + clipLine(statusBar(), w) + "\x1b[K",
    );
    dirty = false;
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  loadView();
  // Enter alternate screen buffer so the TUI never clobbers terminal scrollback.
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  draw(true);

  process.stdout.on("resize", () => {
    draw(true);
  });

  return new Promise((resolve) => {
    function quit() {
      // Leave alternate screen — original terminal content is restored automatically.
      process.stdout.write("\x1b[?25h\x1b[?1049l");
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    }

    process.stdin.on("keypress", (_str, key) => {
      if (!key) return;
      const usable = usableRows();
      const maxScroll = Math.max(0, lines.length - usable);

      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        quit();
        return;
      }

      // --- Projects view special handling ---
      if (current === PROJECTS_VIEW) {
        if (proj.mode === "list") {
          const items = projectItems();
          if (key.name === "down" || key.name === "j") {
            proj.cursor = Math.min(proj.cursor + 1, items.length - 1);
            loadView();
            draw(false);
            return;
          }
          if (key.name === "up" || key.name === "k") {
            proj.cursor = Math.max(0, proj.cursor - 1);
            loadView();
            draw(false);
            return;
          }
          if (key.name === "return") {
            if (items.length > 0) {
              proj.name = items[proj.cursor].project;
              proj.mode = "detail";
              loadView();
              draw(false);
            }
            return;
          }
        } else {
          // detail mode — Esc goes back to list
          if (key.name === "escape" || key.name === "backspace") {
            proj.mode = "list";
            loadView();
            draw(false);
            return;
          }
        }
      }

      // --- Global view switching (not available in Projects detail mode) ---
      if (!(current === PROJECTS_VIEW && proj.mode === "detail")) {
        if (key.name === "right" || key.name === "l" || key.name === "tab") {
          current = (current + 1) % VIEWS.length;
          if (current === PROJECTS_VIEW) proj.mode = "list";
          loadView();
          draw(false);
          return;
        }
        if (key.name === "left" || key.name === "h") {
          current = (current - 1 + VIEWS.length) % VIEWS.length;
          if (current === PROJECTS_VIEW) proj.mode = "list";
          loadView();
          draw(false);
          return;
        }
        if (_str && /^[1-9]$/.test(_str)) {
          const idx = parseInt(_str, 10) - 1;
          if (idx < VIEWS.length) {
            current = idx;
            if (current === PROJECTS_VIEW) proj.mode = "list";
            loadView();
            draw(false);
            return;
          }
        }
      }

      // Scrolling
      let moved = false;
      if (key.name === "down" || key.name === "j") {
        scrollY = Math.min(scrollY + 1, maxScroll);
        moved = true;
      } else if (key.name === "up" || key.name === "k") {
        scrollY = Math.max(0, scrollY - 1);
        moved = true;
      } else if (key.name === "pagedown" || key.name === "space") {
        scrollY = Math.min(scrollY + usable, maxScroll);
        moved = true;
      } else if (key.name === "pageup") {
        scrollY = Math.max(0, scrollY - usable);
        moved = true;
      } else if (key.name === "home" || key.name === "g") {
        scrollY = 0;
        moved = true;
      } else if (key.name === "end" || key.name === "G") {
        scrollY = maxScroll;
        moved = true;
      }

      if (moved) draw(false);
    });
  });
}
