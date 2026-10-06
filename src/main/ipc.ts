import { BrowserWindow, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { JsonStore } from './services/store.js'
import * as palette from './services/palette.js'
import { detectEnvironment, gitSummary, detectStack } from './services/system.js'
import {
  importProject, notificationStore, projectStore, reveal, serviceStore, workspaceStore,
} from './services/projects.js'
import * as git from './services/git.js'
import * as term from './services/terminal.js'
import * as search from './services/search.js'
import { snippetStore, upsert as upsertSnippet, remove as removeSnippet } from './services/snippets.js'
import { clipboard } from 'electron'
import * as agent from './services/ai/agent.js'
import { PROVIDERS, customHeaders, detectAll } from './services/ai/providers.js'
import { encryptionAvailable, getSecret, hasSecret, setSecret } from './services/secrets.js'
import * as cloud from './services/cloud/index.js'
import { GCS_SA_KEY, forgetToken } from './services/cloud/gcs.js'
import { dialog } from 'electron'
import { basename } from 'node:path'
import type { ApiRequest, CloudConfig, DbConnection } from '../shared/types.js'
import * as docker from './services/docker.js'
import * as db from './services/database.js'
import * as api from './services/api.js'
import * as webviews from './services/webviews.js'
import { applyEdit, safePath } from './services/ai/tools.js'
import type { AIConfig } from '../shared/types.js'
import { DEFAULT_CONFIG, type AppConfig, type ServiceEntry, type Snippet } from '../shared/types.js'

export const configStore = new JsonStore<AppConfig>('config.json', DEFAULT_CONFIG)

/** Reject anything that is not a plain non-empty string. */
const str = (v: unknown): string => {
  if (typeof v !== 'string' || !v.length) throw new Error('Invalid string argument')
  return v
}

/** Clamp an untrusted number to a sane positive integer. */
const num = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const projectById = (id: unknown) => {
  const p = projectStore.read().items.find((x) => x.id === str(id))
  if (!p) throw new Error('Unknown project')
  return p
}

let stopWatching: (() => void) | null = null

async function currentPalette() {
  const cfg = configStore.read()
  if (!cfg.palette.enabled) {
    return { provider: 'manual' as const, source: 'disabled', mode: 'dark' as const, colors: palette.FALLBACK }
  }
  return palette.load(cfg.palette.source, cfg.palette.customPaths, cfg.palette.manual)
}

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

export function startPaletteWatcher() {
  stopWatching?.()
  const cfg = configStore.read()
  stopWatching = palette.watchPalettes(cfg.palette.customPaths, async () => {
    broadcast('palette:changed', await currentPalette())
  })
}

export function registerIpc() {
  ipcMain.handle('config:get', () => configStore.read())
  ipcMain.handle('config:patch', async (_e, patch: Partial<AppConfig>) => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid config patch')
    const next = configStore.patch(patch)
    if (patch.palette) {
      startPaletteWatcher()
      broadcast('palette:changed', await currentPalette())
    }
    return next
  })

  ipcMain.handle('palette:current', () => currentPalette())
  ipcMain.handle('palette:detect', () => palette.detect(configStore.read().palette.customPaths))
  ipcMain.handle('palette:reload', async () => {
    const p = await currentPalette()
    broadcast('palette:changed', p)
    return p
  })

  ipcMain.handle('workspaces:list', () => workspaceStore.read().items)
  ipcMain.handle('workspaces:create', (_e, name: unknown) => {
    const items = [...workspaceStore.read().items, { id: randomUUID(), name: str(name).slice(0, 60) }]
    return workspaceStore.write({ items }).items
  })

  ipcMain.handle('projects:list', () => projectStore.read().items)
  ipcMain.handle('projects:import', async () => importProject(configStore.read().activeWorkspaceId))
  ipcMain.handle('projects:remove', (_e, id: unknown) => {
    const items = projectStore.read().items.filter((p) => p.id !== str(id))
    return projectStore.write({ items }).items
  })
  ipcMain.handle('projects:touch', async (_e, id: unknown) => {
    const target = projectById(id)
    const items = projectStore.read().items.map((p) =>
      p.id === target.id ? { ...p, lastOpenedAt: Date.now(), stack: p.stack } : p)
    return projectStore.write({ items }).items
  })
  ipcMain.handle('projects:setNotes', (_e, id: unknown, notes: unknown) => {
    const target = projectById(id)
    if (typeof notes !== 'string') throw new Error('Invalid notes')
    const items = projectStore.read().items.map((p) =>
      p.id === target.id ? { ...p, notes: notes.slice(0, 200_000) } : p)
    return projectStore.write({ items }).items
  })
  ipcMain.handle('projects:git', (_e, id: unknown) => gitSummary(projectById(id).path))
  ipcMain.handle('projects:env', (_e, id: unknown) => detectEnvironment(projectById(id).path))
  ipcMain.handle('projects:reveal', async (_e, id: unknown) => {
    await reveal(projectById(id).path)
  })
  ipcMain.handle('projects:rescan', async (_e, id: unknown) => {
    const target = projectById(id)
    const stack = await detectStack(target.path)
    const items = projectStore.read().items.map((p) => (p.id === target.id ? { ...p, stack } : p))
    return projectStore.write({ items }).items
  })

  ipcMain.handle('services:list', () => serviceStore.read().items)
  ipcMain.handle('services:add', (_e, input: unknown) => {
    const s = input as Partial<ServiceEntry>
    const url = new URL(str(s?.url)) // throws on malformed input
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) services are allowed')
    const entry: ServiceEntry = {
      id: randomUUID(),
      name: str(s?.name).slice(0, 80),
      url: url.toString(),
      icon: typeof s?.icon === 'string' ? s.icon : null,
      projectId: typeof s?.projectId === 'string' ? s.projectId : null,
      workspaceId: typeof s?.workspaceId === 'string' ? s.workspaceId : null,
      pinned: !!s?.pinned,
      builtin: false,
    }
    return serviceStore.write({ items: [...serviceStore.read().items, entry] }).items
  })
  ipcMain.handle('services:remove', (_e, id: unknown) => {
    const items = serviceStore.read().items.filter((s) => s.id !== str(id))
    return serviceStore.write({ items }).items
  })
  ipcMain.handle('services:openExternal', async (_e, url: unknown) => {
    const u = new URL(str(url))
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Refusing to open non-web URL')
    await shell.openExternal(u.toString())
  })

  ipcMain.handle('notifications:list', () => notificationStore.read().items)
  ipcMain.handle('notifications:markAllRead', () => {
    const items = notificationStore.read().items.map((n) => ({ ...n, read: true }))
    return notificationStore.write({ items }).items
  })
  ipcMain.handle('notifications:clear', () => notificationStore.write({ items: [] }).items)

  /* ── Terminal ─────────────────────────────────────────────────────── */

  ipcMain.handle('terminal:shells', () => term.detectShells())
  ipcMain.handle('terminal:create', (e, opts: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('No window for this request')
    const o = (opts ?? {}) as Record<string, unknown>
    return term.createSession(win, {
      shell: typeof o.shell === 'string' ? o.shell : undefined,
      cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
      cols: num(o.cols, 80),
      rows: num(o.rows, 24),
    })
  })
  ipcMain.on('terminal:write', (_e, id: unknown, data: unknown) => {
    if (typeof data === 'string') term.write(str(id), data)
  })
  ipcMain.on('terminal:resize', (_e, id: unknown, cols: unknown, rows: unknown) => {
    term.resize(str(id), num(cols, 80), num(rows, 24))
  })
  ipcMain.on('terminal:kill', (_e, id: unknown) => term.kill(str(id)))

  /* ── Git ──────────────────────────────────────────────────────────── */

  const repo = (id: unknown) => projectById(id).path
  const paths = (v: unknown): string[] => {
    if (!Array.isArray(v) || !v.length) throw new Error('No paths given')
    return v.map(str).slice(0, 500)
  }

  ipcMain.handle('git:status', (_e, id) => git.status(repo(id)))
  ipcMain.handle('git:diff', (_e, id, file: unknown, staged: unknown) =>
    git.diff(repo(id), typeof file === 'string' ? file : undefined, !!staged))
  ipcMain.handle('git:log', (_e, id, limit: unknown) => git.log(repo(id), num(limit, 50)))
  ipcMain.handle('git:branches', (_e, id) => git.branches(repo(id)))
  ipcMain.handle('git:stashes', (_e, id) => git.stashes(repo(id)))
  ipcMain.handle('git:stage', (_e, id, p: unknown) => git.stage(repo(id), paths(p)))
  ipcMain.handle('git:unstage', (_e, id, p: unknown) => git.unstage(repo(id), paths(p)))
  ipcMain.handle('git:discard', (_e, id, p: unknown) => git.discard(repo(id), paths(p)))
  ipcMain.handle('git:commit', (_e, id, message: unknown) => git.commit(repo(id), str(message).slice(0, 5000)))
  ipcMain.handle('git:pull', (_e, id) => git.pull(repo(id)))
  ipcMain.handle('git:push', (_e, id) => git.push(repo(id)))
  ipcMain.handle('git:fetch', (_e, id) => git.fetch(repo(id)))
  ipcMain.handle('git:checkout', (_e, id, name: unknown) => git.checkout(repo(id), str(name)))
  ipcMain.handle('git:createBranch', (_e, id, name: unknown) => git.createBranch(repo(id), str(name)))
  ipcMain.handle('git:merge', (_e, id, name: unknown) => git.merge(repo(id), str(name)))
  ipcMain.handle('git:stashPush', (_e, id, message: unknown) =>
    git.stashPush(repo(id), typeof message === 'string' && message ? message : undefined))
  ipcMain.handle('git:stashPop', (_e, id, ref: unknown) => git.stashPop(repo(id), str(ref)))
  ipcMain.handle('git:stashDrop', (_e, id, ref: unknown) => git.stashDrop(repo(id), str(ref)))

  /* ── Snippets ─────────────────────────────────────────────────────── */

  ipcMain.handle('snippets:list', () => snippetStore.read().items)
  ipcMain.handle('snippets:save', (_e, id: unknown, draft: unknown) => {
    if (!draft || typeof draft !== 'object') throw new Error('Invalid snippet')
    return upsertSnippet(id === null ? null : str(id), draft as Partial<Snippet>)
  })
  ipcMain.handle('snippets:remove', (_e, id: unknown) => removeSnippet(str(id)))
  ipcMain.handle('snippets:copy', (_e, code: unknown) => {
    clipboard.writeText(String(code ?? '').slice(0, 500_000))
  })

  /* ── Project search ───────────────────────────────────────────────── */

  ipcMain.handle('search:files', (_e, id, q: unknown) => search.searchFiles(repo(id), String(q ?? '')))
  ipcMain.handle('search:code', (_e, id, q: unknown) => search.searchCode(repo(id), String(q ?? '')))
  ipcMain.handle('search:symbol', (_e, id, n: unknown) => search.findSymbol(repo(id), str(n)))

  /* ── Local AI ─────────────────────────────────────────────────────── */

  /** The project an AI request names, or null. Never trusted as a path. */
  const optionalProject = (id: unknown) =>
    typeof id === 'string' && id ? projectById(id) : null

  ipcMain.handle('ai:config', () => agent.aiConfigStore.read())
  ipcMain.handle('ai:patchConfig', (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid AI config patch')
    const p = patch as Partial<AIConfig>
    // Endpoints must be URLs the main process is willing to call.
    if (p.endpoints) {
      for (const [id, url] of Object.entries(p.endpoints)) {
        if (id === 'custom' && !url) continue // an unconfigured custom endpoint is allowed
        const u = new URL(str(url))
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Endpoint must be an http(s) URL')
      }
    }
    if (p.custom) {
      const c = p.custom
      if (c.url) {
        const u = new URL(str(c.url))
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('The custom endpoint must be an http(s) URL')
      }
      // hasKey is derived from the vault, never set by the renderer, and a key
      // must never be written into the plain-text config.
      p.custom = {
        ...c,
        label: String(c.label ?? '').slice(0, 80),
        models: (c.models ?? []).slice(0, 50).map((m) => String(m).slice(0, 120)).filter(Boolean),
        authHeader: String(c.authHeader || 'Authorization').slice(0, 80),
        authScheme: String(c.authScheme ?? '').slice(0, 40),
        headers: Object.fromEntries(
          Object.entries(c.headers ?? {}).slice(0, 20)
            .map(([k, v]) => [String(k).slice(0, 80), String(v).slice(0, 400)]),
        ),
        hasKey: hasSecret(agent.CUSTOM_KEY),
      }
    }
    return agent.aiConfigStore.patch(p)
  })

  ipcMain.handle('ai:detect', () =>
    detectAll(agent.aiConfigStore.read(), getSecret(agent.CUSTOM_KEY)))

  ipcMain.handle('ai:models', () => {
    const cfg = agent.aiConfigStore.read()
    if (cfg.provider === 'custom') {
      return PROVIDERS.custom.listModels(
        cfg.custom.url,
        customHeaders(cfg.custom, getSecret(agent.CUSTOM_KEY)),
        cfg.custom.models,
      )
    }
    return PROVIDERS[cfg.provider].listModels(cfg.endpoints[cfg.provider])
  })

  /** The key goes straight to the OS keyring; `hasKey` is all the renderer learns. */
  ipcMain.handle('ai:setCustomKey', (_e, key: unknown) => {
    const value = typeof key === 'string' && key.trim() ? key.trim() : null
    setSecret(agent.CUSTOM_KEY, value)
    const cfg = agent.aiConfigStore.read()
    return agent.aiConfigStore.patch({ custom: { ...cfg.custom, hasKey: hasSecret(agent.CUSTOM_KEY) } })
  })

  ipcMain.handle('ai:secretsEncrypted', () => encryptionAvailable())
  ipcMain.handle('ai:pull', async (e, model: unknown) => {
    const cfg = agent.aiConfigStore.read()
    const provider = PROVIDERS[cfg.provider]
    if (!provider.pull) throw new Error(`${provider.label} does not support pulling models`)
    const name = str(model)
    await provider.pull(cfg.endpoints[cfg.provider], name, (pct, status) => {
      e.sender.send('ai:pullProgress', { model: name, pct, status })
    })
  })
  ipcMain.handle('ai:removeModel', (_e, model: unknown) => {
    const cfg = agent.aiConfigStore.read()
    const provider = PROVIDERS[cfg.provider]
    if (!provider.remove) throw new Error(`${provider.label} does not support deleting models`)
    return provider.remove(cfg.endpoints[cfg.provider], str(model))
  })

  ipcMain.handle('ai:sessions', () => agent.listSessions())
  ipcMain.handle('ai:createSession', (_e, projectId: unknown) =>
    agent.createSession(optionalProject(projectId)?.id ?? null))
  ipcMain.handle('ai:renameSession', (_e, id: unknown, title: unknown) =>
    agent.renameSession(str(id), str(title)))
  ipcMain.handle('ai:deleteSession', (_e, id: unknown) => agent.deleteSession(str(id)))

  ipcMain.handle('ai:send', async (e, raw: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('No window for this request')
    const o = (raw ?? {}) as Record<string, unknown>
    const project = optionalProject(o.projectId)

    // Attachments are read here, in main, and refused for protected files.
    const attachments: Array<{ path: string; content: string }> = []
    if (Array.isArray(o.attachments) && project) {
      const { readFile } = await import('node:fs/promises')
      for (const rel of o.attachments.slice(0, 20)) {
        const { abs, rel: safe } = safePath({ projectPath: project.path, maxChars: 0 }, rel)
        attachments.push({ path: safe, content: (await readFile(abs, 'utf8')).slice(0, 60_000) })
      }
    }

    await agent.sendMessage(win, {
      sessionId: str(o.sessionId),
      text: String(o.text ?? '').slice(0, 100_000),
      project,
      attachments,
    })
  })

  ipcMain.on('ai:cancel', (_e, id: unknown) => agent.cancel(str(id)))
  ipcMain.on('ai:approve', (_e, callId: unknown, approved: unknown) =>
    agent.resolveApproval(str(callId), approved === true))

  ipcMain.handle('ai:applyEdit', async (_e, projectId: unknown, path: unknown, content: unknown) => {
    const project = optionalProject(projectId)
    if (!project) throw new Error('A project is required to write files')
    await applyEdit({ projectPath: project.path, maxChars: 0 }, str(path), String(content ?? ''))
  })

  /* ── Cloud storage ────────────────────────────────────────────────── */

  /** An object name supplied by the renderer must stay inside the bucket. */
  const objectName = (v: unknown): string => {
    const n = str(v)
    if (n.startsWith('/') || n.includes('..')) throw new Error('Invalid object name')
    return n.slice(0, 1024)
  }

  const prefixArg = (v: unknown): string => {
    if (v === undefined || v === null || v === '') return ''
    const p = String(v)
    if (p.startsWith('/') || p.includes('..')) throw new Error('Invalid prefix')
    return p.slice(0, 1024)
  }

  const bucket = () => {
    const b = cloud.cloudStore.read().bucket
    if (!b) throw new Error('No bucket is configured. Choose one in Cloud Storage.')
    return b
  }

  const win = (e: Electron.IpcMainInvokeEvent) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) throw new Error('No window for this request')
    return w
  }

  ipcMain.handle('cloud:config', () => cloud.cloudStore.read())
  ipcMain.handle('cloud:patchConfig', (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid cloud config patch')
    const p = patch as Partial<CloudConfig>
    return cloud.cloudStore.patch({
      ...p,
      ...(p.project !== undefined ? { project: String(p.project).slice(0, 120) } : {}),
      ...(p.bucket !== undefined ? { bucket: String(p.bucket).slice(0, 240) } : {}),
    })
  })

  ipcMain.handle('cloud:status', () => cloud.status())

  /** The service-account JSON goes to the OS keyring and never comes back out. */
  ipcMain.handle('cloud:setServiceAccount', async (_e, json: unknown) => {
    const value = typeof json === 'string' && json.trim() ? json.trim() : null
    if (value) {
      let parsed: { client_email?: string; private_key?: string }
      try { parsed = JSON.parse(value) } catch { throw new Error('That is not valid JSON.') }
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error('That JSON does not look like a service-account key (no client_email / private_key).')
      }
    }
    setSecret(GCS_SA_KEY, value)
    forgetToken()
    return cloud.status()
  })

  ipcMain.handle('cloud:buckets', () => cloud.gcs.listBuckets(cloud.cloudStore.read().project))
  ipcMain.handle('cloud:list', (_e, prefix: unknown, pageToken: unknown) =>
    cloud.gcs.listObjects(bucket(), prefixArg(prefix), typeof pageToken === 'string' ? pageToken : undefined))
  ipcMain.handle('cloud:search', (_e, prefix: unknown, query: unknown) =>
    cloud.gcs.searchObjects(bucket(), prefixArg(prefix), String(query ?? '').slice(0, 200)))
  ipcMain.handle('cloud:createFolder', (_e, prefix: unknown) =>
    cloud.gcs.createFolder(bucket(), objectName(prefix)))
  ipcMain.handle('cloud:remove', (_e, name: unknown) => cloud.gcs.remove(bucket(), objectName(name)))
  ipcMain.handle('cloud:move', (_e, from: unknown, to: unknown) =>
    cloud.gcs.move(bucket(), objectName(from), objectName(to)))

  ipcMain.handle('cloud:upload', (e, localPath: unknown, name: unknown) =>
    cloud.uploadFile(win(e), str(localPath), objectName(name)))

  ipcMain.handle('cloud:uploadDialog', async (e, prefix: unknown) => {
    const w = win(e)
    const r = await dialog.showOpenDialog(w, {
      title: 'Upload to Google Cloud Storage',
      properties: ['openFile', 'multiSelections'],
    })
    if (r.canceled) return []
    const p = prefixArg(prefix)
    const out = []
    for (const file of r.filePaths.slice(0, 50)) {
      out.push(await cloud.uploadFile(w, file, `${p}${basename(file)}`))
    }
    return out
  })

  ipcMain.handle('cloud:download', async (e, name: unknown) => {
    const w = win(e)
    const object = objectName(name)
    const r = await dialog.showSaveDialog(w, {
      title: 'Download from Google Cloud Storage',
      defaultPath: basename(object),
    })
    if (r.canceled || !r.filePath) return null
    await cloud.downloadFile(w, object, r.filePath)
    return r.filePath
  })

  ipcMain.handle('cloud:previewBackup', (_e, id: unknown) => cloud.previewBackup(projectById(id)))
  ipcMain.handle('cloud:backup', (e, id: unknown) => cloud.backupProject(win(e), projectById(id)))

  ipcMain.handle('cloud:restore', async (e, name: unknown) => {
    const w = win(e)
    const object = objectName(name)
    const r = await dialog.showOpenDialog(w, {
      title: 'Restore into which directory?',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths[0]) return null
    // Restoring over an existing project is the caller's decision; the renderer
    // confirms before getting here.
    await cloud.restoreProject(w, object, r.filePaths[0])
    return r.filePaths[0]
  })

  ipcMain.handle('cloud:transfers', () => cloud.listTransfers())
  ipcMain.on('cloud:cancel', (_e, id: unknown) => cloud.cancelTransfer(str(id)))

  /* ── Docker ───────────────────────────────────────────────────────── */

  ipcMain.handle('docker:available', () => docker.available())
  ipcMain.handle('docker:containers', () => docker.containers())
  ipcMain.handle('docker:images', () => docker.images())
  ipcMain.handle('docker:volumes', () => docker.volumes())
  ipcMain.handle('docker:networks', () => docker.networks())
  ipcMain.handle('docker:logs', (_e, id: unknown, tail: unknown) => docker.logs(str(id), num(tail, 200)))
  ipcMain.handle('docker:start', (_e, id: unknown) => docker.start(str(id)))
  ipcMain.handle('docker:stop', (_e, id: unknown) => docker.stop(str(id)))
  ipcMain.handle('docker:restart', (_e, id: unknown) => docker.restart(str(id)))
  ipcMain.handle('docker:removeContainer', (_e, id: unknown) => docker.removeContainer(str(id)))
  ipcMain.handle('docker:removeImage', (_e, id: unknown) => docker.removeImage(str(id)))
  ipcMain.handle('docker:removeVolume', (_e, n: unknown) => docker.removeVolume(str(n)))
  ipcMain.handle('docker:shellCommand', (_e, id: unknown) => docker.shellCommand(str(id)))

  /* ── Database ─────────────────────────────────────────────────────── */

  ipcMain.handle('db:list', () => db.connectionStore.read().items)
  ipcMain.handle('db:save', (_e, conn: unknown, password: unknown) => {
    if (!conn || typeof conn !== 'object') throw new Error('Invalid connection')
    // null means "leave the stored password alone"; a string replaces it.
    const pw = password === null || password === undefined ? null : String(password)
    return db.saveConnection(conn as Partial<DbConnection>, pw)
  })
  ipcMain.handle('db:remove', (_e, id: unknown) => db.removeConnection(str(id)))
  ipcMain.handle('db:test', (_e, id: unknown) => db.testConnection(str(id)))
  ipcMain.handle('db:tables', (_e, id: unknown) => db.tables(str(id)))
  ipcMain.handle('db:schema', (_e, id: unknown, t: unknown) => db.schema(str(id), str(t)))
  ipcMain.handle('db:browse', (_e, id: unknown, t: unknown, limit: unknown) =>
    db.browse(str(id), str(t), num(limit, 100)))
  ipcMain.handle('db:query', (_e, id: unknown, sql: unknown) => db.query(str(id), str(sql)))
  ipcMain.handle('db:isDestructive', (_e, sql: unknown) => db.isDestructive(String(sql ?? '')))

  /* ── API playground ───────────────────────────────────────────────── */

  ipcMain.handle('api:send', (_e, opts: unknown) => {
    if (!opts || typeof opts !== 'object') throw new Error('Invalid request')
    const o = opts as Record<string, unknown>
    const pairs = (v: unknown) => Array.isArray(v)
      ? v.slice(0, 50).map((x) => ({ key: String((x as { key?: unknown }).key ?? ''), value: String((x as { value?: unknown }).value ?? '') }))
      : []
    return api.send({
      method: String(o.method ?? 'GET'),
      url: str(o.url),
      headers: pairs(o.headers),
      params: pairs(o.params),
      body: String(o.body ?? ''),
    })
  })
  ipcMain.handle('api:saved', () => api.requestStore.read().items)
  ipcMain.handle('api:save', (_e, req: unknown) => {
    if (!req || typeof req !== 'object') throw new Error('Invalid request')
    return api.saveRequest(req as Partial<ApiRequest>)
  })
  ipcMain.handle('api:remove', (_e, id: unknown) => api.removeRequest(str(id)))
  ipcMain.handle('api:history', () => api.historyStore.read().items)
  ipcMain.handle('api:clearHistory', () => api.clearHistory())

  /* ── Embedded web services ────────────────────────────────────────── */

  /** Bounds arrive from the renderer's layout; clamp them to sane integers. */
  const boundsArg = (v: unknown) => {
    const b = (v ?? {}) as Record<string, unknown>
    const n = (x: unknown) => Math.max(0, Math.round(Number(x) || 0))
    return { x: n(b.x), y: n(b.y), width: Math.max(1, n(b.width)), height: Math.max(1, n(b.height)) }
  }

  /** Only a service Nyxium knows about may be embedded, at its own URL. */
  const serviceUrl = (id: string) => {
    const s = serviceStore.read().items.find((x) => x.id === id)
    if (!s) throw new Error('Unknown service')
    const u = new URL(s.url)
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http(s) services can be embedded')
    return u.toString()
  }

  ipcMain.handle('webview:open', (e, id: unknown, _url: unknown, bounds: unknown) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) throw new Error('No window for this request')
    const serviceId = str(id)
    webviews.createView(w, serviceId, serviceUrl(serviceId), boundsArg(bounds))
  })
  ipcMain.on('webview:setBounds', (_e, id: unknown, bounds: unknown) =>
    webviews.setBounds(str(id), boundsArg(bounds)))
  ipcMain.on('webview:showOnly', (_e, id: unknown, bounds: unknown) =>
    webviews.showOnly(typeof id === 'string' && id ? id : null, bounds ? boundsArg(bounds) : undefined))
  ipcMain.on('webview:close', (_e, id: unknown) => webviews.destroy(str(id)))
  ipcMain.on('webview:back', (_e, id: unknown) => webviews.goBack(str(id)))
  ipcMain.on('webview:forward', (_e, id: unknown) => webviews.goForward(str(id)))
  ipcMain.on('webview:reload', (_e, id: unknown) => webviews.reload(str(id)))
  ipcMain.handle('webview:clearSession', (_e, id: unknown) => webviews.clearSession(str(id)))

  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window:toggleMaximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
}
