export type ViewId =
  | 'dashboard' | 'projects' | 'services'
  | 'ai' | 'terminal' | 'git' | 'database' | 'docker' | 'snippets' | 'api'
  | 'cloud'
  | 'notifications' | 'settings'

export interface StackTag { id: string; label: string }

export interface Project {
  id: string
  name: string
  path: string
  stack: string[]
  workspaceId: string
  createdAt: number
  lastOpenedAt: number | null
  notes: string
}

export interface Workspace { id: string; name: string }

export interface ServiceEntry {
  id: string
  name: string
  url: string
  icon: string | null
  projectId: string | null
  workspaceId: string | null
  pinned: boolean
  builtin: boolean
}

export interface NyxNotification {
  id: string
  source: 'github' | 'vercel' | 'git' | 'docker' | 'ai' | 'cloud' | 'system'
  title: string
  body: string
  at: number
  read: boolean
}

export interface GitSummary { isRepo: boolean; branch: string | null; dirty: number; ahead: number; behind: number }

export interface EnvTool { name: string; version: string | null }

/* ── Git ─────────────────────────────────────────────────────────────── */

export interface GitFileChange {
  path: string
  staged: boolean
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'conflicted' | 'untracked'
}

export interface GitCommit {
  hash: string; short: string; author: string; at: number; subject: string; refs: string[]
}

export interface GitBranchInfo { name: string; current: boolean; remote: boolean; upstream: string | null }
export interface GitStashEntry { ref: string; subject: string; at: number }

export interface CommandResult { ok: boolean; stdout: string; stderr: string }

/* ── Snippets ────────────────────────────────────────────────────────── */

export interface Snippet {
  id: string
  title: string
  language: string
  code: string
  tags: string[]
  favorite: boolean
  projectId: string | null
  createdAt: number
  updatedAt: number
}

/* ── Search ──────────────────────────────────────────────────────────── */

export interface FileHit { path: string }
export interface CodeHit { path: string; line: number; text: string }

/* ── Terminal ────────────────────────────────────────────────────────── */

export interface ShellInfo { path: string; name: string }
export interface TerminalSession { id: string; shell: string }

export interface AppConfig {
  theme: 'system' | 'dark' | 'light'
  density: 'compact' | 'comfortable' | 'spacious'
  reducedMotion: boolean
  sidebarCollapsed: boolean
  palette: {
    enabled: boolean
    source: 'auto' | 'matugen' | 'pywal' | 'wallust' | 'end4' | 'manual'
    customPaths: Partial<Record<'matugen' | 'pywal' | 'wallust' | 'end4', string>>
    manual: Record<string, string>
  }
  activeWorkspaceId: string
  terminal: { shell: string | null; fontSize: number; fontFamily: string }
}

