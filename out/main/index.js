import { dialog, shell, safeStorage, session, WebContentsView, BrowserWindow, ipcMain, clipboard, app, nativeImage } from "electron";
import { join, basename, relative, sep, resolve, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, watch, chmodSync, statSync, createReadStream, createWriteStream } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { homedir, userInfo, tmpdir } from "node:os";
import { readFile, stat, readdir, mkdir, writeFile, unlink, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { spawn } from "@lydell/node-pty";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
const configDir = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "nyxium") : join(homedir(), ".config", "nyxium");
const dataDir = process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "nyxium") : join(homedir(), ".local", "share", "nyxium");
mkdirSync(configDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });
const dataPath = (f) => join(dataDir, f);
class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
  }
  file;
  fallback;
  cache = null;
  get full() {
    return join(configDir, this.file);
  }
  read() {
    if (this.cache) return this.cache;
    try {
      this.cache = { ...this.fallback, ...JSON.parse(readFileSync(this.full, "utf8")) };
    } catch {
      this.cache = this.fallback;
    }
    return this.cache;
  }
  write(value) {
    this.cache = value;
    const tmp = `${this.full}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    renameSync(tmp, this.full);
    return value;
  }
  patch(patch) {
    return this.write({ ...this.read(), ...patch });
  }
}
const H = homedir();
const CANDIDATES = {
  matugen: [
    join(H, ".cache/matugen/colors.json"),
    join(H, ".config/matugen/colors.json"),
    join(H, ".local/state/matugen/colors.json")
  ],
  pywal: [join(H, ".cache/wal/colors.json"), join(H, ".cache/wal/colors")],
  wallust: [
    join(H, ".cache/wallust/colors.json"),
    join(H, ".cache/wallust/sequences.json"),
    join(H, ".config/wallust/colors.json")
  ],
  end4: [
    join(H, ".local/state/quickshell/user/generated/colors.json"),
    join(H, ".cache/ags/user/colors.json"),
    join(H, ".local/state/ags/user/colors.json")
  ]
};
const FALLBACK = {
  background: "#0d0f14",
  surface: "#141821",
  surfaceVariant: "#1b2030",
  surfaceElevated: "#1f2535",
  textPrimary: "#e6e9f0",
  textSecondary: "#a8b0c2",
  textMuted: "#6b7488",
  accent: "#7aa2f7",
  accentContainer: "#263455",
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  info: "#7dcfff",
  border: "#232838",
  divider: "#1c2130",
  selection: "#2b3650",
  terminalBackground: "#0d0f14",
  terminalForeground: "#e6e9f0",
  codeBackground: "#11151e",
  codeForeground: "#dce1ec",
  primary: "#7aa2f7",
  onPrimary: "#0b1120",
  primaryContainer: "#263455",
  onPrimaryContainer: "#cddcff",
  secondary: "#9aa5c4",
  onSecondary: "#11151e",
  secondaryContainer: "#242a3b",
  onSecondaryContainer: "#dde3f3",
  tertiary: "#bb9af7",
  onTertiary: "#150f22",
  onBackground: "#e6e9f0",
  onSurface: "#e6e9f0",
  onSurfaceVariant: "#a8b0c2",
  outline: "#3a4255",
  outlineVariant: "#242a3b",
  onError: "#2a0d14",
  errorContainer: "#4a1c26"
};
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
function norm(c) {
  if (typeof c !== "string") return null;
  const m = c.trim().match(HEX);
  if (!m) return null;
  const h = m[1];
  return `#${h.length === 3 ? h.split("").map((x) => x + x).join("") : h}`.toLowerCase();
}
function parseRaw(text) {
  const out = { colors: [] };
  try {
    const json = JSON.parse(text);
    const special = json.special ?? {};
    const colorsObj = json.colors ?? json;
    out.background = norm(special.background ?? colorsObj.background ?? json.background) ?? void 0;
    out.foreground = norm(special.foreground ?? colorsObj.foreground ?? json.foreground) ?? void 0;
    out.cursor = norm(special.cursor) ?? void 0;
    for (let i = 0; i < 16; i++) {
      const v = norm(colorsObj[`color${i}`]) ?? norm(json[`color${i}`]);
      if (v) out.colors[i] = v;
    }
    const mat = json.dark ?? colorsObj;
    const prim = norm(mat.primary) ?? norm(mat.accent) ?? norm(json.primary);
    if (prim) out.colors[4] = prim;
    const surf = norm(mat.surface);
    if (surf && !out.background) out.background = surf;
    if (out.colors.filter(Boolean).length || out.background) return out;
  } catch {
    const lines2 = text.split("\n").map(norm).filter((x) => !!x);
    if (lines2.length >= 8) {
      out.colors = lines2.slice(0, 16);
      out.background = lines2[0];
      out.foreground = lines2[7];
      return out;
    }
  }
  return null;
}
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh) => {
    const x = Math.round((pa >> sh & 255) * (1 - t) + (pb >> sh & 255) * t);
    return Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
};
function derive(raw) {
  const c = raw.colors;
  const bg = raw.background ?? c[0] ?? FALLBACK.background;
  const fg = raw.foreground ?? c[15] ?? c[7] ?? FALLBACK.textPrimary;
  const mode = lum(bg) < 0.5 ? "dark" : "light";
  const up = mode === "dark" ? fg : bg;
  const accent = c[4] ?? c[12] ?? FALLBACK.accent;
  const lift = (t) => mix(bg, up, t);
  return {
    mode,
    background: bg,
    surface: lift(0.05),
    surfaceVariant: lift(0.1),
    surfaceElevated: lift(0.14),
    textPrimary: fg,
    textSecondary: mix(fg, bg, 0.3),
    textMuted: mix(fg, bg, 0.55),
    accent,
    accentContainer: mix(bg, accent, 0.22),
    success: c[2] ?? FALLBACK.success,
    warning: c[3] ?? FALLBACK.warning,
    error: c[1] ?? FALLBACK.error,
    info: c[6] ?? FALLBACK.info,
    border: lift(0.16),
    divider: lift(0.1),
    selection: mix(bg, accent, 0.3),
    terminalBackground: bg,
    terminalForeground: fg,
    codeBackground: lift(0.03),
    codeForeground: mix(fg, bg, 0.1),
    primary: accent,
    onPrimary: lum(accent) > 0.5 ? "#0b0d12" : "#ffffff",
    primaryContainer: mix(bg, accent, 0.22),
    onPrimaryContainer: mix(accent, up, 0.45),
    secondary: c[5] ?? mix(accent, fg, 0.4),
    onSecondary: bg,
    secondaryContainer: lift(0.12),
    onSecondaryContainer: fg,
    tertiary: c[13] ?? c[5] ?? FALLBACK.tertiary,
    onTertiary: bg,
    onBackground: fg,
    onSurface: fg,
    onSurfaceVariant: mix(fg, bg, 0.35),
    outline: lift(0.28),
    outlineVariant: lift(0.14),
    onError: bg,
    errorContainer: mix(bg, c[1] ?? FALLBACK.error, 0.25)
  };
}
function detect(custom2 = {}) {
  return Object.keys(CANDIDATES).map((id) => {
    const list = [custom2[id], ...CANDIDATES[id]].filter((p) => !!p);
    const path = list.find((p) => existsSync(p)) ?? null;
    return { id, available: !!path, path };
  });
}
async function load(source, custom2 = {}, manual = {}) {
  if (source === "manual") {
    return {
      provider: "manual",
      source: "manual",
      mode: "dark",
      colors: { ...FALLBACK, ...manual }
    };
  }
  const found = detect(custom2).filter((p) => p.available);
  const pick = source === "auto" ? found[0] : found.find((p) => p.id === source);
  if (pick?.path) {
    try {
      const raw = parseRaw(await readFile(pick.path, "utf8"));
      if (raw) {
        const { mode, ...colors } = derive(raw);
        return { provider: pick.id, source: pick.path, mode, colors };
      }
    } catch {
    }
  }
  return { provider: "manual", source: "built-in", mode: "dark", colors: FALLBACK };
}
function watchPalettes(custom2, onChange) {
  const watchers = [];
  let timer = null;
  for (const p of detect(custom2)) {
    if (!p.path) continue;
    try {
      const w = watch(p.path, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(onChange, 150);
      });
      watchers.push(w);
    } catch {
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    watchers.forEach((w) => w.close());
  };
}
function run(cmd, args, cwd, timeout = 5e3) {
  return new Promise((resolve2) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve2({ ok: !err, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
const VERSION_PROBES = [
  ["Node", "node", ["--version"]],
  ["npm", "npm", ["--version"]],
  ["pnpm", "pnpm", ["--version"]],
  ["Bun", "bun", ["--version"]],
  ["Python", "python3", ["--version"]],
  ["PHP", "php", ["--version"]],
  ["Rust", "rustc", ["--version"]],
  ["Go", "go", ["version"]],
  ["Docker", "docker", ["--version"]],
  ["Git", "git", ["--version"]]
];
const firstVersion = (s) => s.match(/\d+(\.\d+)*/)?.[0] ?? null;
async function detectEnvironment(cwd) {
  const results = await Promise.all(
    VERSION_PROBES.map(async ([name, bin, args]) => {
      const r = await run(bin, args, cwd, 4e3);
      return { name, version: r.ok ? firstVersion(r.stdout || r.stderr) : null };
    })
  );
  return results;
}
const MARKERS = [
  [".git", ["Git"]],
  ["package.json", ["Node"]],
  ["composer.json", ["PHP", "Composer"]],
  ["Cargo.toml", ["Rust", "Cargo"]],
  ["go.mod", ["Go"]],
  ["requirements.txt", ["Python"]],
  ["pyproject.toml", ["Python"]],
  ["Dockerfile", ["Docker"]],
  ["docker-compose.yml", ["Docker Compose"]],
  ["docker-compose.yaml", ["Docker Compose"]],
  ["flake.nix", ["Nix"]],
  ["Makefile", ["Make"]],
  ["pnpm-lock.yaml", ["pnpm"]],
  ["package-lock.json", ["npm"]],
  ["yarn.lock", ["Yarn"]],
  ["artisan", ["Laravel"]]
];
const DEP_TAGS = [
  ["electron", "Electron"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["next", "Next.js"],
  ["vite", "Vite"],
  ["typescript", "TypeScript"],
  ["tailwindcss", "Tailwind"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["prisma", "Prisma"]
];
async function detectStack(dir) {
  const tags = /* @__PURE__ */ new Set();
  for (const [file, add] of MARKERS) {
    if (existsSync(join(dir, file))) add.forEach((t) => tags.add(t));
  }
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const { readFile: readFile2 } = await import("node:fs/promises");
      const pkg = JSON.parse(await readFile2(pkgPath, "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, tag] of DEP_TAGS) if (deps[dep]) tags.add(tag);
    } catch {
    }
  }
  return [...tags];
}
async function gitSummary(dir) {
  const empty = { isRepo: false, branch: null, dirty: 0, ahead: 0, behind: 0 };
  if (!existsSync(join(dir, ".git"))) return empty;
  const status2 = await run("git", ["status", "--porcelain=v1", "--branch"], dir);
  if (!status2.ok) return empty;
  const lines2 = status2.stdout.split("\n").filter(Boolean);
  const head = lines2.find((l) => l.startsWith("##")) ?? "";
  const branch = head.replace(/^## /, "").split(/\.\.\.|\s/)[0] || null;
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0);
  const dirty = lines2.filter((l) => !l.startsWith("##")).length;
  return { isRepo: true, branch, dirty, ahead, behind };
}
const workspaceStore = new JsonStore("workspaces.json", {
  items: [
    { id: "personal", name: "Personal" },
    { id: "work", name: "Work" }
  ]
});
const projectStore = new JsonStore("projects.json", { items: [] });
const BUILTIN_SERVICES = [
  { name: "GitHub", url: "https://github.com" },
  { name: "GitLab", url: "https://gitlab.com" },
  { name: "Replit", url: "https://replit.com" },
  { name: "Laravel", url: "https://laravel.com/docs" },
  { name: "Vercel", url: "https://vercel.com/dashboard" },
  { name: "Netlify", url: "https://app.netlify.com" },
  { name: "StackBlitz", url: "https://stackblitz.com" },
  { name: "CodeSandbox", url: "https://codesandbox.io" },
  { name: "Figma", url: "https://figma.com" },
  { name: "Linear", url: "https://linear.app" },
  { name: "Jira", url: "https://jira.atlassian.com" },
  { name: "Supabase", url: "https://supabase.com/dashboard" },
  { name: "Firebase", url: "https://console.firebase.google.com" },
  { name: "npm", url: "https://npmjs.com" },
  { name: "Docker Hub", url: "https://hub.docker.com" },
  { name: "MDN", url: "https://developer.mozilla.org" },
  { name: "Stack Overflow", url: "https://stackoverflow.com" }
];
const serviceStore = new JsonStore("services.json", {
  items: BUILTIN_SERVICES.map((s) => ({
    ...s,
    id: s.name.toLowerCase().replace(/\W+/g, "-"),
    icon: null,
    projectId: null,
    workspaceId: null,
    pinned: false,
    builtin: true
  }))
});
const notificationStore = new JsonStore("notifications.json", {
  items: []
});
async function importProject(workspaceId) {
  const r = await dialog.showOpenDialog({
    title: "Import project directory",
    properties: ["openDirectory"]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return registerPath(r.filePaths[0], workspaceId);
}
async function registerPath(path, workspaceId) {
  if (!existsSync(path)) return null;
  const { items } = projectStore.read();
  const existing = items.find((p) => p.path === path);
  if (existing) return existing;
  const project = {
    id: randomUUID(),
    name: basename(path),
    path,
    stack: await detectStack(path),
    workspaceId,
    createdAt: Date.now(),
    lastOpenedAt: null,
    notes: ""
  };
  projectStore.write({ items: [project, ...items] });
  return project;
}
const reveal = (path) => shell.openPath(path);
function pushNotification(n) {
  const full = { ...n, id: randomUUID(), at: Date.now(), read: false };
  const { items } = notificationStore.read();
  notificationStore.write({ items: [full, ...items].slice(0, 200) });
  return full;
}
const git = (cwd, args, timeout = 15e3) => run("git", args, cwd, timeout);
const STATUS_LABEL = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
  "?": "untracked"
};
async function status$1(cwd) {
  const r = await git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!r.ok) return [];
  const out = [];
  const parts = r.stdout.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const [x, y] = parts[i];
    const path = parts[i].slice(3);
    if (x === "R" || x === "C") i++;
    if (x === "?") {
      out.push({ path, staged: false, status: "untracked" });
      continue;
    }
    if (x !== " ") out.push({ path, staged: true, status: STATUS_LABEL[x] ?? "modified" });
    if (y !== " ") out.push({ path, staged: false, status: STATUS_LABEL[y] ?? "modified" });
  }
  return out;
}
async function diff(cwd, file, staged = false) {
  const args = ["diff", "--no-color", ...staged ? ["--cached"] : [], ...file ? ["--", file] : []];
  const r = await git(cwd, args);
  if (r.stdout.trim()) return r.stdout;
  if (file && !staged) {
    const show2 = await run("git", ["status", "--porcelain=v1", "--", file], cwd);
    if (show2.stdout.startsWith("??")) {
      const cat = await run("cat", [file], cwd);
      if (cat.ok) return cat.stdout.split("\n").map((l) => `+${l}`).join("\n");
    }
  }
  return r.stdout;
}
async function log(cwd, limit = 50) {
  const SEP = "";
  const r = await git(cwd, ["log", `-${Math.min(limit, 500)}`, `--pretty=format:%H${SEP}%h${SEP}%an${SEP}%at${SEP}%s${SEP}%D`]);
  if (!r.ok) return [];
  return r.stdout.split("\n").filter(Boolean).map((line) => {
    const [hash, short, author, at, subject, refs] = line.split(SEP);
    return { hash, short, author, at: Number(at) * 1e3, subject, refs: refs ? refs.split(", ").filter(Boolean) : [] };
  });
}
async function branches(cwd) {
  const r = await git(cwd, ["branch", "--all", "--format=%(refname:short)%(HEAD)%(upstream:short)"]);
  if (!r.ok) return [];
  return r.stdout.split("\n").filter(Boolean).map((l) => {
    const [name, head, upstream] = l.split("");
    return { name, current: head === "*", remote: name.startsWith("remotes/"), upstream: upstream || null };
  });
}
async function stashes(cwd) {
  const r = await git(cwd, ["stash", "list", "--pretty=format:%gd%s%at"]);
  if (!r.ok) return [];
  return r.stdout.split("\n").filter(Boolean).map((l) => {
    const [ref, subject, at] = l.split("");
    return { ref, subject, at: Number(at) * 1e3 };
  });
}
const stage = (cwd, paths) => git(cwd, ["add", "--", ...paths]);
const unstage = (cwd, paths) => git(cwd, ["restore", "--staged", "--", ...paths]);
const discard = (cwd, paths) => git(cwd, ["checkout", "--", ...paths]);
const commit = (cwd, message) => git(cwd, ["commit", "-m", message]);
const pull = (cwd) => git(cwd, ["pull", "--ff-only"], 6e4);
const push = (cwd) => git(cwd, ["push"], 6e4);
const fetch$1 = (cwd) => git(cwd, ["fetch", "--all", "--prune"], 6e4);
const checkout = (cwd, name) => git(cwd, ["checkout", name]);
const createBranch = (cwd, name) => git(cwd, ["checkout", "-b", name]);
const merge = (cwd, name) => git(cwd, ["merge", "--no-edit", name]);
const stashPush = (cwd, message) => git(cwd, ["stash", "push", ...message ? ["-m", message] : []]);
const stashPop = (cwd, ref) => git(cwd, ["stash", "pop", ref]);
const stashDrop = (cwd, ref) => git(cwd, ["stash", "drop", ref]);
const CANDIDATE_SHELLS = ["/bin/fish", "/usr/bin/fish", "/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"];
function detectShells() {
  const login = (() => {
    try {
      return userInfo().shell ?? null;
    } catch {
      return null;
    }
  })();
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const p of [login, ...CANDIDATE_SHELLS]) {
    if (!p || seen.has(p) || !existsSync(p)) continue;
    seen.add(p);
    out.push({ path: p, name: p.split("/").pop() });
  }
  return out;
}
const sessions = /* @__PURE__ */ new Map();
function createSession$1(win, opts) {
  const shells = detectShells();
  const shell2 = opts.shell && shells.some((s) => s.path === opts.shell) ? opts.shell : shells[0]?.path;
  if (!shell2) throw new Error("No usable shell found on this system");
  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : homedir();
  const pty = spawn(shell2, [], {
    name: "xterm-256color",
    cols: Math.max(2, opts.cols ?? 80),
    rows: Math.max(2, opts.rows ?? 24),
    cwd,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", NYXIUM: "1" }
  });
  const id = randomUUID();
  sessions.set(id, { pty, windowId: win.id });
  pty.onData((data) => {
    if (!win.isDestroyed()) win.webContents.send("terminal:data", { id, data });
  });
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    if (!win.isDestroyed()) win.webContents.send("terminal:exit", { id, exitCode });
  });
  return { id, shell: shell2 };
}
function write$1(id, data) {
  sessions.get(id)?.pty.write(data);
}
function resize(id, cols, rows) {
  const s = sessions.get(id);
  if (s) s.pty.resize(Math.max(2, Math.floor(cols)), Math.max(2, Math.floor(rows)));
}
function kill(id) {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.kill();
  } catch {
  }
  sessions.delete(id);
}
function killForWindow(windowId) {
  for (const [id, s] of sessions) if (s.windowId === windowId) {
    kill(id);
  }
}
const SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".tmp",
  ".next",
  ".turbo",
  "vendor",
  ".gradle",
  "coverage"
]);
const MAX_FILE_BYTES = 512 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|zst|xz|tar|mp4|mp3|wav|woff2?|ttf|so|a|o|bin|wasm|exe|class|jar)$/i;
async function* walk(root, maxFiles) {
  const queue = [root];
  let seen = 0;
  while (queue.length && seen < maxFiles) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".env.example") {
        if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      }
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) queue.push(full);
      } else if (e.isFile() && !BINARY_EXT.test(e.name)) {
        seen++;
        yield full;
        if (seen >= maxFiles) return;
      }
    }
  }
}
async function searchFiles(root, query2, limit = 60) {
  const q = query2.toLowerCase();
  const hits = [];
  for await (const file of walk(root, 2e4)) {
    const rel = relative(root, file);
    if (!q || rel.toLowerCase().includes(q)) {
      hits.push({ path: rel });
      if (hits.length >= limit) break;
    }
  }
  return hits.sort((a, b) => a.path.split(sep).length - b.path.split(sep).length);
}
async function searchCode(root, query2, opts = {}) {
  if (!query2.trim()) return [];
  const limit = opts.limit ?? 80;
  const maxPerFile = opts.maxPerFile ?? 4;
  const needle = query2.toLowerCase();
  const hits = [];
  for await (const file of walk(root, 2e4)) {
    if (hits.length >= limit) break;
    try {
      const info = await stat(file);
      if (info.size > MAX_FILE_BYTES) continue;
      const text = await readFile(file, "utf8");
      if (!text.toLowerCase().includes(needle)) continue;
      const lines2 = text.split("\n");
      let perFile = 0;
      for (let i = 0; i < lines2.length && perFile < maxPerFile && hits.length < limit; i++) {
        if (!lines2[i].toLowerCase().includes(needle)) continue;
        perFile++;
        hits.push({ path: relative(root, file), line: i + 1, text: lines2[i].slice(0, 400).trim() });
      }
    } catch {
    }
  }
  return hits;
}
async function findSymbol(root, name, limit = 30) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `\\b(function|class|interface|type|struct|enum|trait|impl|const|let|var|def|fn|public|private|protected)\\b[^\\n]*\\b${escaped}\\b`
  );
  const hits = [];
  for await (const file of walk(root, 2e4)) {
    if (hits.length >= limit) break;
    try {
      const info = await stat(file);
      if (info.size > MAX_FILE_BYTES) continue;
      const lines2 = (await readFile(file, "utf8")).split("\n");
      for (let i = 0; i < lines2.length && hits.length < limit; i++) {
        if (re.test(lines2[i])) hits.push({ path: relative(root, file), line: i + 1, text: lines2[i].slice(0, 400).trim() });
      }
    } catch {
    }
  }
  return hits;
}
const snippetStore = new JsonStore("snippets.json", { items: [] });
const SNIPPET_LANGUAGES = [
  "bash",
  "c",
  "cpp",
  "rust",
  "go",
  "javascript",
  "typescript",
  "python",
  "php",
  "laravel",
  "sql",
  "nix",
  "docker",
  "git"
];
function upsert(id, draft) {
  const { items } = snippetStore.read();
  const now = Date.now();
  const lang = SNIPPET_LANGUAGES.includes(draft.language) ? draft.language : "bash";
  const base2 = {
    title: (draft.title ?? "Untitled").slice(0, 160),
    language: lang,
    code: (draft.code ?? "").slice(0, 5e5),
    tags: (draft.tags ?? []).slice(0, 20).map((t) => String(t).slice(0, 40)),
    favorite: !!draft.favorite,
    projectId: draft.projectId ?? null
  };
  const next = id ? items.map((s) => s.id === id ? { ...s, ...base2, updatedAt: now } : s) : [{ id: randomUUID(), ...base2, createdAt: now, updatedAt: now }, ...items];
  return snippetStore.write({ items: next }).items;
}
function remove$1(id) {
  return snippetStore.write({ items: snippetStore.read().items.filter((s) => s.id !== id) }).items;
}
const DEFAULT_CONFIG = {
  theme: "dark",
  density: "comfortable",
  reducedMotion: false,
  sidebarCollapsed: false,
  palette: { enabled: true, source: "auto", customPaths: {}, manual: {} },
  activeWorkspaceId: "personal",
  terminal: { shell: null, fontSize: 13, fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace' }
};
const DEFAULT_AI_CONFIG = {
  enabled: true,
  provider: "ollama",
  endpoints: {
    ollama: "http://127.0.0.1:11434",
    llamacpp: "http://127.0.0.1:8080",
    "openai-compatible": "http://127.0.0.1:8000/v1",
    custom: ""
  },
  model: null,
  temperature: 0.2,
  contextSize: 8192,
  maxTokens: 2048,
  mode: "agent",
  resourceMode: "balanced",
  custom: {
    label: "Custom endpoint",
    url: "",
    models: [],
    authHeader: "Authorization",
    authScheme: "Bearer",
    headers: {},
    hasKey: false
  }
};
const DEFAULT_CLOUD_CONFIG = {
  project: "",
  bucket: "",
  prefixes: {},
  backupEnabled: {},
  lastBackupAt: {}
};
const TIMEOUT_MS = 2500;
async function probe(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
async function* lines(res, signal) {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield line;
      }
    }
    if (buf.trim()) yield buf.trim();
  } finally {
    void reader.cancel().catch(() => {
    });
  }
}
const base = (endpoint) => endpoint.replace(/\/+$/, "");
const ollama = {
  id: "ollama",
  label: "Ollama",
  async detect(endpoint) {
    const res = await probe(`${base(endpoint)}/api/tags`);
    return {
      id: "ollama",
      label: "Ollama",
      endpoint,
      available: !!res?.ok,
      detail: res?.ok ? null : "No Ollama server responded at this endpoint."
    };
  },
  async listModels(endpoint) {
    const res = await probe(`${base(endpoint)}/api/tags`);
    if (!res?.ok) return [];
    const json = await res.json();
    const running2 = await probe(`${base(endpoint)}/api/ps`);
    const loaded = /* @__PURE__ */ new Set();
    if (running2?.ok) {
      const ps = await running2.json();
      for (const m of ps.models ?? []) loaded.add(m.name);
    }
    return (json.models ?? []).map((m) => ({
      name: m.name,
      size: m.size ?? null,
      context: null,
      // Ollama reports it only via /api/show, fetched on demand.
      provider: "ollama",
      loaded: loaded.has(m.name),
      family: m.details?.family ?? null
    }));
  },
  async *chat(endpoint, req) {
    const res = await fetch(`${base(endpoint)}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        options: {
          temperature: req.temperature,
          num_ctx: req.contextSize,
          num_predict: req.maxTokens
        },
        ...req.tools?.length ? {
          tools: req.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters }
          }))
        } : {}
      })
    });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    for await (const line of lines(res, req.signal)) {
      let json;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      if (json.error) throw new Error(json.error);
      const calls = json.message?.tool_calls;
      if (calls?.length) {
        yield {
          toolCalls: calls.filter((c) => c.function?.name).map((c) => ({
            name: c.function.name,
            args: typeof c.function.arguments === "string" ? safeJson(c.function.arguments) : c.function.arguments ?? {}
          }))
        };
      }
      if (json.message?.content) yield { text: json.message.content };
      if (json.done) {
        yield { done: true };
        return;
      }
    }
  },
  async pull(endpoint, model, onProgress) {
    const res = await fetch(`${base(endpoint)}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true })
    });
    if (!res.ok) throw new Error(`Ollama refused the pull: ${res.status}`);
    const ctrl = new AbortController();
    for await (const line of lines(res, ctrl.signal)) {
      try {
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        const pct = j.total ? (j.completed ?? 0) / j.total * 100 : 0;
        onProgress(pct, j.status ?? "");
      } catch (e) {
        if (e instanceof Error && e.message && !(e instanceof SyntaxError)) throw e;
      }
    }
  },
  async remove(endpoint, model) {
    const res = await fetch(`${base(endpoint)}/api/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model })
    });
    if (!res.ok) throw new Error(`Ollama could not delete ${model}: ${res.status}`);
  }
};
function openAICompatible(id, label, healthPath) {
  return {
    id,
    label,
    async detect(endpoint, headers) {
      if (!endpoint) {
        return { id, label, endpoint: "", available: false, detail: "No endpoint URL configured." };
      }
      const root = base(endpoint);
      const init = headers ? { headers } : void 0;
      const res = await probe(`${root}${healthPath}`, init) ?? await probe(`${root}/models`, init) ?? await probe(`${root}/v1/models`, init);
      if (!res) {
        return { id, label, endpoint, available: false, detail: `No ${label} server responded at this endpoint.` };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          id,
          label,
          endpoint,
          available: false,
          detail: "The endpoint rejected the credentials. Check the API key."
        };
      }
      if (res.ok) return { id, label, endpoint, available: true, detail: null };
      return {
        id,
        label,
        endpoint,
        available: true,
        detail: `Reachable, but it has no model listing (HTTP ${res.status}). Declare the models you want to use.`
      };
    },
    async listModels(endpoint, headers, declared) {
      if (!endpoint) return [];
      const root = base(endpoint);
      const init = headers ? { headers } : void 0;
      const res = await probe(`${root}/models`, init) ?? await probe(`${root}/v1/models`, init);
      if (!res?.ok) {
        return (declared ?? []).map((name) => ({
          name,
          size: null,
          context: null,
          provider: id,
          loaded: true,
          family: null
        }));
      }
      const json = await res.json();
      return (json.data ?? []).map((m) => ({
        name: m.id,
        size: null,
        context: m.meta?.n_ctx ?? null,
        provider: id,
        loaded: true,
        // These servers hold exactly the model they were started with.
        family: null
      }));
    },
    async *chat(endpoint, req) {
      const root = base(endpoint);
      const url = root.endsWith("/v1") ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...req.headers ?? {} },
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          ...req.tools?.length ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters }
            }))
          } : {}
        })
      });
      if (!res.ok) throw new Error(`${label} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const pending = /* @__PURE__ */ new Map();
      for await (const line of lines(res, req.signal)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break;
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        if (json.error) throw new Error(json.error.message ?? "Inference error");
        const choice = json.choices?.[0];
        for (const call of choice?.delta?.tool_calls ?? []) {
          const i = call.index ?? 0;
          const slot = pending.get(i) ?? { name: "", args: "" };
          if (call.function?.name) slot.name = call.function.name;
          if (call.function?.arguments) slot.args += call.function.arguments;
          pending.set(i, slot);
        }
        if (choice?.delta?.content) yield { text: choice.delta.content };
        if (choice?.finish_reason) {
          if (pending.size) {
            yield {
              toolCalls: [...pending.values()].filter((p) => p.name).map((p) => ({ name: p.name, args: safeJson(p.args) }))
            };
            pending.clear();
          }
          yield { done: true };
          return;
        }
      }
      yield { done: true };
    }
  };
}
const llamacpp = openAICompatible("llamacpp", "llama.cpp", "/health");
const openaiCompatible = openAICompatible("openai-compatible", "OpenAI-compatible", "/models");
const custom = openAICompatible("custom", "Custom endpoint", "/models");
const PROVIDERS = {
  ollama,
  llamacpp,
  "openai-compatible": openaiCompatible,
  custom
};
function customHeaders(cfg, apiKey) {
  const headers = { ...cfg.headers };
  if (apiKey) {
    const scheme = cfg.authScheme.trim();
    headers[cfg.authHeader || "Authorization"] = scheme ? `${scheme} ${apiKey}` : apiKey;
  }
  return headers;
}
function safeJson(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function detectAll(cfg, customKey) {
  return Promise.all(
    Object.keys(PROVIDERS).map((id) => {
      if (id === "custom") {
        return custom.detect(cfg.custom.url, customHeaders(cfg.custom, customKey)).then((b) => ({ ...b, label: cfg.custom.label || "Custom endpoint" }));
      }
      return PROVIDERS[id].detect(cfg.endpoints[id]);
    })
  );
}
function applyResourceMode(cfg) {
  switch (cfg.resourceMode) {
    case "low-ram":
      return { contextSize: Math.min(cfg.contextSize, 4096), maxTokens: Math.min(cfg.maxTokens, 1024), concurrency: 1 };
    case "performance":
      return { contextSize: cfg.contextSize, maxTokens: cfg.maxTokens, concurrency: 3 };
    default:
      return { contextSize: Math.min(cfg.contextSize, 8192), maxTokens: Math.min(cfg.maxTokens, 2048), concurrency: 1 };
  }
}
const FILE = dataPath("credentials.bin");
function read() {
  if (!existsSync(FILE)) return {};
  try {
    const raw = readFileSync(FILE);
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : Buffer.from(raw.toString("utf8"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}
function write(vault) {
  const json = JSON.stringify(vault);
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(Buffer.from(json, "utf8").toString("base64"), "utf8");
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, buf);
  chmodSync(tmp, 384);
  renameSync(tmp, FILE);
}
const getSecret = (key) => read()[key] ?? null;
function setSecret(key, value) {
  const vault = read();
  if (value) vault[key] = value;
  else delete vault[key];
  write(vault);
}
const hasSecret = (key) => !!read()[key];
const encryptionAvailable = () => safeStorage.isEncryptionAvailable();
const SECRET_PATTERNS = [
  /(^|\/)\.env($|\..*)/,
  /\.pem$/,
  /\.key$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)service-account.*\.json$/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_ed25519$/
];
const isSecretPath = (rel) => SECRET_PATTERNS.some((re) => re.test(rel));
function safePath(ctx, input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("A file path is required");
  const root = resolve(ctx.projectPath);
  const abs = resolve(root, input);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel.startsWith(sep) || resolve(abs) === root && input.includes("..")) {
    throw new Error("Path escapes the project directory");
  }
  if (isSecretPath(rel)) throw new Error(`${rel} is a protected credential file and is never read by the agent`);
  return { abs, rel: rel || "." };
}
const TOOLS = [
  {
    name: "read_file",
    tier: "safe",
    description: "Read a UTF-8 text file from the project. Paths are relative to the project root.",
    parameters: { path: { type: "string", description: "Path relative to the project root", required: true } }
  },
  {
    name: "list_directory",
    tier: "safe",
    description: "List the entries of a directory in the project.",
    parameters: { path: { type: "string", description: "Directory relative to the project root" } }
  },
  {
    name: "search_code",
    tier: "safe",
    description: "Search the project for a literal string and return matching lines with their file and line number.",
    parameters: { query: { type: "string", description: "Text to search for", required: true } }
  },
  {
    name: "search_files",
    tier: "safe",
    description: "Find files whose path matches a fragment.",
    parameters: { query: { type: "string", description: "Part of a file name or path", required: true } }
  },
  {
    name: "find_symbol",
    tier: "safe",
    description: "Find likely definitions of a function, class, type or constant.",
    parameters: { name: { type: "string", description: "Symbol name", required: true } }
  },
  {
    name: "git_status",
    tier: "safe",
    description: "List files changed in the working tree.",
    parameters: {}
  },
  {
    name: "git_diff",
    tier: "safe",
    description: "Show the unified diff of the working tree, optionally for one file.",
    parameters: { path: { type: "string", description: "Optional file to diff" } }
  },
  {
    name: "git_log",
    tier: "safe",
    description: "Show recent commits.",
    parameters: { limit: { type: "number", description: "How many commits (default 20)" } }
  },
  {
    name: "git_branch",
    tier: "safe",
    description: "List branches and show which one is checked out.",
    parameters: {}
  },
  {
    name: "write_file",
    tier: "confirm",
    description: "Replace the entire contents of a file. The user reviews a diff before it is applied.",
    parameters: {
      path: { type: "string", description: "Path relative to the project root", required: true },
      content: { type: "string", description: "The complete new file contents", required: true }
    }
  },
  {
    name: "edit_file",
    tier: "confirm",
    description: "Replace one exact occurrence of a string in a file. The user reviews a diff before it is applied.",
    parameters: {
      path: { type: "string", description: "Path relative to the project root", required: true },
      old_text: { type: "string", description: "Exact text to replace; must occur exactly once", required: true },
      new_text: { type: "string", description: "Replacement text", required: true }
    }
  },
  {
    name: "create_file",
    tier: "confirm",
    description: "Create a new file that does not yet exist.",
    parameters: {
      path: { type: "string", description: "Path relative to the project root", required: true },
      content: { type: "string", description: "File contents", required: true }
    }
  },
  {
    name: "run_terminal",
    tier: "confirm",
    description: "Run a shell command in the project directory and return its output.",
    parameters: { command: { type: "string", description: "The command line to run", required: true } }
  },
  {
    name: "git_commit",
    tier: "confirm",
    description: "Stage all changes and create a commit.",
    parameters: { message: { type: "string", description: "Commit message", required: true } }
  },
  {
    name: "delete_file",
    tier: "dangerous",
    description: "Delete a file from the project. Always requires explicit confirmation.",
    parameters: { path: { type: "string", description: "Path relative to the project root", required: true } }
  }
];
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
const tierOf = (name) => TOOL_BY_NAME.get(name)?.tier ?? "dangerous";
function toolSchemas() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])
      ),
      required: Object.entries(t.parameters).filter(([, v]) => v.required).map(([k]) => k)
    }
  }));
}
const clip = (s, max) => s.length <= max ? s : `${s.slice(0, max)}
… [truncated ${s.length - max} characters]`;
const str$1 = (v, field) => {
  if (typeof v !== "string") throw new Error(`"${field}" must be a string`);
  return v;
};
async function execute(name, args, ctx) {
  const cwd = ctx.projectPath;
  try {
    switch (name) {
      case "read_file": {
        const { abs, rel } = safePath(ctx, args.path);
        const info = await stat(abs);
        if (!info.isFile()) return { ok: false, output: `${rel} is not a file` };
        return { ok: true, output: clip(await readFile(abs, "utf8"), ctx.maxChars) };
      }
      case "list_directory": {
        const { abs, rel } = safePath(ctx, args.path ?? ".");
        const entries = await readdir(abs, { withFileTypes: true });
        const listed = entries.filter((e) => !isSecretPath(join(rel === "." ? "" : rel, e.name))).slice(0, 400).map((e) => e.isDirectory() ? `${e.name}/` : e.name);
        return { ok: true, output: listed.join("\n") || "(empty)" };
      }
      case "search_code": {
        const hits = await searchCode(cwd, str$1(args.query, "query"));
        if (!hits.length) return { ok: true, output: "No matches." };
        return {
          ok: true,
          output: clip(hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n"), ctx.maxChars)
        };
      }
      case "search_files": {
        const hits = await searchFiles(cwd, str$1(args.query, "query"));
        return { ok: true, output: hits.map((h) => h.path).join("\n") || "No matches." };
      }
      case "find_symbol": {
        const hits = await findSymbol(cwd, str$1(args.name, "name"));
        return {
          ok: true,
          output: hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n") || "No definition found."
        };
      }
      case "git_status": {
        const changes = await status$1(cwd);
        if (!changes.length) return { ok: true, output: "Working tree clean." };
        return {
          ok: true,
          output: changes.map((c) => `${c.staged ? "staged  " : "unstaged"} ${c.status.padEnd(9)} ${c.path}`).join("\n")
        };
      }
      case "git_diff": {
        const file = typeof args.path === "string" && args.path ? safePath(ctx, args.path).rel : void 0;
        return { ok: true, output: clip(await diff(cwd, file, false) || "No changes.", ctx.maxChars) };
      }
      case "git_log": {
        const limit = Number(args.limit) > 0 ? Math.min(Number(args.limit), 100) : 20;
        const log$1 = await log(cwd, limit);
        return {
          ok: true,
          output: log$1.map((c) => `${c.short} ${new Date(c.at).toISOString().slice(0, 10)} ${c.author}: ${c.subject}`).join("\n") || "No commits."
        };
      }
      case "git_branch": {
        const bs = await branches(cwd);
        return { ok: true, output: bs.map((b) => `${b.current ? "*" : " "} ${b.name}`).join("\n") };
      }
      case "write_file": {
        const { abs, rel } = safePath(ctx, args.path);
        const after = str$1(args.content, "content");
        const before = existsSync(abs) ? await readFile(abs, "utf8") : "";
        return { ok: true, output: `Prepared a full rewrite of ${rel}.`, edit: { path: rel, before, after } };
      }
      case "create_file": {
        const { abs, rel } = safePath(ctx, args.path);
        if (existsSync(abs)) return { ok: false, output: `${rel} already exists — use edit_file or write_file.` };
        return {
          ok: true,
          output: `Prepared a new file ${rel}.`,
          edit: { path: rel, before: "", after: str$1(args.content, "content") }
        };
      }
      case "edit_file": {
        const { abs, rel } = safePath(ctx, args.path);
        const before = await readFile(abs, "utf8");
        const oldText = str$1(args.old_text, "old_text");
        const count = before.split(oldText).length - 1;
        if (count === 0) return { ok: false, output: `That exact text does not appear in ${rel}.` };
        if (count > 1) return { ok: false, output: `That text appears ${count} times in ${rel}; make it unique.` };
        const after = before.replace(oldText, str$1(args.new_text, "new_text"));
        return { ok: true, output: `Prepared an edit to ${rel}.`, edit: { path: rel, before, after } };
      }
      case "run_terminal": {
        const command = str$1(args.command, "command");
        const r = await run("/bin/sh", ["-c", command], cwd, 6e4);
        const out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
        return { ok: r.ok, output: clip(out || "(no output)", ctx.maxChars) };
      }
      case "git_commit": {
        const message = str$1(args.message, "message");
        const staged = await run("git", ["add", "-A"], cwd);
        if (!staged.ok) return { ok: false, output: staged.stderr || "git add failed" };
        const r = await commit(cwd, message);
        return { ok: r.ok, output: (r.stdout || r.stderr).trim() };
      }
      case "delete_file": {
        const { abs, rel } = safePath(ctx, args.path);
        await unlink(abs);
        return { ok: true, output: `Deleted ${rel}.` };
      }
      default:
        return { ok: false, output: `Unknown tool "${name}".` };
    }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : "Tool failed" };
  }
}
async function applyEdit(ctx, path, after) {
  const { abs } = safePath(ctx, path);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, after, "utf8");
}
const aiConfigStore = new JsonStore("ai.json", DEFAULT_AI_CONFIG);
const CUSTOM_KEY = "ai.custom.apiKey";
const sessionStore = new JsonStore("ai-sessions.json", { items: [] });
const pendingApprovals = /* @__PURE__ */ new Map();
const running = /* @__PURE__ */ new Map();
const MAX_TOOL_ROUNDS = 8;
function send$1(win, event) {
  if (!win.isDestroyed()) win.webContents.send("ai:stream", event);
}
function listSessions() {
  return sessionStore.read().items;
}
function getSession(id) {
  return sessionStore.read().items.find((s) => s.id === id) ?? null;
}
function saveSession(session2) {
  const { items } = sessionStore.read();
  const i = items.findIndex((s) => s.id === session2.id);
  const next = i === -1 ? [session2, ...items] : items.map((s) => s.id === session2.id ? session2 : s);
  sessionStore.write({ items: next.slice(0, 200) });
}
function createSession(projectId, title = "New session") {
  const s = {
    id: randomUUID(),
    title,
    projectId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  saveSession(s);
  return s;
}
function renameSession(id, title) {
  const items = sessionStore.read().items.map((s) => s.id === id ? { ...s, title: title.slice(0, 120), updatedAt: Date.now() } : s);
  return sessionStore.write({ items }).items;
}
function deleteSession(id) {
  running.get(id)?.abort();
  return sessionStore.write({ items: sessionStore.read().items.filter((s) => s.id !== id) }).items;
}
async function systemPrompt(project, mode) {
  const rules = [
    "You are the Nyxium local coding agent. You run entirely on the user's machine.",
    "Be concise and concrete. Prefer reading the real files over guessing.",
    "Never claim to have changed a file you did not change through a tool."
  ];
  const byMode = {
    ask: "MODE: Ask. Explain and answer only. Do not call tools that modify anything.",
    plan: "MODE: Plan. Investigate with read-only tools and propose a concrete plan. Do not modify files.",
    agent: "MODE: Agent. You may use tools. Modifications are shown to the user for approval before they take effect.",
    trusted: "MODE: Trusted Agent. The user has pre-approved routine changes; destructive operations still require confirmation."
  };
  rules.push(byMode[mode]);
  if (!project) {
    rules.push("No project is open, so file and Git tools are unavailable.");
    return rules.join("\n");
  }
  const [git2, stack] = await Promise.all([gitSummary(project.path), detectStack(project.path)]);
  rules.push(
    "",
    `PROJECT: ${project.name}`,
    `PATH: ${project.path}`,
    `STACK: ${(stack.length ? stack : project.stack).join(", ") || "unknown"}`,
    git2.isRepo ? `GIT: branch ${git2.branch ?? "unknown"}, ${git2.dirty} changed file(s), ahead ${git2.ahead}, behind ${git2.behind}` : "GIT: not a repository",
    "",
    "Retrieve context on demand with search_code, search_files, find_symbol and read_file.",
    "Do not ask to read the whole repository."
  );
  return rules.join("\n");
}
function requestApproval(win, sessionId, call) {
  return new Promise((resolve2) => {
    pendingApprovals.set(call.id, { resolve: resolve2, call, sessionId });
    send$1(win, { sessionId, type: "tool-call", toolCall: { ...call, status: "awaiting-approval" } });
  });
}
function resolveApproval(callId, approved) {
  const entry = pendingApprovals.get(callId);
  if (!entry) return;
  pendingApprovals.delete(callId);
  entry.resolve(approved);
}
function autoApproved(tier, mode) {
  if (tier === "safe") return true;
  if (tier === "dangerous") return false;
  return mode === "trusted";
}
function cancel(sessionId) {
  running.get(sessionId)?.abort();
  running.delete(sessionId);
}
async function sendMessage(win, opts) {
  const cfg = aiConfigStore.read();
  const session2 = getSession(opts.sessionId);
  if (!session2) throw new Error("Unknown AI session");
  if (!cfg.enabled) throw new Error("Local AI is disabled in settings");
  if (!cfg.model) throw new Error("No model selected. Choose one in AI Agent → Models.");
  const limits = applyResourceMode(cfg);
  if (limits.concurrency <= running.size) {
    throw new Error("Another AI request is still running. Low-RAM mode allows one at a time.");
  }
  const provider = PROVIDERS[cfg.provider];
  const isCustom = cfg.provider === "custom";
  const endpoint = isCustom ? cfg.custom.url : cfg.endpoints[cfg.provider];
  if (!endpoint) throw new Error("No endpoint URL is configured for this provider.");
  const headers = isCustom ? customHeaders(cfg.custom, getSecret(CUSTOM_KEY)) : void 0;
  const ctrl = new AbortController();
  running.set(session2.id, ctrl);
  const ctx = opts.project ? { projectPath: opts.project.path, maxChars: cfg.resourceMode === "low-ram" ? 6e3 : 2e4 } : null;
  const userMessage = {
    id: randomUUID(),
    role: "user",
    at: Date.now(),
    content: opts.attachments.length ? `${opts.text}

--- attached files ---
${opts.attachments.map((a) => `### ${a.path}
${a.content}`).join("\n\n")}` : opts.text
  };
  session2.messages.push(userMessage);
  if (session2.title === "New session") session2.title = opts.text.slice(0, 60) || "New session";
  session2.updatedAt = Date.now();
  saveSession(session2);
  send$1(win, { sessionId: session2.id, type: "message", message: userMessage });
  const wire = [
    { role: "system", content: await systemPrompt(opts.project, cfg.mode) },
    ...session2.messages.map((m) => ({ role: m.role, content: m.content }))
  ];
  const allowed = cfg.mode === "ask" ? [] : cfg.mode === "plan" ? toolSchemas().filter((t) => tierOf(t.name) === "safe") : toolSchemas();
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let text = "";
      const calls = [];
      for await (const chunk of provider.chat(endpoint, {
        model: cfg.model,
        messages: wire,
        temperature: cfg.temperature,
        maxTokens: limits.maxTokens,
        contextSize: limits.contextSize,
        tools: allowed.length ? allowed : void 0,
        signal: ctrl.signal,
        headers
      })) {
        if (chunk.text) {
          text += chunk.text;
          send$1(win, { sessionId: session2.id, type: "token", text: chunk.text });
        }
        if (chunk.toolCalls?.length) calls.push(...chunk.toolCalls);
        if (chunk.done) break;
      }
      const assistantMessage = {
        id: randomUUID(),
        role: "assistant",
        content: text,
        at: Date.now(),
        toolCalls: calls.length ? [] : void 0
      };
      if (!calls.length) {
        session2.messages.push(assistantMessage);
        session2.updatedAt = Date.now();
        saveSession(session2);
        send$1(win, { sessionId: session2.id, type: "message", message: assistantMessage });
        send$1(win, { sessionId: session2.id, type: "done" });
        return;
      }
      wire.push({ role: "assistant", content: text });
      for (const c of calls) {
        const call = { id: randomUUID(), name: c.name, args: c.args, status: "pending" };
        const tier = tierOf(c.name);
        if (!TOOLS.some((t) => t.name === c.name)) {
          call.status = "error";
          call.result = `Unknown tool "${c.name}"`;
        } else if (!autoApproved(tier, cfg.mode)) {
          const ok = await requestApproval(win, session2.id, call);
          if (!ok) {
            call.status = "denied";
            call.result = "The user denied this operation.";
          }
        }
        if (call.status === "pending" && !ctx) {
          call.status = "error";
          call.result = "No project is open, so this tool is unavailable. Open a project first.";
        }
        if (call.status === "pending" && ctx) {
          call.status = "running";
          send$1(win, { sessionId: session2.id, type: "tool-call", toolCall: call });
          const outcome = await execute(c.name, c.args, ctx);
          call.status = outcome.ok ? "done" : "error";
          call.result = outcome.edit ? `${outcome.output}
(Shown to the user as a diff; not yet written to disk.)` : outcome.output;
          if (outcome.edit) {
            send$1(win, {
              sessionId: session2.id,
              type: "tool-result",
              toolCall: { ...call, args: { ...call.args, __edit: outcome.edit } }
            });
          }
        }
        assistantMessage.toolCalls = [...assistantMessage.toolCalls ?? [], call];
        send$1(win, { sessionId: session2.id, type: "tool-result", toolCall: call });
        wire.push({ role: "tool", content: `${c.name}: ${call.result ?? ""}` });
      }
      session2.messages.push(assistantMessage);
      session2.updatedAt = Date.now();
      saveSession(session2);
      send$1(win, { sessionId: session2.id, type: "message", message: assistantMessage });
    }
    send$1(win, {
      sessionId: session2.id,
      type: "error",
      error: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer.`
    });
  } catch (e) {
    if (ctrl.signal.aborted) {
      send$1(win, { sessionId: session2.id, type: "done" });
      return;
    }
    send$1(win, {
      sessionId: session2.id,
      type: "error",
      error: e instanceof Error ? e.message : "Local inference failed"
    });
  } finally {
    running.delete(session2.id);
    for (const [id, p] of pendingApprovals) {
      if (p.sessionId === session2.id) {
        p.resolve(false);
        pendingApprovals.delete(id);
      }
    }
  }
}
const GCS_SA_KEY = "cloud.gcs.serviceAccount";
const ORIGIN = process.env.NYX_GCS_ORIGIN ?? "https://storage.googleapis.com";
const API = `${ORIGIN}/storage/v1`;
const UPLOAD = `${ORIGIN}/upload/storage/v1`;
let cached = null;
async function gcloudToken() {
  const r = await run("gcloud", ["auth", "application-default", "print-access-token"], void 0, 1e4);
  const value = r.stdout.trim();
  if (!r.ok || !value) return null;
  return { value, expiresAt: Date.now() + 55 * 6e4 };
}
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function serviceAccountToken(json) {
  let sa;
  try {
    sa = JSON.parse(json);
  } catch {
    return null;
  }
  if (!sa.client_email || !sa.private_key) return null;
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1e3);
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  })));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`
    })
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (!body.access_token) return null;
  return { value: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 3600) - 300) * 1e3 };
}
async function token() {
  if (process.env.NYX_GCS_ORIGIN) return { value: "stub-token", expiresAt: Date.now() + 36e5 };
  if (cached && cached.expiresAt > Date.now()) return cached;
  const sa = getSecret(GCS_SA_KEY);
  cached = (sa ? await serviceAccountToken(sa) : null) ?? await gcloudToken();
  return cached;
}
function forgetToken() {
  cached = null;
}
async function credentialKind() {
  if (process.env.NYX_GCS_ORIGIN) return "gcloud";
  if (getSecret(GCS_SA_KEY)) return "service-account";
  const r = await run("gcloud", ["--version"], void 0, 5e3);
  if (!r.ok) return "none";
  return await gcloudToken() ? "gcloud" : "none";
}
class CloudError extends Error {
  constructor(message, status2) {
    super(message);
    this.status = status2;
  }
  status;
}
async function fail(res) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body.error?.message ?? "";
  } catch {
  }
  const message = res.status === 401 || res.status === 403 ? "Google Cloud rejected the credentials. Re-authenticate, or check the bucket permissions." : res.status === 404 ? "Not found. Check the project and bucket names." : detail || `Google Cloud returned HTTP ${res.status}.`;
  throw new CloudError(message, res.status);
}
async function authed(url, init = {}) {
  const t = await token();
  if (!t) {
    throw new CloudError(
      "Not connected to Google Cloud. Run `gcloud auth application-default login`, or add a service-account key in Settings."
    );
  }
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers ?? {}, authorization: `Bearer ${t.value}` }
  });
  if (!res.ok) await fail(res);
  return res;
}
async function listBuckets(project) {
  const res = await authed(`${API}/b?project=${encodeURIComponent(project)}&maxResults=200`);
  const body = await res.json();
  return (body.items ?? []).map((b) => ({
    name: b.name,
    location: b.location ?? null,
    storageClass: b.storageClass ?? null
  }));
}
async function listObjects(bucket, prefix, pageToken) {
  const params = new URLSearchParams({
    delimiter: "/",
    maxResults: "200",
    ...prefix ? { prefix } : {},
    ...pageToken ? { pageToken } : {}
  });
  const res = await authed(`${API}/b/${encodeURIComponent(bucket)}/o?${params}`);
  const body = await res.json();
  return {
    prefixes: body.prefixes ?? [],
    objects: (body.items ?? []).filter((o) => o.name !== prefix).map((o) => ({
      name: o.name,
      size: Number(o.size ?? 0),
      updated: o.updated ? Date.parse(o.updated) : 0,
      contentType: o.contentType ?? null
    })),
    nextPageToken: body.nextPageToken ?? null
  };
}
async function searchObjects(bucket, prefix, query2, limit = 100) {
  const q = query2.toLowerCase();
  const found = [];
  let pageToken;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      maxResults: "1000",
      ...prefix ? { prefix } : {},
      ...pageToken ? { pageToken } : {}
    });
    const res = await authed(`${API}/b/${encodeURIComponent(bucket)}/o?${params}`);
    const body = await res.json();
    for (const o of body.items ?? []) {
      if (!o.name.toLowerCase().includes(q)) continue;
      found.push({
        name: o.name,
        size: Number(o.size ?? 0),
        updated: o.updated ? Date.parse(o.updated) : 0,
        contentType: o.contentType ?? null
      });
      if (found.length >= limit) return found;
    }
    pageToken = body.nextPageToken;
  } while (pageToken && ++pages < 10);
  return found;
}
async function upload(bucket, objectName, localPath, handle) {
  const total = statSync(localPath).size;
  let sent = 0;
  const source = createReadStream(localPath);
  source.on("data", (chunk) => {
    sent += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    handle.onProgress(sent, total);
  });
  const url = `${UPLOAD}/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const t = await token();
  if (!t) throw new CloudError("Not connected to Google Cloud.");
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${t.value}`, "content-type": "application/octet-stream" },
    body: Readable.toWeb(source),
    duplex: "half",
    signal: handle.signal
  });
  if (!res.ok) await fail(res);
  const body = await res.json();
  return {
    name: body.name,
    size: Number(body.size ?? total),
    updated: body.updated ? Date.parse(body.updated) : Date.now(),
    contentType: body.contentType ?? null
  };
}
async function download(bucket, objectName, localPath, handle) {
  const url = `${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const res = await authed(url, { signal: handle.signal });
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  await mkdir(dirname(localPath), { recursive: true });
  const out = createWriteStream(localPath);
  const counter = new Writable({
    write(chunk, _enc, cb) {
      received += chunk.length;
      handle.onProgress(received, total);
      out.write(chunk, cb);
    },
    final(cb) {
      out.end(cb);
    }
  });
  await pipeline(Readable.fromWeb(res.body), counter);
}
async function remove(bucket, objectName) {
  await authed(
    `${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`,
    { method: "DELETE" }
  );
}
async function move(bucket, from, to) {
  await authed(
    `${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(from)}/copyTo/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(to)}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
  );
  await remove(bucket, from);
}
async function createFolder(bucket, prefix) {
  const name = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const url = `${UPLOAD}/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`;
  await authed(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" });
}
const DEFAULT_EXCLUDES = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  ".venv/",
  "__pycache__/",
  ".cache/",
  ".tmp/",
  "out/",
  ".next/",
  ".turbo/",
  "coverage/"
];
const SECRET_EXCLUDES = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\..*/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)service-account.*\.json$/,
  /(^|\/)id_rsa$/,
  /(^|\/)id_ed25519$/,
  /(^|\/)id_ecdsa$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.pypirc$/,
  /(^|\/)\.aws\//,
  /(^|\/)\.ssh\//
];
const isSecret = (rel) => SECRET_EXCLUDES.some((re) => re.test(rel));
function compile(pattern) {
  let p = pattern.trim();
  if (!p || p.startsWith("#")) return null;
  const negated = p.startsWith("!");
  if (negated) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  const body = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  const prefix = anchored ? "^" : "^(?:.*/)?";
  return { negated, dirOnly, re: new RegExp(`${prefix}${body}(?:/.*)?$`) };
}
function parseIgnore(text) {
  return text.split("\n").map(compile).filter((r) => r !== null);
}
function isExcluded(rel, rules, isDir) {
  let excluded = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir && !r.re.test(rel)) continue;
    if (!r.re.test(rel)) continue;
    excluded = !r.negated;
  }
  return excluded;
}
async function loadIgnore(projectPath) {
  const file = join(projectPath, ".nyxiumignore");
  const text = existsSync(file) ? await readFile(file, "utf8") : DEFAULT_EXCLUDES.join("\n");
  return parseIgnore(text);
}
const MAX_FILES = 5e4;
async function scan(projectPath) {
  const rules = await loadIgnore(projectPath);
  const files = [];
  const excludedSecrets = [];
  let totalBytes = 0;
  let truncated = false;
  const queue = [projectPath];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(projectPath, abs).split(sep).join("/");
      if (e.isDirectory()) {
        if (!isExcluded(rel, rules, true) && !isSecret(`${rel}/`)) queue.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      if (isSecret(rel)) {
        excludedSecrets.push(rel);
        continue;
      }
      if (isExcluded(rel, rules, false)) continue;
      if (files.length >= MAX_FILES) {
        truncated = true;
        break;
      }
      files.push(rel);
      try {
        totalBytes += (await stat(abs)).size;
      } catch {
      }
    }
    if (truncated) break;
  }
  return { files, totalBytes, excludedSecrets, truncated };
}
async function buildArchive(projectPath, projectName, files) {
  if (!files.length) throw new Error("Nothing to back up — every file was excluded.");
  const dir = await mkdtemp(join(tmpdir(), "nyxium-backup-"));
  const listFile = join(dir, "files.txt");
  const { writeFile: writeFile2 } = await import("node:fs/promises");
  await writeFile2(listFile, files.join("\n"), "utf8");
  const hasZstd = (await run("zstd", ["--version"], void 0, 4e3)).ok;
  const ext = hasZstd ? "tar.zst" : "tar.gz";
  const archivePath = join(dir, `${projectName}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.${ext}`);
  const args = [
    "--create",
    hasZstd ? "--zstd" : "--gzip",
    "--file",
    archivePath,
    "--directory",
    projectPath,
    "--files-from",
    listFile
  ];
  const r = await run("tar", args, projectPath, 30 * 6e4);
  if (!r.ok) throw new Error(`Could not create the archive: ${r.stderr.trim().slice(0, 300)}`);
  const bytes = (await stat(archivePath)).size;
  const sha256 = await hashFile(archivePath);
  return { path: archivePath, bytes, sha256, fileCount: files.length };
}
function hashFile(path) {
  return new Promise((resolve2, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (c) => hash.update(c)).on("end", () => resolve2(hash.digest("hex"))).on("error", reject);
  });
}
const cleanupArchive = (archive) => rm(join(archive.path, ".."), { recursive: true, force: true });
async function extractArchive(archivePath, destination) {
  const { mkdir: mkdir2 } = await import("node:fs/promises");
  await mkdir2(destination, { recursive: true });
  const r = await run("tar", ["--extract", "--file", archivePath, "--directory", destination], void 0, 30 * 6e4);
  if (!r.ok) throw new Error(`Could not extract the archive: ${r.stderr.trim().slice(0, 300)}`);
}
const cloudStore = new JsonStore("cloud.json", DEFAULT_CLOUD_CONFIG);
const transfers = /* @__PURE__ */ new Map();
function emit$1(win, progress) {
  if (!win.isDestroyed()) win.webContents.send("cloud:progress", progress);
}
function track(win, kind, label) {
  const id = randomUUID();
  const ctrl = new AbortController();
  const progress = { id, kind, label, sent: 0, total: 0, status: "running" };
  transfers.set(id, { ctrl, progress });
  emit$1(win, progress);
  let lastEmit = 0;
  return {
    id,
    ctrl,
    /** Throttled: a fast local upload would otherwise flood the IPC channel. */
    report(sent, total) {
      progress.sent = sent;
      progress.total = total;
      const now = Date.now();
      if (now - lastEmit > 120) {
        lastEmit = now;
        emit$1(win, { ...progress });
      }
    },
    finish(status2, error) {
      progress.status = status2;
      progress.error = error;
      transfers.delete(id);
      emit$1(win, { ...progress });
    }
  };
}
function cancelTransfer(id) {
  transfers.get(id)?.ctrl.abort();
}
const listTransfers = () => [...transfers.values()].map((t) => t.progress);
async function status() {
  const cfg = cloudStore.read();
  const credential = await credentialKind();
  if (credential === "none") {
    return {
      connected: false,
      credential,
      project: cfg.project,
      bucket: cfg.bucket,
      detail: "No Google Cloud credentials found. Run `gcloud auth application-default login`, or add a service-account key."
    };
  }
  if (!cfg.project) {
    return { connected: false, credential, project: "", bucket: cfg.bucket, detail: "Set a Google Cloud project ID." };
  }
  try {
    await listBuckets(cfg.project);
    return { connected: true, credential, project: cfg.project, bucket: cfg.bucket, detail: null };
  } catch (e) {
    return {
      connected: false,
      credential,
      project: cfg.project,
      bucket: cfg.bucket,
      detail: e instanceof Error ? e.message : "Could not reach Google Cloud Storage."
    };
  }
}
function prefixFor(project) {
  const cfg = cloudStore.read();
  const custom2 = cfg.prefixes[project.id];
  const raw = custom2 || `projects/${project.name}/`;
  return raw.endsWith("/") ? raw : `${raw}/`;
}
async function previewBackup(project) {
  const r = await scan(project.path);
  return {
    fileCount: r.files.length,
    totalBytes: r.totalBytes,
    excludedSecrets: r.excludedSecrets,
    truncated: r.truncated
  };
}
async function backupProject(win, project) {
  const cfg = cloudStore.read();
  if (!cfg.bucket) throw new Error("No bucket is configured for cloud backups.");
  const t = track(win, "backup", `Backing up ${project.name}`);
  let archive = null;
  try {
    const scanned = await scan(project.path);
    if (!scanned.files.length) throw new Error("Every file was excluded — nothing to back up.");
    archive = await buildArchive(project.path, project.name, scanned.files);
    const objectName = `${prefixFor(project)}backups/${basename(archive.path)}`;
    const uploaded = await upload(cfg.bucket, objectName, archive.path, {
      onProgress: t.report,
      signal: t.ctrl.signal
    });
    if (uploaded.size !== archive.bytes) {
      throw new Error(`Upload verification failed: sent ${archive.bytes} bytes, bucket reports ${uploaded.size}.`);
    }
    cloudStore.patch({ lastBackupAt: { ...cfg.lastBackupAt, [project.id]: Date.now() } });
    t.finish("done");
    pushNotification({
      source: "cloud",
      title: "Backup completed",
      body: `${project.name} → gs://${cfg.bucket}/${objectName}` + (scanned.excludedSecrets.length ? ` (${scanned.excludedSecrets.length} credential file(s) excluded)` : "")
    });
    return objectName;
  } catch (e) {
    const message = t.ctrl.signal.aborted ? "Backup cancelled." : e instanceof Error ? e.message : "Backup failed";
    t.finish(t.ctrl.signal.aborted ? "cancelled" : "error", message);
    throw new Error(message);
  } finally {
    if (archive) await cleanupArchive(archive).catch(() => {
    });
  }
}
async function restoreProject(win, objectName, destination) {
  const cfg = cloudStore.read();
  if (!cfg.bucket) throw new Error("No bucket is configured.");
  const t = track(win, "restore", `Restoring ${basename(objectName)}`);
  const { mkdtemp: mkdtemp2, rm: rm2 } = await import("node:fs/promises");
  const { tmpdir: tmpdir2 } = await import("node:os");
  const tmp = await mkdtemp2(join(tmpdir2(), "nyxium-restore-"));
  const local = join(tmp, basename(objectName));
  try {
    await download(cfg.bucket, objectName, local, { onProgress: t.report, signal: t.ctrl.signal });
    await extractArchive(local, destination);
    t.finish("done");
    pushNotification({ source: "cloud", title: "Restore completed", body: `${basename(objectName)} → ${destination}` });
  } catch (e) {
    const message = t.ctrl.signal.aborted ? "Restore cancelled" : e instanceof Error ? e.message : "Restore failed";
    t.finish(t.ctrl.signal.aborted ? "cancelled" : "error", message);
    throw new Error(message);
  } finally {
    await rm2(tmp, { recursive: true, force: true }).catch(() => {
    });
  }
}
async function uploadFile(win, localPath, objectName) {
  const cfg = cloudStore.read();
  if (!cfg.bucket) throw new Error("No bucket is configured.");
  const t = track(win, "upload", basename(localPath));
  try {
    const o = await upload(cfg.bucket, objectName, localPath, {
      onProgress: t.report,
      signal: t.ctrl.signal
    });
    t.finish("done");
    return o;
  } catch (e) {
    const message = t.ctrl.signal.aborted ? "Upload cancelled" : e instanceof Error ? e.message : "Upload failed";
    t.finish(t.ctrl.signal.aborted ? "cancelled" : "error", message);
    throw new Error(message);
  }
}
async function downloadFile(win, objectName, localPath) {
  const cfg = cloudStore.read();
  if (!cfg.bucket) throw new Error("No bucket is configured.");
  const t = track(win, "download", basename(objectName));
  try {
    await download(cfg.bucket, objectName, localPath, { onProgress: t.report, signal: t.ctrl.signal });
    t.finish("done");
  } catch (e) {
    const message = t.ctrl.signal.aborted ? "Download cancelled" : e instanceof Error ? e.message : "Download failed";
    t.finish(t.ctrl.signal.aborted ? "cancelled" : "error", message);
    throw new Error(message);
  }
}
const docker = (args, timeout = 15e3) => run("docker", args, void 0, timeout);
function parseLines(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
    }
  }
  return out;
}
async function available() {
  const version = await docker(["version", "--format", "{{.Server.Version}}"], 6e3);
  if (version.ok && version.stdout.trim()) return { ok: true, detail: null };
  const cli = await docker(["--version"], 4e3);
  if (!cli.ok) return { ok: false, detail: "The docker command was not found on this system." };
  return {
    ok: false,
    detail: "Docker is installed but no daemon is reachable. Start the service, or check your permissions on the socket."
  };
}
async function containers() {
  const r = await docker(["ps", "--all", "--format", "{{json .}}"]);
  if (!r.ok) return [];
  return parseLines(r.stdout).map((c) => ({
    id: c.ID,
    name: c.Names,
    image: c.Image,
    state: c.State,
    status: c.Status,
    ports: c.Ports ? c.Ports.split(", ").filter(Boolean) : []
  }));
}
async function images() {
  const r = await docker(["images", "--format", "{{json .}}"]);
  if (!r.ok) return [];
  return parseLines(r.stdout).map((i) => ({
    id: i.ID,
    repository: i.Repository,
    tag: i.Tag,
    size: i.Size,
    createdAt: i.CreatedAt
  }));
}
async function volumes() {
  const r = await docker(["volume", "ls", "--format", "{{json .}}"]);
  if (!r.ok) return [];
  return parseLines(r.stdout).map((v) => ({ name: v.Name, driver: v.Driver, mountpoint: v.Mountpoint ?? null }));
}
async function networks() {
  const r = await docker(["network", "ls", "--format", "{{json .}}"]);
  if (!r.ok) return [];
  return parseLines(r.stdout).map((n) => ({ id: n.ID, name: n.Name, driver: n.Driver, scope: n.Scope }));
}
async function logs(id, tail = 200) {
  const r = await docker(["logs", "--tail", String(Math.min(tail, 2e3)), id], 2e4);
  return [r.stdout, r.stderr].filter(Boolean).join("\n");
}
const start = (id) => docker(["start", id], 3e4);
const stop = (id) => docker(["stop", id], 4e4);
const restart = (id) => docker(["restart", id], 6e4);
const removeContainer = (id) => docker(["rm", "-f", id], 3e4);
const removeImage = (id) => docker(["rmi", "-f", id], 3e4);
const removeVolume = (name) => docker(["volume", "rm", "-f", name], 2e4);
const shellCommand = (id) => `docker exec -it ${id} sh -lc 'command -v bash >/dev/null && exec bash || exec sh'`;
const connectionStore = new JsonStore("databases.json", { items: [] });
const secretKey = (id) => `db.${id}.password`;
const DESTRUCTIVE = /^\s*(drop|delete|truncate|alter|update|insert|replace|grant|revoke|create|rename|flushall|flushdb)\b/i;
const isDestructive = (sql) => {
  const stripped = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  return DESTRUCTIVE.test(stripped);
};
function saveConnection(input, password) {
  const { items } = connectionStore.read();
  const id = input.id && items.some((c) => c.id === input.id) ? input.id : randomUUID();
  const conn = {
    id,
    name: (input.name ?? "Connection").slice(0, 80),
    driver: input.driver ?? "sqlite",
    host: (input.host ?? "127.0.0.1").slice(0, 200),
    port: Number(input.port) || defaultPort(input.driver ?? "sqlite"),
    database: (input.database ?? "").slice(0, 300),
    user: (input.user ?? "").slice(0, 120),
    hasPassword: false,
    projectId: input.projectId ?? null
  };
  if (password !== null) setSecret(secretKey(id), password || null);
  conn.hasPassword = !!getSecret(secretKey(id));
  const next = items.some((c) => c.id === id) ? items.map((c) => c.id === id ? conn : c) : [...items, conn];
  return connectionStore.write({ items: next }).items;
}
function removeConnection(id) {
  setSecret(secretKey(id), null);
  return connectionStore.write({ items: connectionStore.read().items.filter((c) => c.id !== id) }).items;
}
function defaultPort(driver) {
  return driver === "postgres" ? 5432 : driver === "mysql" ? 3306 : driver === "redis" ? 6379 : 0;
}
const byId = (id) => {
  const c = connectionStore.read().items.find((x) => x.id === id);
  if (!c) throw new Error("Unknown connection");
  return c;
};
async function exec(conn, sql, timeout = 3e4) {
  const password = getSecret(secretKey(conn.id)) ?? "";
  switch (conn.driver) {
    case "sqlite": {
      if (!conn.database) throw new Error("No database file is set for this connection.");
      if (!existsSync(conn.database)) throw new Error(`No such database file: ${conn.database}`);
      const r = await run("sqlite3", ["-header", "-json", conn.database, sql], void 0, timeout);
      if (!r.ok) throw new Error(cleanError(r.stderr, "sqlite3"));
      return fromJsonRows(r.stdout);
    }
    case "postgres": {
      const r = await runWithEnv("psql", [
        "-h",
        conn.host,
        "-p",
        String(conn.port),
        "-U",
        conn.user,
        "-d",
        conn.database,
        "-A",
        "-F",
        "",
        "--pset=footer=off",
        "--no-psqlrc",
        "-c",
        sql
      ], { PGPASSWORD: password }, timeout);
      if (!r.ok) throw new Error(cleanError(r.stderr, "psql"));
      return fromDelimitedWithHeader(r.stdout, "");
    }
    case "mysql": {
      const r = await runWithEnv("mysql", [
        "-h",
        conn.host,
        "-P",
        String(conn.port),
        "-u",
        conn.user,
        ...conn.database ? ["-D", conn.database] : [],
        "--batch",
        "--raw",
        "-e",
        sql
      ], { MYSQL_PWD: password }, timeout);
      if (!r.ok) throw new Error(cleanError(r.stderr, "mysql"));
      return fromTsvWithHeader(r.stdout);
    }
    case "redis": {
      const args = ["-h", conn.host, "-p", String(conn.port), ...password ? ["-a", password, "--no-auth-warning"] : []];
      const r = await run("redis-cli", [...args, ...sql.trim().split(/\s+/)], void 0, timeout);
      if (!r.ok) throw new Error(cleanError(r.stderr, "redis-cli"));
      return {
        columns: ["result"],
        rows: r.stdout.split("\n").filter(Boolean).map((v) => [v]),
        rowCount: r.stdout.split("\n").filter(Boolean).length
      };
    }
  }
}
function runWithEnv(cmd, args, env, timeout) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  return run(cmd, args, void 0, timeout).finally(() => {
    for (const k of Object.keys(env)) {
      if (prev[k] === void 0) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}
function cleanError(stderr, tool) {
  const first = stderr.split("\n").map((l) => l.trim()).find(Boolean);
  if (!first) return `${tool} failed.`;
  if (/command not found|ENOENT/i.test(first)) {
    return `${tool} is not installed. Install the client to use this connection.`;
  }
  return first.slice(0, 400);
}
function fromJsonRows(stdout) {
  const text = stdout.trim();
  if (!text) return { columns: [], rows: [], rowCount: 0 };
  try {
    const parsed = JSON.parse(text);
    const columns = parsed.length ? Object.keys(parsed[0]) : [];
    return {
      columns,
      rows: parsed.map((r) => columns.map((c) => r[c] === null ? null : String(r[c]))),
      rowCount: parsed.length
    };
  } catch {
    return { columns: ["output"], rows: text.split("\n").map((l) => [l]), rowCount: 0 };
  }
}
function fromDelimitedWithHeader(stdout, sep2) {
  const lines2 = stdout.split("\n").filter((l) => l.length);
  if (!lines2.length) return { columns: [], rows: [], rowCount: 0 };
  const [header, ...rest] = lines2;
  return { columns: header.split(sep2), rows: rest.map((l) => l.split(sep2)), rowCount: rest.length };
}
function fromTsvWithHeader(stdout) {
  const lines2 = stdout.split("\n").filter((l) => l.length);
  if (!lines2.length) return { columns: [], rows: [], rowCount: 0 };
  const [header, ...rest] = lines2;
  return {
    columns: header.split("	"),
    rows: rest.map((l) => l.split("	")),
    rowCount: rest.length
  };
}
async function testConnection(id) {
  const conn = byId(id);
  const probe2 = conn.driver === "redis" ? "PING" : conn.driver === "sqlite" ? "SELECT 1" : "SELECT 1";
  try {
    await exec(conn, probe2, 1e4);
    return { ok: true, detail: null };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "Connection failed" };
  }
}
async function tables(id) {
  const conn = byId(id);
  const sql = conn.driver === "sqlite" ? "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name" : conn.driver === "postgres" ? "SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY tablename" : conn.driver === "mysql" ? "SHOW TABLES" : "KEYS *";
  const r = await exec(conn, sql);
  return r.rows.map((row) => ({ name: String(row[0] ?? "") })).filter((t) => t.name);
}
async function schema(id, table) {
  const conn = byId(id);
  const safe = table.replace(/[^\w.$-]/g, "");
  if (!safe) throw new Error("Invalid table name");
  const sql = conn.driver === "sqlite" ? `PRAGMA table_info("${safe}")` : conn.driver === "postgres" ? `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='${safe}' ORDER BY ordinal_position` : conn.driver === "mysql" ? `DESCRIBE \`${safe}\`` : `TYPE ${safe}`;
  return exec(conn, sql);
}
async function browse(id, table, limit = 100) {
  const conn = byId(id);
  const safe = table.replace(/[^\w.$-]/g, "");
  if (!safe) throw new Error("Invalid table name");
  const n = Math.min(Math.max(1, limit), 1e3);
  const sql = conn.driver === "redis" ? `GET ${safe}` : conn.driver === "mysql" ? `SELECT * FROM \`${safe}\` LIMIT ${n}` : `SELECT * FROM "${safe}" LIMIT ${n}`;
  return exec(conn, sql);
}
async function query(id, sql) {
  return exec(byId(id), sql.slice(0, 1e5));
}
const requestStore = new JsonStore("api-requests.json", { items: [] });
const historyStore = new JsonStore("api-history.json", { items: [] });
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MAX_BODY = 2e6;
async function send(opts) {
  const method = String(opts.method).toUpperCase();
  if (!METHODS.includes(method)) throw new Error(`Unsupported method: ${opts.method}`);
  let url;
  try {
    url = new URL(opts.url);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https requests are supported.");
  }
  for (const p of opts.params) {
    if (p.key.trim()) url.searchParams.set(p.key.trim(), p.value);
  }
  const headers = new Headers();
  for (const h of opts.headers) {
    if (!h.key.trim()) continue;
    try {
      headers.set(h.key.trim(), h.value);
    } catch {
    }
  }
  const hasBody = method !== "GET" && opts.body.trim().length > 0;
  if (hasBody && !headers.has("content-type")) {
    const t = opts.body.trim();
    headers.set("content-type", t.startsWith("{") || t.startsWith("[") ? "application/json" : "text/plain");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs ?? 3e4, 12e4));
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? opts.body : void 0,
      signal: ctrl.signal,
      redirect: "follow"
    });
    const raw = await res.arrayBuffer();
    const size = raw.byteLength;
    const text = size > MAX_BODY ? `${new TextDecoder().decode(raw.slice(0, MAX_BODY))}

… [response truncated at ${MAX_BODY} bytes of ${size}]` : new TextDecoder().decode(raw);
    const response = {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: pretty(text, res.headers.get("content-type")),
      durationMs: Date.now() - started,
      size
    };
    record({ method, url: url.toString(), status: res.status, durationMs: response.durationMs });
    return response;
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error("The request timed out.");
    const message = e instanceof Error ? e.message : "Request failed";
    throw new Error(/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(message) ? `Could not reach ${url.host}. Check the address, and whether the server is running.` : message);
  } finally {
    clearTimeout(timer);
  }
}
function pretty(text, contentType) {
  if (!contentType?.includes("json")) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
function record(entry) {
  const { items } = historyStore.read();
  historyStore.write({
    items: [{ ...entry, id: randomUUID(), at: Date.now() }, ...items].slice(0, 200)
  });
}
function saveRequest(input) {
  const { items } = requestStore.read();
  const id = input.id && items.some((r) => r.id === input.id) ? input.id : randomUUID();
  const entry = {
    id,
    name: (input.name ?? "Untitled request").slice(0, 120),
    method: METHODS.includes(input.method) ? input.method : "GET",
    url: (input.url ?? "").slice(0, 2e3),
    headers: (input.headers ?? []).slice(0, 50),
    params: (input.params ?? []).slice(0, 50),
    body: (input.body ?? "").slice(0, 2e5),
    projectId: input.projectId ?? null,
    savedAt: Date.now()
  };
  const next = items.some((r) => r.id === id) ? items.map((r) => r.id === id ? entry : r) : [entry, ...items];
  return requestStore.write({ items: next.slice(0, 200) }).items;
}
const removeRequest = (id) => requestStore.write({ items: requestStore.read().items.filter((r) => r.id !== id) }).items;
const clearHistory = () => historyStore.write({ items: [] }).items;
const views = /* @__PURE__ */ new Map();
const partitionFor = (serviceId) => `persist:service-${serviceId}`;
function emit(win, serviceId, payload) {
  if (!win.isDestroyed()) win.webContents.send("webview:state", { serviceId, ...payload });
}
const AUTH_URL = /(^|[.\/])(accounts|auth|login|signin|sso|oauth|idp|okta)[.\/]|\/(oauth2?|openid|saml2?|sso|signin|login|authorize|authenticate)(\/|\?|$)/i;
function popupDecision(url, disposition) {
  const scripted = disposition === "new-window";
  if (!url || url === "about:blank") return scripted ? "popup" : "deny";
  let u;
  try {
    u = new URL(url);
  } catch {
    return "deny";
  }
  if (!["http:", "https:"].includes(u.protocol)) return "deny";
  if (scripted || AUTH_URL.test(u.host + u.pathname)) return "popup";
  return "external";
}
function popupOptions(serviceId, features, parent) {
  const asked = new URLSearchParams((features || "").replace(/,/g, "&"));
  const dim = (key, fallback) => {
    const n = Number(asked.get(key));
    return Number.isFinite(n) && n >= 320 ? Math.min(Math.floor(n), 1600) : fallback;
  };
  return {
    parent,
    width: dim("width", 520),
    height: dim("height", 700),
    autoHideMenuBar: true,
    backgroundColor: "#0d0f14",
    webPreferences: {
      partition: partitionFor(serviceId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}
function wirePopup(child, serviceId) {
  const cwc = child.webContents;
  cwc.setWindowOpenHandler(({ url: target, disposition, features }) => {
    const action = popupDecision(target, disposition);
    if (action === "popup") {
      return { action: "allow", overrideBrowserWindowOptions: popupOptions(serviceId, features, child) };
    }
    if (action === "external") void shell.openExternal(target);
    return { action: "deny" };
  });
  cwc.on("did-create-window", (grandchild) => wirePopup(grandchild, serviceId));
}
function createView(win, serviceId, url, bounds) {
  const existing = views.get(serviceId);
  if (existing) {
    show(serviceId, bounds);
    return { serviceId };
  }
  const ses = session.fromPartition(partitionFor(serviceId));
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(serviceId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // No preload: the service has no path to Nyxium's bridge.
      webSecurity: true,
      spellcheck: false
    }
  });
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: target, disposition, features }) => {
    const action = popupDecision(target, disposition);
    if (action === "popup") {
      return { action: "allow", overrideBrowserWindowOptions: popupOptions(serviceId, features, win) };
    }
    if (action === "external") void shell.openExternal(target);
    return { action: "deny" };
  });
  wc.on("did-create-window", (child) => wirePopup(child, serviceId));
  const report = () => emit(win, serviceId, {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading()
  });
  wc.on("did-start-loading", report);
  wc.on("did-stop-loading", report);
  wc.on("did-navigate", report);
  wc.on("did-navigate-in-page", report);
  wc.on("page-title-updated", report);
  wc.on("did-fail-load", (_e, code, description, failedUrl) => {
    if (code === -3) return;
    emit(win, serviceId, { error: `${description} (${failedUrl})`, loading: false });
  });
  win.contentView.addChildView(view);
  view.setBounds(bounds);
  void wc.loadURL(url);
  views.set(serviceId, { view, serviceId, windowId: win.id, visible: true });
  return { serviceId };
}
function setBounds(serviceId, bounds) {
  views.get(serviceId)?.view.setBounds(bounds);
}
function hide(serviceId) {
  const entry = views.get(serviceId);
  if (!entry || !entry.visible) return;
  entry.visible = false;
  entry.view.setVisible(false);
}
function show(serviceId, bounds) {
  const entry = views.get(serviceId);
  if (!entry) return;
  entry.visible = true;
  entry.view.setVisible(true);
  entry.view.setBounds(bounds);
}
function showOnly(serviceId, bounds) {
  for (const [id] of views) {
    if (id === serviceId) continue;
    hide(id);
  }
  if (serviceId && bounds) show(serviceId, bounds);
}
function destroy(serviceId) {
  const entry = views.get(serviceId);
  if (!entry) return;
  const win = BrowserWindow.fromId(entry.windowId);
  if (win && !win.isDestroyed()) win.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
  views.delete(serviceId);
}
function destroyForWindow(windowId) {
  for (const [id, v] of views) if (v.windowId === windowId) destroy(id);
}
const wcOf = (serviceId) => views.get(serviceId)?.view.webContents ?? null;
function goBack(serviceId) {
  const wc = wcOf(serviceId);
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
}
function goForward(serviceId) {
  const wc = wcOf(serviceId);
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
}
const reload = (serviceId) => wcOf(serviceId)?.reload();
async function clearSession(serviceId) {
  destroy(serviceId);
  await session.fromPartition(partitionFor(serviceId)).clearStorageData();
}
async function probeView(serviceId, expression) {
  const wc = wcOf(serviceId);
  if (!wc) return "no such view";
  try {
    return String(await wc.executeJavaScript(expression));
  } catch (e) {
    return `probe failed: ${e instanceof Error ? e.message : e}`;
  }
}
const configStore = new JsonStore("config.json", DEFAULT_CONFIG);
const str = (v) => {
  if (typeof v !== "string" || !v.length) throw new Error("Invalid string argument");
  return v;
};
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
const projectById = (id) => {
  const p = projectStore.read().items.find((x) => x.id === str(id));
  if (!p) throw new Error("Unknown project");
  return p;
};
let stopWatching = null;
async function currentPalette() {
  const cfg = configStore.read();
  if (!cfg.palette.enabled) {
    return { provider: "manual", source: "disabled", mode: "dark", colors: FALLBACK };
  }
  return load(cfg.palette.source, cfg.palette.customPaths, cfg.palette.manual);
}
function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}
function startPaletteWatcher() {
  stopWatching?.();
  const cfg = configStore.read();
  stopWatching = watchPalettes(cfg.palette.customPaths, async () => {
    broadcast("palette:changed", await currentPalette());
  });
}
function registerIpc() {
  ipcMain.handle("config:get", () => configStore.read());
  ipcMain.handle("config:patch", async (_e, patch) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid config patch");
    const next = configStore.patch(patch);
    if (patch.palette) {
      startPaletteWatcher();
      broadcast("palette:changed", await currentPalette());
    }
    return next;
  });
  ipcMain.handle("palette:current", () => currentPalette());
  ipcMain.handle("palette:detect", () => detect(configStore.read().palette.customPaths));
  ipcMain.handle("palette:reload", async () => {
    const p = await currentPalette();
    broadcast("palette:changed", p);
    return p;
  });
  ipcMain.handle("workspaces:list", () => workspaceStore.read().items);
  ipcMain.handle("workspaces:create", (_e, name) => {
    const items = [...workspaceStore.read().items, { id: randomUUID(), name: str(name).slice(0, 60) }];
    return workspaceStore.write({ items }).items;
  });
  ipcMain.handle("projects:list", () => projectStore.read().items);
  ipcMain.handle("projects:import", async () => importProject(configStore.read().activeWorkspaceId));
  ipcMain.handle("projects:remove", (_e, id) => {
    const items = projectStore.read().items.filter((p) => p.id !== str(id));
    return projectStore.write({ items }).items;
  });
  ipcMain.handle("projects:touch", async (_e, id) => {
    const target = projectById(id);
    const items = projectStore.read().items.map((p) => p.id === target.id ? { ...p, lastOpenedAt: Date.now(), stack: p.stack } : p);
    return projectStore.write({ items }).items;
  });
  ipcMain.handle("projects:setNotes", (_e, id, notes) => {
    const target = projectById(id);
    if (typeof notes !== "string") throw new Error("Invalid notes");
    const items = projectStore.read().items.map((p) => p.id === target.id ? { ...p, notes: notes.slice(0, 2e5) } : p);
    return projectStore.write({ items }).items;
  });
  ipcMain.handle("projects:git", (_e, id) => gitSummary(projectById(id).path));
  ipcMain.handle("projects:env", (_e, id) => detectEnvironment(projectById(id).path));
  ipcMain.handle("projects:reveal", async (_e, id) => {
    await reveal(projectById(id).path);
  });
  ipcMain.handle("projects:rescan", async (_e, id) => {
    const target = projectById(id);
    const stack = await detectStack(target.path);
    const items = projectStore.read().items.map((p) => p.id === target.id ? { ...p, stack } : p);
    return projectStore.write({ items }).items;
  });
  ipcMain.handle("services:list", () => serviceStore.read().items);
  ipcMain.handle("services:add", (_e, input) => {
    const s = input;
    const url = new URL(str(s?.url));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) services are allowed");
    const entry = {
      id: randomUUID(),
      name: str(s?.name).slice(0, 80),
      url: url.toString(),
      icon: typeof s?.icon === "string" ? s.icon : null,
      projectId: typeof s?.projectId === "string" ? s.projectId : null,
      workspaceId: typeof s?.workspaceId === "string" ? s.workspaceId : null,
      pinned: !!s?.pinned,
      builtin: false
    };
    return serviceStore.write({ items: [...serviceStore.read().items, entry] }).items;
  });
  ipcMain.handle("services:remove", (_e, id) => {
    const items = serviceStore.read().items.filter((s) => s.id !== str(id));
    return serviceStore.write({ items }).items;
  });
  ipcMain.handle("services:openExternal", async (_e, url) => {
    const u = new URL(str(url));
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("Refusing to open non-web URL");
    await shell.openExternal(u.toString());
  });
  ipcMain.handle("notifications:list", () => notificationStore.read().items);
  ipcMain.handle("notifications:markAllRead", () => {
    const items = notificationStore.read().items.map((n) => ({ ...n, read: true }));
    return notificationStore.write({ items }).items;
  });
  ipcMain.handle("notifications:clear", () => notificationStore.write({ items: [] }).items);
  ipcMain.handle("terminal:shells", () => detectShells());
  ipcMain.handle("terminal:create", (e, opts) => {
    const win2 = BrowserWindow.fromWebContents(e.sender);
    if (!win2) throw new Error("No window for this request");
    const o = opts ?? {};
    return createSession$1(win2, {
      shell: typeof o.shell === "string" ? o.shell : void 0,
      cwd: typeof o.cwd === "string" ? o.cwd : void 0,
      cols: num(o.cols, 80),
      rows: num(o.rows, 24)
    });
  });
  ipcMain.on("terminal:write", (_e, id, data) => {
    if (typeof data === "string") write$1(str(id), data);
  });
  ipcMain.on("terminal:resize", (_e, id, cols, rows) => {
    resize(str(id), num(cols, 80), num(rows, 24));
  });
  ipcMain.on("terminal:kill", (_e, id) => kill(str(id)));
  const repo = (id) => projectById(id).path;
  const paths = (v) => {
    if (!Array.isArray(v) || !v.length) throw new Error("No paths given");
    return v.map(str).slice(0, 500);
  };
  ipcMain.handle("git:status", (_e, id) => status$1(repo(id)));
  ipcMain.handle("git:diff", (_e, id, file, staged) => diff(repo(id), typeof file === "string" ? file : void 0, !!staged));
  ipcMain.handle("git:log", (_e, id, limit) => log(repo(id), num(limit, 50)));
  ipcMain.handle("git:branches", (_e, id) => branches(repo(id)));
  ipcMain.handle("git:stashes", (_e, id) => stashes(repo(id)));
  ipcMain.handle("git:stage", (_e, id, p) => stage(repo(id), paths(p)));
  ipcMain.handle("git:unstage", (_e, id, p) => unstage(repo(id), paths(p)));
  ipcMain.handle("git:discard", (_e, id, p) => discard(repo(id), paths(p)));
  ipcMain.handle("git:commit", (_e, id, message) => commit(repo(id), str(message).slice(0, 5e3)));
  ipcMain.handle("git:pull", (_e, id) => pull(repo(id)));
  ipcMain.handle("git:push", (_e, id) => push(repo(id)));
  ipcMain.handle("git:fetch", (_e, id) => fetch$1(repo(id)));
  ipcMain.handle("git:checkout", (_e, id, name) => checkout(repo(id), str(name)));
  ipcMain.handle("git:createBranch", (_e, id, name) => createBranch(repo(id), str(name)));
  ipcMain.handle("git:merge", (_e, id, name) => merge(repo(id), str(name)));
  ipcMain.handle("git:stashPush", (_e, id, message) => stashPush(repo(id), typeof message === "string" && message ? message : void 0));
  ipcMain.handle("git:stashPop", (_e, id, ref) => stashPop(repo(id), str(ref)));
  ipcMain.handle("git:stashDrop", (_e, id, ref) => stashDrop(repo(id), str(ref)));
  ipcMain.handle("snippets:list", () => snippetStore.read().items);
  ipcMain.handle("snippets:save", (_e, id, draft) => {
    if (!draft || typeof draft !== "object") throw new Error("Invalid snippet");
    return upsert(id === null ? null : str(id), draft);
  });
  ipcMain.handle("snippets:remove", (_e, id) => remove$1(str(id)));
  ipcMain.handle("snippets:copy", (_e, code) => {
    clipboard.writeText(String(code ?? "").slice(0, 5e5));
  });
  ipcMain.handle("search:files", (_e, id, q) => searchFiles(repo(id), String(q ?? "")));
  ipcMain.handle("search:code", (_e, id, q) => searchCode(repo(id), String(q ?? "")));
  ipcMain.handle("search:symbol", (_e, id, n) => findSymbol(repo(id), str(n)));
  const optionalProject = (id) => typeof id === "string" && id ? projectById(id) : null;
  ipcMain.handle("ai:config", () => aiConfigStore.read());
  ipcMain.handle("ai:patchConfig", (_e, patch) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid AI config patch");
    const p = patch;
    if (p.endpoints) {
      for (const [id, url] of Object.entries(p.endpoints)) {
        if (id === "custom" && !url) continue;
        const u = new URL(str(url));
        if (!["http:", "https:"].includes(u.protocol)) throw new Error("Endpoint must be an http(s) URL");
      }
    }
    if (p.custom) {
      const c = p.custom;
      if (c.url) {
        const u = new URL(str(c.url));
        if (!["http:", "https:"].includes(u.protocol)) throw new Error("The custom endpoint must be an http(s) URL");
      }
      p.custom = {
        ...c,
        label: String(c.label ?? "").slice(0, 80),
        models: (c.models ?? []).slice(0, 50).map((m) => String(m).slice(0, 120)).filter(Boolean),
        authHeader: String(c.authHeader || "Authorization").slice(0, 80),
        authScheme: String(c.authScheme ?? "").slice(0, 40),
        headers: Object.fromEntries(
          Object.entries(c.headers ?? {}).slice(0, 20).map(([k, v]) => [String(k).slice(0, 80), String(v).slice(0, 400)])
        ),
        hasKey: hasSecret(CUSTOM_KEY)
      };
    }
    return aiConfigStore.patch(p);
  });
  ipcMain.handle("ai:detect", () => detectAll(aiConfigStore.read(), getSecret(CUSTOM_KEY)));
  ipcMain.handle("ai:models", () => {
    const cfg = aiConfigStore.read();
    if (cfg.provider === "custom") {
      return PROVIDERS.custom.listModels(
        cfg.custom.url,
        customHeaders(cfg.custom, getSecret(CUSTOM_KEY)),
        cfg.custom.models
      );
    }
    return PROVIDERS[cfg.provider].listModels(cfg.endpoints[cfg.provider]);
  });
  ipcMain.handle("ai:setCustomKey", (_e, key) => {
    const value = typeof key === "string" && key.trim() ? key.trim() : null;
    setSecret(CUSTOM_KEY, value);
    const cfg = aiConfigStore.read();
    return aiConfigStore.patch({ custom: { ...cfg.custom, hasKey: hasSecret(CUSTOM_KEY) } });
  });
  ipcMain.handle("ai:secretsEncrypted", () => encryptionAvailable());
  ipcMain.handle("ai:pull", async (e, model) => {
    const cfg = aiConfigStore.read();
    const provider = PROVIDERS[cfg.provider];
    if (!provider.pull) throw new Error(`${provider.label} does not support pulling models`);
    const name = str(model);
    await provider.pull(cfg.endpoints[cfg.provider], name, (pct, status2) => {
      e.sender.send("ai:pullProgress", { model: name, pct, status: status2 });
    });
  });
  ipcMain.handle("ai:removeModel", (_e, model) => {
    const cfg = aiConfigStore.read();
    const provider = PROVIDERS[cfg.provider];
    if (!provider.remove) throw new Error(`${provider.label} does not support deleting models`);
    return provider.remove(cfg.endpoints[cfg.provider], str(model));
  });
  ipcMain.handle("ai:sessions", () => listSessions());
  ipcMain.handle("ai:createSession", (_e, projectId) => createSession(optionalProject(projectId)?.id ?? null));
  ipcMain.handle("ai:renameSession", (_e, id, title) => renameSession(str(id), str(title)));
  ipcMain.handle("ai:deleteSession", (_e, id) => deleteSession(str(id)));
  ipcMain.handle("ai:send", async (e, raw) => {
    const win2 = BrowserWindow.fromWebContents(e.sender);
    if (!win2) throw new Error("No window for this request");
    const o = raw ?? {};
    const project = optionalProject(o.projectId);
    const attachments = [];
    if (Array.isArray(o.attachments) && project) {
      const { readFile: readFile2 } = await import("node:fs/promises");
      for (const rel of o.attachments.slice(0, 20)) {
        const { abs, rel: safe } = safePath({ projectPath: project.path }, rel);
        attachments.push({ path: safe, content: (await readFile2(abs, "utf8")).slice(0, 6e4) });
      }
    }
    await sendMessage(win2, {
      sessionId: str(o.sessionId),
      text: String(o.text ?? "").slice(0, 1e5),
      project,
      attachments
    });
  });
  ipcMain.on("ai:cancel", (_e, id) => cancel(str(id)));
  ipcMain.on("ai:approve", (_e, callId, approved) => resolveApproval(str(callId), approved === true));
  ipcMain.handle("ai:applyEdit", async (_e, projectId, path, content) => {
    const project = optionalProject(projectId);
    if (!project) throw new Error("A project is required to write files");
    await applyEdit({ projectPath: project.path }, str(path), String(content ?? ""));
  });
  const objectName = (v) => {
    const n = str(v);
    if (n.startsWith("/") || n.includes("..")) throw new Error("Invalid object name");
    return n.slice(0, 1024);
  };
  const prefixArg = (v) => {
    if (v === void 0 || v === null || v === "") return "";
    const p = String(v);
    if (p.startsWith("/") || p.includes("..")) throw new Error("Invalid prefix");
    return p.slice(0, 1024);
  };
  const bucket = () => {
    const b = cloudStore.read().bucket;
    if (!b) throw new Error("No bucket is configured. Choose one in Cloud Storage.");
    return b;
  };
  const win = (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) throw new Error("No window for this request");
    return w;
  };
  ipcMain.handle("cloud:config", () => cloudStore.read());
  ipcMain.handle("cloud:patchConfig", (_e, patch) => {
    if (!patch || typeof patch !== "object") throw new Error("Invalid cloud config patch");
    const p = patch;
    return cloudStore.patch({
      ...p,
      ...p.project !== void 0 ? { project: String(p.project).slice(0, 120) } : {},
      ...p.bucket !== void 0 ? { bucket: String(p.bucket).slice(0, 240) } : {}
    });
  });
  ipcMain.handle("cloud:status", () => status());
  ipcMain.handle("cloud:setServiceAccount", async (_e, json) => {
    const value = typeof json === "string" && json.trim() ? json.trim() : null;
    if (value) {
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error("That is not valid JSON.");
      }
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error("That JSON does not look like a service-account key (no client_email / private_key).");
      }
    }
    setSecret(GCS_SA_KEY, value);
    forgetToken();
    return status();
  });
  ipcMain.handle("cloud:buckets", () => listBuckets(cloudStore.read().project));
  ipcMain.handle("cloud:list", (_e, prefix, pageToken) => listObjects(bucket(), prefixArg(prefix), typeof pageToken === "string" ? pageToken : void 0));
  ipcMain.handle("cloud:search", (_e, prefix, query2) => searchObjects(bucket(), prefixArg(prefix), String(query2 ?? "").slice(0, 200)));
  ipcMain.handle("cloud:createFolder", (_e, prefix) => createFolder(bucket(), objectName(prefix)));
  ipcMain.handle("cloud:remove", (_e, name) => remove(bucket(), objectName(name)));
  ipcMain.handle("cloud:move", (_e, from, to) => move(bucket(), objectName(from), objectName(to)));
  ipcMain.handle("cloud:upload", (e, localPath, name) => uploadFile(win(e), str(localPath), objectName(name)));
  ipcMain.handle("cloud:uploadDialog", async (e, prefix) => {
    const w = win(e);
    const r = await dialog.showOpenDialog(w, {
      title: "Upload to Google Cloud Storage",
      properties: ["openFile", "multiSelections"]
    });
    if (r.canceled) return [];
    const p = prefixArg(prefix);
    const out = [];
    for (const file of r.filePaths.slice(0, 50)) {
      out.push(await uploadFile(w, file, `${p}${basename(file)}`));
    }
    return out;
  });
  ipcMain.handle("cloud:download", async (e, name) => {
    const w = win(e);
    const object = objectName(name);
    const r = await dialog.showSaveDialog(w, {
      title: "Download from Google Cloud Storage",
      defaultPath: basename(object)
    });
    if (r.canceled || !r.filePath) return null;
    await downloadFile(w, object, r.filePath);
    return r.filePath;
  });
  ipcMain.handle("cloud:previewBackup", (_e, id) => previewBackup(projectById(id)));
  ipcMain.handle("cloud:backup", (e, id) => backupProject(win(e), projectById(id)));
  ipcMain.handle("cloud:restore", async (e, name) => {
    const w = win(e);
    const object = objectName(name);
    const r = await dialog.showOpenDialog(w, {
      title: "Restore into which directory?",
      properties: ["openDirectory", "createDirectory"]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    await restoreProject(w, object, r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle("cloud:transfers", () => listTransfers());
  ipcMain.on("cloud:cancel", (_e, id) => cancelTransfer(str(id)));
  ipcMain.handle("docker:available", () => available());
  ipcMain.handle("docker:containers", () => containers());
  ipcMain.handle("docker:images", () => images());
  ipcMain.handle("docker:volumes", () => volumes());
  ipcMain.handle("docker:networks", () => networks());
  ipcMain.handle("docker:logs", (_e, id, tail) => logs(str(id), num(tail, 200)));
  ipcMain.handle("docker:start", (_e, id) => start(str(id)));
  ipcMain.handle("docker:stop", (_e, id) => stop(str(id)));
  ipcMain.handle("docker:restart", (_e, id) => restart(str(id)));
  ipcMain.handle("docker:removeContainer", (_e, id) => removeContainer(str(id)));
  ipcMain.handle("docker:removeImage", (_e, id) => removeImage(str(id)));
  ipcMain.handle("docker:removeVolume", (_e, n) => removeVolume(str(n)));
  ipcMain.handle("docker:shellCommand", (_e, id) => shellCommand(str(id)));
  ipcMain.handle("db:list", () => connectionStore.read().items);
  ipcMain.handle("db:save", (_e, conn, password) => {
    if (!conn || typeof conn !== "object") throw new Error("Invalid connection");
    const pw = password === null || password === void 0 ? null : String(password);
    return saveConnection(conn, pw);
  });
  ipcMain.handle("db:remove", (_e, id) => removeConnection(str(id)));
  ipcMain.handle("db:test", (_e, id) => testConnection(str(id)));
  ipcMain.handle("db:tables", (_e, id) => tables(str(id)));
  ipcMain.handle("db:schema", (_e, id, t) => schema(str(id), str(t)));
  ipcMain.handle("db:browse", (_e, id, t, limit) => browse(str(id), str(t), num(limit, 100)));
  ipcMain.handle("db:query", (_e, id, sql) => query(str(id), str(sql)));
  ipcMain.handle("db:isDestructive", (_e, sql) => isDestructive(String(sql ?? "")));
  ipcMain.handle("api:send", (_e, opts) => {
    if (!opts || typeof opts !== "object") throw new Error("Invalid request");
    const o = opts;
    const pairs = (v) => Array.isArray(v) ? v.slice(0, 50).map((x) => ({ key: String(x.key ?? ""), value: String(x.value ?? "") })) : [];
    return send({
      method: String(o.method ?? "GET"),
      url: str(o.url),
      headers: pairs(o.headers),
      params: pairs(o.params),
      body: String(o.body ?? "")
    });
  });
  ipcMain.handle("api:saved", () => requestStore.read().items);
  ipcMain.handle("api:save", (_e, req) => {
    if (!req || typeof req !== "object") throw new Error("Invalid request");
    return saveRequest(req);
  });
  ipcMain.handle("api:remove", (_e, id) => removeRequest(str(id)));
  ipcMain.handle("api:history", () => historyStore.read().items);
  ipcMain.handle("api:clearHistory", () => clearHistory());
  const boundsArg = (v) => {
    const b = v ?? {};
    const n = (x) => Math.max(0, Math.round(Number(x) || 0));
    return { x: n(b.x), y: n(b.y), width: Math.max(1, n(b.width)), height: Math.max(1, n(b.height)) };
  };
  const serviceUrl = (id) => {
    const s = serviceStore.read().items.find((x) => x.id === id);
    if (!s) throw new Error("Unknown service");
    const u = new URL(s.url);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) services can be embedded");
    return u.toString();
  };
  ipcMain.handle("webview:open", (e, id, _url, bounds) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) throw new Error("No window for this request");
    const serviceId = str(id);
    createView(w, serviceId, serviceUrl(serviceId), boundsArg(bounds));
  });
  ipcMain.on("webview:setBounds", (_e, id, bounds) => setBounds(str(id), boundsArg(bounds)));
  ipcMain.on("webview:showOnly", (_e, id, bounds) => showOnly(typeof id === "string" && id ? id : null, bounds ? boundsArg(bounds) : void 0));
  ipcMain.on("webview:close", (_e, id) => destroy(str(id)));
  ipcMain.on("webview:back", (_e, id) => goBack(str(id)));
  ipcMain.on("webview:forward", (_e, id) => goForward(str(id)));
  ipcMain.on("webview:reload", (_e, id) => reload(str(id)));
  ipcMain.handle("webview:clearSession", (_e, id) => clearSession(str(id)));
  ipcMain.on("window:minimize", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on("window:toggleMaximize", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.on("window:close", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
}
const isDev = !app.isPackaged;
function brandIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" rx="112" fill="#0d0f14"/>
    <path d="M256 96 416 256 256 416 96 256Z" fill="none" stroke="#7aa2f7" stroke-width="34"/>
    <path d="M256 186 326 256 256 326 186 256Z" fill="#7aa2f7"/>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}
function createWindow() {
  const size = process.env.NYX_WINDOW_SIZE?.split("x").map(Number);
  const win = new BrowserWindow({
    width: size?.[0] || 1440,
    height: size?.[1] || 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: "#0d0f14",
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    icon: brandIcon(),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    killForWindow(win.id);
    destroyForWindow(win.id);
  });
  if (process.env.NYX_SMOKE) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        if (process.env.NYX_DRIVE) {
          try {
            console.log("[nyx-drive]", await win.webContents.executeJavaScript(process.env.NYX_DRIVE));
          } catch (e) {
            console.log("[nyx-drive] failed:", e instanceof Error ? e.message : e);
          }
          await new Promise((r) => setTimeout(r, Number(process.env.NYX_DRIVE_WAIT ?? 2e3)));
        }
        if (process.env.NYX_PROBE_WEBVIEW) {
          console.log("[nyx-probe]", await probeView(process.env.NYX_PROBE_SERVICE ?? "", process.env.NYX_PROBE_WEBVIEW));
        }
        await win.webContents.executeJavaScript(`new Promise(r => {
          const done = () => r(0)
          setTimeout(done, 800)
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 100)))
        })`);
        const img = await win.webContents.capturePage();
        writeFileSync(process.env.NYX_SMOKE, img.toPNG());
        app.exit(0);
      }, Number(process.env.NYX_SMOKE_DELAY ?? 2500));
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const hash = process.env.NYX_VIEW ? { hash: process.env.NYX_VIEW } : void 0;
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash.hash}` : ""));
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), hash);
  }
  return win;
}
app.whenReady().then(() => {
  app.setName("Nyxium");
  registerIpc();
  startPaletteWatcher();
  createWindow();
  const p = configStore.read().palette;
  pushNotification({
    source: "system",
    title: "Nyxium ready",
    body: p.enabled ? `Dynamic colors: ${p.source}` : "Dynamic colors disabled"
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
