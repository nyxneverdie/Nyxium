<div align="center">

<img src="resources/logo.svg" alt="Nyxium" width="440" />

<br/>

**A local-first developer workspace.** Projects, terminals, git, databases, Docker, HTTP, snippets and a local AI agent — one Electron window, no account, no telemetry, no hosted inference.

<br/>

![Electron](https://img.shields.io/badge/Electron-38-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white)
![Local AI](https://img.shields.io/badge/AI-100%25%20local-a78bfa)
![Version](https://img.shields.io/badge/version-0.1.0-6366f1)

[Quick start](#-quick-start) · [Features](#-features) · [Build](#-build) · [Shortcuts](#-keyboard-shortcuts) · [Architecture](#-architecture) · [Troubleshooting](#-troubleshooting)

</div>

---

## ⚡ Quick start

```bash
git clone https://github.com/nyxneverdie/Nyxium && cd nyxium
npm install          # runs the electron path fixup automatically
npm run dev          # hot-reloading dev window
```

Requires **Node 20+** (developed on 26) and a desktop session. Everything else is optional — Nyxium detects what you have and hides the rest.

---

## ✨ Features

<table>
<tr><td width="33%" valign="top">

### 🗂 Projects
Workspaces, stack tags, notes, recents. Fuzzy file search across a project (`Ctrl+P`).

</td><td width="33%" valign="top">

### 🤖 Local AI agent
Ollama, llama.cpp, any OpenAI-compatible server, or a custom endpoint. **No provider here accepts an API key** — inference never leaves the machine.

</td><td width="33%" valign="top">

### 🖥 Terminal
Real PTY via `node-pty` + xterm.js. Detects the shells actually installed, login shell first.

</td></tr>
<tr><td valign="top">

### 🌿 Git
Status, diff, log, branches, staging and commits for the active project.

</td><td valign="top">

### 🐳 Docker
Containers, images and logs — driven through the `docker` CLI, nothing reimplemented.

</td><td valign="top">

### 🗄 Database
SQLite, Postgres, MySQL and Redis through their own CLIs. Passwords go via env, never argv.

</td></tr>
<tr><td valign="top">

### 🔌 API playground
Build, send and inspect HTTP requests next to the project they belong to.

</td><td valign="top">

### ☁️ Cloud backup
Google Cloud Storage, authed through your existing `gcloud` login or a service-account key. Resumable, cancellable transfers.

</td><td valign="top">

### 🎨 Live palette
Reads `matugen`, `pywal`, `wallust` or **end-4** colors from disk — the whole UI follows your wallpaper. Or set colors by hand.

</td></tr>
</table>

<details>
<summary><b>🔐 How secrets are handled</b></summary>

<br/>

Credentials are encrypted with the OS keyring via Electron's `safeStorage` and stored in `credentials.bin` in the app data directory.

- Never written to the JSON config.
- Never sent to the renderer process — it may only *set* a value or ask *whether one exists*.
- A corrupt vault can't break startup; you just re-enter the value.

</details>

<details>
<summary><b>🛠 The AI agent's tool tiers</b></summary>

<br/>

Tools are grouped by how much damage they can do, and the UI gates them accordingly.

| Tier | Tools |
|---|---|
| `safe` — runs freely | `read_file`, `list_directory`, `search_code`, `search_files`, `find_symbol`, `git_status`, `git_diff`, `git_log`, `git_branch` |
| `confirm` — asks first | `write_file`, `edit_file`, `create_file`, `run_terminal`, `git_commit` |
| `dangerous` — explicit approval | `delete_file` |

Writes land in a diff review pane before they touch disk.

</details>

<details>
<summary><b>🎨 Palette provider lookup order</b></summary>

<br/>

The UI reads only [semantic names](src/shared/palette.ts) (`background`, `primary`, `onSurfaceVariant`, …) — never a provider directly. Providers are detected from these paths:

| Provider | Paths |
|---|---|
| `matugen` | `~/.cache/matugen/colors.json`, `~/.config/matugen/colors.json`, `~/.local/state/matugen/colors.json` |
| `pywal` | `~/.cache/wal/colors.json`, `~/.cache/wal/colors` |
| `wallust` | `~/.cache/wallust/colors.json`, `~/.cache/wallust/sequences.json`, `~/.config/wallust/colors.json` |
| `end4` | end-4 dotfiles color state |
| `manual` | whatever you set in Settings |

Material-style keys win when present; a plain pywal `colors` file (one hex per line) is also understood.

</details>

<details>
<summary><b>🧩 Optional CLI dependencies</b></summary>

<br/>

Nothing below is required to build or run. Each feature probes for its CLI with a short timeout and degrades quietly if it's missing.

| Feature | Needs |
|---|---|
| Docker view | `docker` |
| SQLite | `sqlite3` |
| Postgres | `psql` |
| MySQL | `mysql` |
| Redis | `redis-cli` |
| Cloud backup | `gcloud` (or a service-account key in Settings) |
| AI agent | a local Ollama / llama.cpp / OpenAI-compatible server |

</details>

---

## 🔨 Build

<details open>
<summary><b>Development</b></summary>

<br/>

```bash
npm install
npm run dev
```

`electron-vite dev` gives HMR in the renderer and restarts the main process on change.

</details>

<details>
<summary><b>Production build</b></summary>

<br/>

```bash
npm run build     # tsc --noEmit, then electron-vite build
npm start         # electron-vite preview — runs the built output
```

Output lands in `out/`, with `out/main/index.js` as the entry point declared in `package.json`.

</details>

<details>
<summary><b>Verify</b></summary>

<br/>

```bash
npm run typecheck   # strict tsc, no emit
npm run check       # runnable self-checks
```

`npm run check` bundles each `*.check.ts` with esbuild — aliasing `electron` to a stub so services import cleanly without a desktop runtime — and executes it:

```
src/main/services/git.check.ts
src/main/services/ai/tools.check.ts
src/main/services/ai/providers.check.ts
src/main/services/ai/custom.check.ts
src/main/services/cloud/backup.check.ts
src/main/services/infra.check.ts
src/main/services/webviews.check.ts
```

Run one on its own:

```bash
node scripts/run-check.mjs src/main/services/git.check.ts
```

</details>

<details>
<summary><b>All scripts</b></summary>

<br/>

| Script | Does |
|---|---|
| `npm run dev` | dev window with HMR |
| `npm run build` | typecheck + build to `out/` |
| `npm start` | preview the built app |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | run every self-check |
| `postinstall` | trims a trailing newline from `node_modules/electron/path.txt` (see [Troubleshooting](#-troubleshooting)) |

</details>

---

## ⌨️ Keyboard shortcuts

All bindings use `Ctrl` (`Cmd` on macOS) and are ignored while typing in a text field.

| Keys | Action |
|---|---|
| `Ctrl+K` | Command palette |
| `Ctrl+P` | Fuzzy file search |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+T` | New Projects tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Shift+T` | Reopen closed tab |
| `` Ctrl+` `` | Terminal |
| `Ctrl+Shift+A` | AI agent |
| `Ctrl+Shift+S` | Snippets |
| `Ctrl+,` | Settings |

---

## 🏛 Architecture

```
src/
├── main/                  Electron main — all privileged work lives here
│   ├── index.ts           window + lifecycle
│   ├── ipc.ts             the single renderer ⇄ main surface
│   └── services/
│       ├── ai/            agent loop, providers, tool definitions
│       ├── cloud/         GCS auth, backup planning, transfers
│       ├── git.ts  docker.ts  database.ts  terminal.ts
│       ├── projects.ts  search.ts  snippets.ts  api.ts
│       ├── palette.ts     provider detection + normalisation
│       ├── secrets.ts     safeStorage vault
│       └── store.ts       JSON config on disk
├── preload/index.ts       contextBridge, the only thing both sides see
├── renderer/
│   ├── features/          one directory-level view per sidebar entry
│   ├── components/        TitleBar, Sidebar, TabStrip, CommandPalette, Brand
│   ├── palette/           PaletteProvider → nyx('semanticKey')
│   └── state/store.ts     zustand
└── shared/                types.ts, palette.ts — the contract between sides
```

**Three rules the codebase keeps:**

1. The renderer never touches the filesystem, a CLI, or a credential. It asks `ipc.ts`.
2. The UI reads semantic palette names only, never a provider's raw output.
3. External tools are shelled out to, not reimplemented — `docker` already knows how to be Docker.

Path aliases: `@/*` → `src/renderer/*`, `@shared/*` → `src/shared/*`.

---

## 🩺 Troubleshooting

<details>
<summary><b><code>ENOENT</code> spawning Electron right after install</b></summary>

<br/>

Electron's loader reads `node_modules/electron/path.txt` and joins it onto the dist directory **without trimming**. Some installs write that file with a trailing newline, producing a spawn path that ends in `\n`. The binary is fine; the path isn't.

`scripts/fix-electron-path.mjs` runs on `postinstall` and trims it, so a reinstall can't reintroduce it. If you hit this after a manual `node_modules` edit:

```bash
node scripts/fix-electron-path.mjs
```

</details>

<details>
<summary><b>A view says a tool is missing</b></summary>

<br/>

That view's CLI isn't on `PATH`. Install it from the [optional dependencies](#-optional-cli-dependencies) table — Nyxium re-probes on reopen, no restart needed.

</details>

<details>
<summary><b>Cloud backup won't connect</b></summary>

<br/>

```bash
gcloud auth application-default login
```

Or add a service-account key in **Settings → Cloud**. Nyxium tries the key first, then your `gcloud` application-default credentials.

</details>

<details>
<summary><b>The AI agent finds no models</b></summary>

<br/>

Start a local server and point Nyxium at it in **Settings → AI**. Defaults assume Ollama on `localhost:11434`. Probes time out after 2.5s, so a stopped server never stalls the UI — it just reports nothing.

</details>

---

<div align="center">
<br/>
<img src="resources/logo.svg" alt="" width="150" />
<br/><br/>
<sub>Local-first. Your machine, your files, your models.</sub>
</div>
