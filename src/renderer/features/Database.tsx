import { useCallback, useEffect, useState } from 'react'
import { Database as DbIcon, Play, Plus, RefreshCw, Table2, Trash2, X } from 'lucide-react'
import type { DbConnection, DbDriver, DbQueryResult, DbTable } from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxDialog, NyxDropdown, NyxEmptyState, NyxIconButton, NyxPermissionDialog,
  NyxStatus, NyxTextField,
} from '../components/nyx'

const DRIVERS: Array<{ value: DbDriver; label: string }> = [
  { value: 'sqlite', label: 'SQLite' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'redis', label: 'Redis' },
]

const blank = (): Partial<DbConnection> => ({
  name: '', driver: 'sqlite', host: '127.0.0.1', port: 0, database: '', user: '', projectId: null,
})

export function Database() {
  const projects = useStore((s) => s.projects)
  const [connections, setConnections] = useState<DbConnection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [state, setState] = useState<{ ok: boolean; detail: string | null } | null>(null)
  const [tables, setTables] = useState<DbTable[]>([])
  const [table, setTable] = useState<string | null>(null)
  const [result, setResult] = useState<DbQueryResult | null>(null)
  const [sql, setSql] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<DbConnection> | null>(null)
  const [password, setPassword] = useState('')
  const [pendingDelete, setPendingDelete] = useState<DbConnection | null>(null)
  const [pendingQuery, setPendingQuery] = useState<string | null>(null)

  const active = connections.find((c) => c.id === activeId) ?? null

  useEffect(() => { void window.nyx.db.list().then(setConnections) }, [])

  const connect = useCallback(async (id: string) => {
    setActiveId(id)
    setBusy(true)
    setError(null)
    setTable(null)
    setResult(null)
    const s = await window.nyx.db.test(id)
    setState(s)
    if (s.ok) {
      try { setTables(await window.nyx.db.tables(id)) }
      catch (e) { setError(e instanceof Error ? e.message : 'Could not list tables') }
    } else {
      setTables([])
    }
    setBusy(false)
  }, [])

  const openTable = async (name: string) => {
    if (!activeId) return
    setTable(name)
    setBusy(true)
    setError(null)
    try { setResult(await window.nyx.db.browse(activeId, name, 100)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read the table') }
    setBusy(false)
  }

  const runQuery = async (statement: string) => {
    if (!activeId) return
    setBusy(true)
    setError(null)
    try {
      setResult(await window.nyx.db.query(activeId, statement))
      setTable(null)
      // A statement that changed something invalidates the table list.
      if (await window.nyx.db.isDestructive(statement)) {
        setTables(await window.nyx.db.tables(activeId))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed')
    }
    setBusy(false)
  }

  /** Destructive statements are never run straight from the editor. */
  const submitQuery = async () => {
    const statement = sql.trim()
    if (!statement || !activeId) return
    if (await window.nyx.db.isDestructive(statement)) setPendingQuery(statement)
    else await runQuery(statement)
  }

  if (!connections.length && !editing) {
    return (
      <NyxEmptyState
        icon={<DbIcon size={30} strokeWidth={1.4} />}
        title="No database connections"
        description="SQLite, PostgreSQL, MySQL and Redis, through each engine's own client. Passwords are stored in your OS keyring."
        actions={
          <NyxButton variant="filled" icon={<Plus size={14} />} onClick={() => setEditing(blank())}>
            New Connection
          </NyxButton>
        }
      />
    )
  }

  return (
    <div className="flex h-full min-w-0">
      <aside style={{ borderColor: nyx('outlineVariant') }} className="flex w-64 shrink-0 flex-col border-r">
        <div style={{ borderColor: nyx('outlineVariant') }} className="border-b p-2.5">
          <NyxButton className="w-full" size="sm" icon={<Plus size={13} />} onClick={() => setEditing(blank())}>
            New Connection
          </NyxButton>
        </div>

        <ul className="shrink-0 px-2 py-2">
          {connections.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <button
                onClick={() => void connect(c.id)}
                style={{ background: c.id === activeId ? nyx('selection') : 'transparent' }}
                className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left"
              >
                <div style={{ color: nyx('textPrimary') }} className="truncate text-xs">{c.name}</div>
                <div style={{ color: nyx('textMuted') }} className="truncate text-[10px]">
                  {c.driver}{c.driver === 'sqlite' ? '' : ` · ${c.host}:${c.port}`}
                </div>
              </button>
              <NyxIconButton
                label="Edit"
                className="opacity-0 group-hover:opacity-100"
                icon={<RefreshCw size={11} />}
                onClick={() => { setEditing(c); setPassword('') }}
              />
              <NyxIconButton
                label="Delete connection"
                className="opacity-0 group-hover:opacity-100"
                icon={<Trash2 size={11} />}
                onClick={() => setPendingDelete(c)}
              />
            </li>
          ))}
        </ul>

        {active ? (
          <>
            <div
              style={{ borderColor: nyx('outlineVariant') }}
              className="flex items-center gap-2 border-t px-3 py-2"
            >
              <NyxStatus tone={state?.ok ? 'success' : 'error'}>
                {state?.ok ? 'Connected' : 'Not connected'}
              </NyxStatus>
              <NyxIconButton
                label="Reconnect"
                className="ml-auto"
                icon={<RefreshCw size={12} className={busy ? 'animate-spin' : ''} />}
                onClick={() => void connect(active.id)}
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {tables.map((t) => (
                <li key={t.name}>
                  <button
                    onClick={() => void openTable(t.name)}
                    style={{ background: t.name === table ? nyx('selection') : 'transparent' }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left"
                  >
                    <Table2 size={11} style={{ color: nyx('textMuted') }} />
                    <span style={{ color: nyx('textSecondary') }} className="truncate font-mono text-[11px]">
                      {t.name}
                    </span>
                  </button>
                </li>
              ))}
              {state?.ok && !tables.length ? (
                <li style={{ color: nyx('textMuted') }} className="px-2 py-4 text-center text-[11px]">
                  No tables.
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <NyxEmptyState
            icon={<DbIcon size={26} strokeWidth={1.5} />}
            title="Select a connection"
            description="Connections are opened on demand — nothing connects at startup."
          />
        ) : (
          <>
            <div style={{ borderColor: nyx('outlineVariant') }} className="shrink-0 border-b p-3">
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void submitQuery() }
                }}
                rows={3}
                spellCheck={false}
                placeholder={active.driver === 'redis' ? 'KEYS *' : 'SELECT * FROM … ;   (Ctrl + Enter to run)'}
                style={{ background: nyx('codeBackground'), color: nyx('codeForeground'), borderColor: nyx('outlineVariant') }}
                className="w-full resize-y rounded-lg border p-2.5 font-mono text-xs outline-none
                           focus:border-[var(--nyx-primary)] placeholder:text-[var(--nyx-textMuted)]"
              />
              <div className="mt-2 flex items-center gap-2">
                <NyxButton size="sm" variant="filled" icon={<Play size={12} />} loading={busy}
                  disabled={!sql.trim()} onClick={() => void submitQuery()}>
                  Run
                </NyxButton>
                {result ? (
                  <span style={{ color: nyx('textMuted') }} className="text-[11px]">
                    {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
                    {table ? ` · ${table}` : ''}
                  </span>
                ) : null}
              </div>
            </div>

            {error ? (
              <div
                style={{ background: nyx('errorContainer'), color: nyx('error') }}
                className="flex shrink-0 items-start gap-2 px-4 py-2 font-mono text-[11px]"
              >
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{error}</span>
                <button onClick={() => setError(null)} aria-label="Dismiss"><X size={13} /></button>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto">
              {result ? <ResultTable result={result} /> : (
                <p style={{ color: nyx('textMuted') }} className="p-4 text-xs">
                  Pick a table, or run a statement.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <ConnectionDialog
        draft={editing}
        projects={projects}
        password={password}
        onPassword={setPassword}
        onClose={() => setEditing(null)}
        onSave={async (draft) => {
          const next = await window.nyx.db.save(draft, password || null)
          setConnections(next)
          setEditing(null)
          setPassword('')
          const saved = next.find((c) => c.name === draft.name)
          if (saved) void connect(saved.id)
        }}
      />

      <NyxPermissionDialog
        open={!!pendingDelete}
        danger
        title="Delete this connection?"
        confirmLabel="Delete"
        detail={`“${pendingDelete?.name}” is removed from Nyxium along with its stored password. The database itself is untouched.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const c = pendingDelete
          setPendingDelete(null)
          if (!c) return
          setConnections(await window.nyx.db.remove(c.id))
          if (activeId === c.id) { setActiveId(null); setTables([]); setResult(null) }
        }}
      />

      <NyxPermissionDialog
        open={!!pendingQuery}
        danger
        title="Run a statement that modifies data?"
        confirmLabel="Run it"
        detail={
          <>
            <p>This statement can change or destroy data in <strong style={{ color: nyx('textPrimary') }}>{active?.name}</strong>:</p>
            <pre
              style={{ background: nyx('codeBackground'), color: nyx('codeForeground'), borderColor: nyx('outlineVariant') }}
              className="mt-2 max-h-40 overflow-auto rounded-lg border p-2.5 font-mono text-[11px] whitespace-pre-wrap"
            >
              {pendingQuery}
            </pre>
            <p className="mt-2">Nyxium cannot undo it.</p>
          </>
        }
        onCancel={() => setPendingQuery(null)}
        onConfirm={() => {
          const q = pendingQuery
          setPendingQuery(null)
          if (q) void runQuery(q)
        }}
      />
    </div>
  )
}

function ResultTable({ result }: { result: DbQueryResult }) {
  if (!result.columns.length) {
    return <p style={{ color: nyx('textMuted') }} className="p-4 text-xs">Statement executed. No rows returned.</p>
  }
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          {result.columns.map((c, i) => (
            <th
              key={`${c}-${i}`}
              style={{ background: nyx('surface'), color: nyx('textSecondary'), borderColor: nyx('outlineVariant') }}
              className="sticky top-0 border-b px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td
                key={j}
                style={{ color: cell === null ? nyx('textMuted') : nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
                className="max-w-80 truncate border-b px-3 py-1 font-mono text-[11px]"
                title={cell ?? 'NULL'}
              >
                {cell === null ? 'NULL' : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ConnectionDialog({
  draft, projects, password, onPassword, onClose, onSave,
}: {
  draft: Partial<DbConnection> | null
  projects: Array<{ id: string; name: string }>
  password: string
  onPassword: (v: string) => void
  onClose: () => void
  onSave: (d: Partial<DbConnection>) => Promise<void>
}) {
  const [local, setLocal] = useState<Partial<DbConnection>>(draft ?? {})
  useEffect(() => { setLocal(draft ?? {}) }, [draft])
  if (!draft) return null

  const isSqlite = local.driver === 'sqlite'
  const set = (p: Partial<DbConnection>) => setLocal((l) => ({ ...l, ...p }))

  return (
    <NyxDialog
      open
      title={draft.id ? 'Edit connection' : 'New connection'}
      onClose={onClose}
      footer={
        <>
          <NyxButton variant="ghost" onClick={onClose}>Cancel</NyxButton>
          <NyxButton variant="filled" disabled={!local.name?.trim()} onClick={() => void onSave(local)}>
            Save
          </NyxButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <NyxTextField label="Name" value={local.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        <NyxDropdown<DbDriver>
          label="Driver"
          value={(local.driver ?? 'sqlite') as DbDriver}
          onChange={(driver) => set({ driver, port: driver === 'postgres' ? 5432 : driver === 'mysql' ? 3306 : driver === 'redis' ? 6379 : 0 })}
          options={DRIVERS}
        />
        {isSqlite ? (
          <NyxTextField
            label="Database file"
            value={local.database ?? ''}
            placeholder="/path/to/app.db"
            onChange={(e) => set({ database: e.target.value })}
          />
        ) : (
          <>
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <NyxTextField label="Host" value={local.host ?? ''} onChange={(e) => set({ host: e.target.value })} />
              <NyxTextField label="Port" type="number" value={local.port ?? 0}
                onChange={(e) => set({ port: Number(e.target.value) })} />
            </div>
            {local.driver !== 'redis' ? (
              <>
                <NyxTextField label="Database" value={local.database ?? ''} onChange={(e) => set({ database: e.target.value })} />
                <NyxTextField label="User" value={local.user ?? ''} onChange={(e) => set({ user: e.target.value })} />
              </>
            ) : null}
            <div className="flex flex-col gap-1">
              <label style={{ color: nyx('textSecondary') }} className="text-xs font-medium">Password</label>
              <input
                type="password"
                value={password}
                autoComplete="off"
                placeholder={local.hasPassword ? '•••••••• stored — leave blank to keep it' : 'Optional'}
                onChange={(e) => onPassword(e.target.value)}
                style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
                className="h-9 rounded-lg border px-2.5 text-sm outline-none focus:border-[var(--nyx-primary)]
                           placeholder:text-[var(--nyx-textMuted)]"
              />
              <span style={{ color: nyx('textMuted') }} className="text-[11px]">
                Stored in the OS keyring and passed to the client through the environment, never on the command line.
              </span>
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <label style={{ color: nyx('textSecondary') }} className="text-xs font-medium">Project</label>
          <select
            value={local.projectId ?? ''}
            onChange={(e) => set({ projectId: e.target.value || null })}
            style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
            className="h-9 rounded-lg border px-2 text-sm outline-none"
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
    </NyxDialog>
  )
}