export const DEFAULT_CONFIG: AppConfig = {
  theme: 'dark',
  density: 'comfortable',
  reducedMotion: false,
  sidebarCollapsed: false,
  palette: { enabled: true, source: 'auto', customPaths: {}, manual: {} },
  activeWorkspaceId: 'personal',
  terminal: { shell: null, fontSize: 13, fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace' },
}

/** Shape of the preload bridge, shared by main and renderer. */
export interface NyxApi {
  config: {
    get(): Promise<AppConfig>
    patch(patch: Partial<AppConfig>): Promise<AppConfig>
  }
  palette: {
    current(): Promise<import('./palette').PaletteSnapshot>
    detect(): Promise<import('./palette').DetectedProvider[]>
    reload(): Promise<import('./palette').PaletteSnapshot>
    onChange(cb: (p: import('./palette').PaletteSnapshot) => void): () => void
  }
  workspaces: { list(): Promise<Workspace[]>; create(name: string): Promise<Workspace[]> }
  projects: {
    list(): Promise<Project[]>
    import(): Promise<Project | null>
    create(): Promise<Project | null>
    remove(id: string): Promise<Project[]>
    touch(id: string): Promise<Project[]>
    setNotes(id: string, notes: string): Promise<Project[]>
    git(id: string): Promise<GitSummary>
    env(id: string): Promise<EnvTool[]>
    reveal(id: string): Promise<void>
  }
  services: {
    list(): Promise<ServiceEntry[]>
    add(s: Omit<ServiceEntry, 'id' | 'builtin'>): Promise<ServiceEntry[]>
    remove(id: string): Promise<ServiceEntry[]>
    openExternal(url: string): Promise<void>
  }
  notifications: {
    list(): Promise<NyxNotification[]>
    markAllRead(): Promise<NyxNotification[]>
    clear(): Promise<NyxNotification[]>
    onNew(cb: (n: NyxNotification) => void): () => void
  }
  terminal: {
    shells(): Promise<ShellInfo[]>
    create(opts: { shell?: string; cwd?: string; cols?: number; rows?: number }): Promise<TerminalSession>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (e: { id: string; data: string }) => void): () => void
    onExit(cb: (e: { id: string; exitCode: number }) => void): () => void
  }
  git: {
    status(projectId: string): Promise<GitFileChange[]>
    diff(projectId: string, file?: string, staged?: boolean): Promise<string>
    log(projectId: string, limit?: number): Promise<GitCommit[]>
    branches(projectId: string): Promise<GitBranchInfo[]>
    stashes(projectId: string): Promise<GitStashEntry[]>
    stage(projectId: string, paths: string[]): Promise<CommandResult>
    unstage(projectId: string, paths: string[]): Promise<CommandResult>
    discard(projectId: string, paths: string[]): Promise<CommandResult>
    commit(projectId: string, message: string): Promise<CommandResult>
    pull(projectId: string): Promise<CommandResult>
    push(projectId: string): Promise<CommandResult>
    fetch(projectId: string): Promise<CommandResult>
    checkout(projectId: string, name: string): Promise<CommandResult>
    createBranch(projectId: string, name: string): Promise<CommandResult>
    merge(projectId: string, name: string): Promise<CommandResult>
    stashPush(projectId: string, message?: string): Promise<CommandResult>
    stashPop(projectId: string, ref: string): Promise<CommandResult>
    stashDrop(projectId: string, ref: string): Promise<CommandResult>
  }
  snippets: {
    list(): Promise<Snippet[]>
    save(id: string | null, draft: Partial<Snippet>): Promise<Snippet[]>
    remove(id: string): Promise<Snippet[]>
    copy(code: string): Promise<void>
  }
  search: {
    files(projectId: string, query: string): Promise<FileHit[]>
    code(projectId: string, query: string): Promise<CodeHit[]>
    symbol(projectId: string, name: string): Promise<CodeHit[]>
  }
  ai: {
    config(): Promise<AIConfig>
    patchConfig(patch: Partial<AIConfig>): Promise<AIConfig>
    detect(): Promise<AIBackend[]>
    models(): Promise<AIModel[]>
    pull(model: string): Promise<void>
    removeModel(model: string): Promise<void>
    /** Stores the custom endpoint's key in the OS keyring. null clears it. */
    setCustomKey(key: string | null): Promise<AIConfig>
    secretsEncrypted(): Promise<boolean>
    sessions(): Promise<AISession[]>
    createSession(projectId: string | null): Promise<AISession>
    renameSession(id: string, title: string): Promise<AISession[]>
    deleteSession(id: string): Promise<AISession[]>
    send(opts: { sessionId: string; text: string; projectId: string | null; attachments: string[] }): Promise<void>
    cancel(sessionId: string): void
    approve(callId: string, approved: boolean): void
    applyEdit(projectId: string | null, path: string, content: string): Promise<void>
    onStream(cb: (e: AIStreamEvent) => void): () => void
    onPullProgress(cb: (e: { model: string; pct: number; status: string }) => void): () => void
  }
  cloud: {
    config(): Promise<CloudConfig>
    patchConfig(patch: Partial<CloudConfig>): Promise<CloudConfig>
    status(): Promise<CloudStatus>
    setServiceAccount(json: string | null): Promise<CloudStatus>
    buckets(): Promise<CloudBucket[]>
    list(prefix: string, pageToken?: string): Promise<{
      prefixes: string[]; objects: CloudObject[]; nextPageToken: string | null
    }>
    search(prefix: string, query: string): Promise<CloudObject[]>
    createFolder(prefix: string): Promise<void>
    remove(name: string): Promise<void>
    move(from: string, to: string): Promise<void>
    upload(localPath: string, objectName: string): Promise<CloudObject>
    uploadDialog(prefix: string): Promise<CloudObject[]>
    download(name: string): Promise<string | null>
    previewBackup(projectId: string): Promise<BackupPreview>
    backup(projectId: string): Promise<string>
    restore(objectName: string): Promise<string | null>
    transfers(): Promise<TransferProgress[]>
    cancel(id: string): void
    onProgress(cb: (p: TransferProgress) => void): () => void
  }
  docker: {
    available(): Promise<{ ok: boolean; detail: string | null }>
    containers(): Promise<DockerContainer[]>
    images(): Promise<DockerImage[]>
    volumes(): Promise<DockerVolume[]>
    networks(): Promise<DockerNetwork[]>
    logs(id: string, tail?: number): Promise<string>
    start(id: string): Promise<CommandResult>
    stop(id: string): Promise<CommandResult>
    restart(id: string): Promise<CommandResult>
    removeContainer(id: string): Promise<CommandResult>
    removeImage(id: string): Promise<CommandResult>
    removeVolume(name: string): Promise<CommandResult>
    shellCommand(id: string): Promise<string>
  }
  db: {
    list(): Promise<DbConnection[]>
    save(conn: Partial<DbConnection>, password: string | null): Promise<DbConnection[]>
    remove(id: string): Promise<DbConnection[]>
    test(id: string): Promise<{ ok: boolean; detail: string | null }>
    tables(id: string): Promise<DbTable[]>
    schema(id: string, table: string): Promise<DbQueryResult>
    browse(id: string, table: string, limit?: number): Promise<DbQueryResult>
    query(id: string, sql: string): Promise<DbQueryResult>
    isDestructive(sql: string): Promise<boolean>
  }
  api: {
    send(opts: {
      method: string; url: string
      headers: Array<{ key: string; value: string }>
      params: Array<{ key: string; value: string }>
      body: string
    }): Promise<ApiResponse>
    saved(): Promise<ApiRequest[]>
    save(req: Partial<ApiRequest>): Promise<ApiRequest[]>
    remove(id: string): Promise<ApiRequest[]>
    history(): Promise<ApiHistoryEntry[]>
    clearHistory(): Promise<ApiHistoryEntry[]>
  }
  webview: {
    open(serviceId: string, url: string, bounds: ViewBounds): Promise<void>
    setBounds(serviceId: string, bounds: ViewBounds): void
    showOnly(serviceId: string | null, bounds?: ViewBounds): void
    close(serviceId: string): void
    back(serviceId: string): void
    forward(serviceId: string): void
    reload(serviceId: string): void
    clearSession(serviceId: string): Promise<void>
    onState(cb: (s: WebviewState) => void): () => void
  }
  /** Resolves a dropped File to its path on disk, or null. */
  filePath(file: File): string | null
  window: { minimize(): void; toggleMaximize(): void; close(): void }
}

