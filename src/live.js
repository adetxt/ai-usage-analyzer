import { openSync, closeSync, fstatSync, readSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const FIELDS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export class LiveUsageTailer {
  constructor(detections) {
    this.roots = [];
    for (const d of detections) {
      if (!d.path || !['claude', 'codex'].includes(d.key) || d.status === 'absent') continue;
      if (d.key === 'codex' && basename(d.path) === 'archived_sessions') continue;
      this.roots.push({ path: d.path, tool: d.key });
    }
    this.directories = new Map();
    this.files = new Map();
    this.events = [];
    this.started = false;
    this.lastFull = 0;
  }

  tick(now = Date.now()) {
    const full = !this.started || now - this.lastFull >= 60000;
    if (full) this.lastFull = now;
    const discovered = new Set();
    const walk = (dir, tool) => {
      let st;
      try { st = statSync(dir); } catch { return; }
      if (!st.isDirectory()) return;
      const key = `${tool}:${dir}`;
      let cached = this.directories.get(key);
      if (!cached || cached.mtime !== st.mtimeMs || full) {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        cached = { mtime: st.mtimeMs, dirs: [], files: [] };
        for (const entry of entries) {
          if (entry.isDirectory() && !(tool === 'claude' && entry.name === 'subagents') && !(tool === 'codex' && entry.name === 'archived_sessions')) cached.dirs.push(join(dir, entry.name));
          else if (entry.isFile() && entry.name.endsWith('.jsonl') && (tool !== 'codex' || entry.name.startsWith('rollout-'))) cached.files.push(join(dir, entry.name));
        }
        this.directories.set(key, cached);
      }
      for (const child of cached.dirs) walk(child, tool);
      for (const file of cached.files) {
        const id = `${tool}:${file}`;
        discovered.add(id);
        if (!this.files.has(id)) this.files.set(id, { path: file, tool, offset: null, partial: Buffer.alloc(0), seen: new Map(), total: null, mtime: 0 });
      }
    };
    for (const root of this.roots) walk(root.path, root.tool);
    for (const [key, file] of this.files) {
      if (!discovered.has(key)) { this.files.delete(key); continue; }
      if (file.offset !== null && !full && now - file.mtime > 600000) continue;
      this.readFile(file, now);
    }
    this.started = true;
    this.events = this.events.filter(e => e.ts > now - 3600000);
    return this.rate(now, 600);
  }

  readFile(file, now) {
    let fd;
    try {
      fd = openSync(file.path, 'r');
      const st = fstatSync(fd);
      const identity = `${st.dev}:${st.ino}`;
      let changedBoundary = false;
      if (file.offset !== null && file.offset > 0 && file.boundary && st.size >= file.offset) {
        const sample = Buffer.alloc(file.boundary.length);
        const size = readSync(fd, sample, 0, sample.length, file.offset - sample.length);
        changedBoundary = size !== sample.length || !sample.equals(file.boundary);
      }
      if (file.offset === null) {
        file.offset = this.started ? 0 : st.size;
        file.identity = identity;
      } else if (file.identity !== identity || st.size < file.offset || changedBoundary) {
        file.offset = 0;
        file.identity = identity;
        file.partial = Buffer.alloc(0);
        file.seen.clear();
        file.total = null;
      }
      file.mtime = st.mtimeMs;
      while (file.offset < st.size) {
        const buffer = Buffer.allocUnsafe(Math.min(65536, st.size - file.offset));
        const size = readSync(fd, buffer, 0, buffer.length, file.offset);
        if (!size) break;
        file.offset += size;
        const data = Buffer.concat([file.partial, buffer.subarray(0, size)]);
        let from = 0, end;
        while ((end = data.indexOf(10, from)) !== -1) {
          this.consume(file, data.subarray(from, end).toString('utf8'), now);
          from = end + 1;
        }
        file.partial = data.subarray(from);
      }
      const sample = Buffer.alloc(Math.min(64, file.offset));
      if (sample.length) {
        const size = readSync(fd, sample, 0, sample.length, file.offset - sample.length);
        file.boundary = sample.subarray(0, size);
      } else file.boundary = sample;
    } catch {} finally { if (fd !== undefined) closeSync(fd); }
  }

  consume(file, line, now) {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    let tokens = 0;
    if (file.tool === 'claude' && event.type === 'assistant' && event.message?.usage) {
      const usage = event.message.usage;
      const id = event.message.id ? JSON.stringify([event.message.id, event.requestId || null]) : null;
      const previous = id ? file.seen.get(id) || {} : {};
      const next = {};
      for (const field of FIELDS) {
        next[field] = Math.max(count(previous[field]), count(usage[field]));
        tokens += next[field] - count(previous[field]);
      }
      if (id) file.seen.set(id, next);
    } else if (file.tool === 'codex' && event.type === 'event_msg' && event.payload?.type === 'token_count') {
      const info = event.payload.info || {};
      const total = info.total_token_usage;
      const key = total ? JSON.stringify(total) : null;
      if (key && key === file.total) return;
      if (key) file.total = key;
      if (info.last_token_usage) tokens = count(info.last_token_usage.input_tokens) + count(info.last_token_usage.output_tokens);
    }
    if (tokens > 0) this.events.push({ ts: now, tokens });
  }

  rate(now = Date.now(), seconds = 600) {
    return this.events.filter(e => e.ts > now - seconds * 1000 && e.ts <= now).reduce((sum, e) => sum + e.tokens, 0) * 60 / seconds;
  }
}