/* ── Local AI ────────────────────────────────────────────────────────── */

export type AIBackendId = 'ollama' | 'llamacpp' | 'openai-compatible' | 'custom'

export interface AIBackend {
  id: AIBackendId
  label: string
  endpoint: string
  available: boolean
  /** Why it is unavailable, when it is. Never a raw stack trace. */
  detail: string | null
}

export interface AIModel {
  name: string
  size: number | null
  /** Context length in tokens when the backend reports one. */
  context: number | null
  provider: AIBackendId
  loaded: boolean
  family: string | null
}

export type AIRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AIToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  /** Set once the call has run. */
  result?: string
  status: 'pending' | 'awaiting-approval' | 'running' | 'done' | 'denied' | 'error'
}

export interface AIMessage {
  id: string
  role: AIRole
  content: string
  at: number
  toolCalls?: AIToolCall[]
}

export interface AISession {
  id: string
  title: string
  projectId: string | null
  messages: AIMessage[]
  createdAt: number
  updatedAt: number
}

export type AIMode = 'ask' | 'plan' | 'agent' | 'trusted'
export type AIResourceMode = 'performance' | 'balanced' | 'low-ram'

/** A user-defined endpoint. The API key never lives here — only in the vault. */
export interface CustomProviderConfig {
  /** Shown in the UI, e.g. "Workstation llama.cpp" or "Team gateway". */
  label: string
  /** Base URL of an OpenAI-compatible API, e.g. http://10.0.0.5:8000/v1 */
  url: string
  /** Models the user declared for this endpoint, since /models may not exist. */
  models: string[]
  /** Header carrying the key. Defaults to Authorization: Bearer <key>. */
  authHeader: string
  authScheme: string
  /** Extra headers, e.g. a gateway's routing header. */
  headers: Record<string, string>
  /** True once a key has been stored in the OS keyring. */
  hasKey: boolean
}

export interface AIConfig {
  enabled: boolean
  provider: AIBackendId
  endpoints: Record<AIBackendId, string>
  model: string | null
  temperature: number
  contextSize: number
  maxTokens: number
  mode: AIMode
  resourceMode: AIResourceMode
  custom: CustomProviderConfig
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: true,
  provider: 'ollama',
  endpoints: {
    ollama: 'http://127.0.0.1:11434',
    llamacpp: 'http://127.0.0.1:8080',
    'openai-compatible': 'http://127.0.0.1:8000/v1',
    custom: '',
  },
  model: null,
  temperature: 0.2,
  contextSize: 8192,
  maxTokens: 2048,
  mode: 'agent',
  resourceMode: 'balanced',
  custom: {
    label: 'Custom endpoint',
    url: '',
    models: [],
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    headers: {},
    hasKey: false,
  },
}

/** Permission tier for an agent tool. Dangerous tools are never auto-approved. */
export type ToolTier = 'safe' | 'confirm' | 'dangerous'

export interface ToolSpec {
  name: string
  tier: ToolTier
  description: string
  parameters: Record<string, { type: string; description: string; required?: boolean }>
}

export interface FileEdit { path: string; before: string; after: string }

export interface AIStreamEvent {
  sessionId: string
  /** 'message' closes one assistant turn; several may occur per request as the
   *  agent alternates between speaking and calling tools. */
  type: 'token' | 'message' | 'tool-call' | 'tool-result' | 'done' | 'error'
  text?: string
  message?: AIMessage
  toolCall?: AIToolCall
  error?: string
}

/* ── Cloud storage ───────────────────────────────────────────────────── */

export type CloudCredentialKind = 'none' | 'gcloud' | 'service-account'

export interface CloudBucket { name: string; location: string | null; storageClass: string | null }

export interface CloudObject {
  name: string
  size: number
  updated: number
  contentType: string | null
}

export interface CloudStatus {
  connected: boolean
  credential: CloudCredentialKind
  project: string
  bucket: string
  detail: string | null
}

export interface CloudConfig {
  project: string
  bucket: string
  /** Per-project mapping: project id → bucket prefix. */
  prefixes: Record<string, string>
  /** Projects with backup enabled. */
  backupEnabled: Record<string, boolean>
  lastBackupAt: Record<string, number>
}

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
  project: '', bucket: '', prefixes: {}, backupEnabled: {}, lastBackupAt: {},
}

export interface TransferProgress {
  id: string
  kind: 'upload' | 'download' | 'backup' | 'restore'
  label: string
  sent: number
  total: number
  status: 'running' | 'done' | 'error' | 'cancelled'
  error?: string
}

export interface BackupPreview {
  fileCount: number
  totalBytes: number
  excludedSecrets: string[]
  truncated: boolean
}

/* ── Docker ──────────────────────────────────────────────────────────── */

export interface DockerContainer {
  id: string; name: string; image: string; state: string; status: string; ports: string[]
}
export interface DockerImage {
  id: string; repository: string; tag: string; size: string; createdAt: string
}
export interface DockerVolume { name: string; driver: string; mountpoint: string | null }
export interface DockerNetwork { id: string; name: string; driver: string; scope: string }

/* ── Database ────────────────────────────────────────────────────────── */

export type DbDriver = 'sqlite' | 'postgres' | 'mysql' | 'redis'

export interface DbConnection {
  id: string
  name: string
  driver: DbDriver
  host: string
  port: number
  /** For SQLite this is the file path. */
  database: string
  user: string
  hasPassword: boolean
  projectId: string | null
}

export interface DbTable { name: string }

export interface DbQueryResult {
  columns: string[]
  rows: Array<Array<string | null>>
  rowCount: number
}

/* ── API playground ──────────────────────────────────────────────────── */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiRequest {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: Array<{ key: string; value: string }>
  params: Array<{ key: string; value: string }>
  body: string
  projectId: string | null
  savedAt: number
}

export interface ApiResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  durationMs: number
  size: number
}

export interface ApiHistoryEntry {
  id: string
  method: HttpMethod
  url: string
  status: number
  at: number
  durationMs: number
}

/* ── Embedded web services ───────────────────────────────────────────── */

export interface ViewBounds { x: number; y: number; width: number; height: number }

export interface WebviewState {
  serviceId: string
  url?: string
  title?: string
  canGoBack?: boolean
  canGoForward?: boolean
  loading?: boolean
  error?: string
}
