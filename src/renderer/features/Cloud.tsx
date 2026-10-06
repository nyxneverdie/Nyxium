import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight, Cloud as CloudIcon, Download, Folder, FolderPlus, HardDriveDownload,
  Link2, RefreshCw, Trash2, Upload, X,
} from 'lucide-react'
import type {
  BackupPreview, CloudBucket, CloudConfig, CloudObject, CloudStatus, TransferProgress,
} from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxCard, NyxCardHeader, NyxEmptyState, NyxIconButton, NyxPermissionDialog,
  NyxProgress, NyxSearch, NyxStatus, NyxTextField,
} from '../components/nyx'

const fmtSize = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB`
    : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB`
      : b >= 1e3 ? `${Math.round(b / 1e3)} KB`
        : `${b} B`

export function Cloud({ projectId }: { projectId: string | null }) {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const project = projects.find((p) => p.id === (projectId ?? activeProjectId)) ?? null

  const [cfg, setCfg] = useState<CloudConfig | null>(null)
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [buckets, setBuckets] = useState<CloudBucket[]>([])
  const [prefix, setPrefix] = useState('')
  const [prefixes, setPrefixes] = useState<string[]>([])
  const [objects, setObjects] = useState<CloudObject[]>([])
  const [nextPage, setNextPage] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<TransferProgress[]>([])
  const [pendingDelete, setPendingDelete] = useState<CloudObject | null>(null)
  const [pendingRestore, setPendingRestore] = useState<CloudObject | null>(null)
  const [dragging, setDragging] = useState(false)

  const refreshStatus = useCallback(async () => {
    const [c, s] = await Promise.all([window.nyx.cloud.config(), window.nyx.cloud.status()])
    setCfg(c)
    setStatus(s)
    if (s.connected) {
      try { setBuckets(await window.nyx.cloud.buckets()) } catch { setBuckets([]) }
    }
  }, [])

  useEffect(() => { void refreshStatus() }, [refreshStatus])

  useEffect(() => window.nyx.cloud.onProgress((p) => {
    setTransfers((prev) => {
      const next = prev.filter((t) => t.id !== p.id)
      return p.status === 'running' ? [...next, p] : next
    })
    if (p.status === 'error' && p.error) setError(p.error)
    if (p.status === 'done') void load(prefix)
  }), [prefix]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (p: string, token?: string) => {
    if (!cfg?.bucket) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.nyx.cloud.list(p, token)
      setPrefixes(r.prefixes)
      setObjects((prev) => (token ? [...prev, ...r.objects] : r.objects))
      setNextPage(r.nextPageToken)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list the bucket')
    }
    setBusy(false)
  }, [cfg?.bucket])

  useEffect(() => { if (status?.connected && cfg?.bucket) void load(prefix) }, [status?.connected, cfg?.bucket, prefix, load])

  // Server-side search is debounced; an empty query returns to browsing.
  useEffect(() => {
    if (!query.trim()) { setSearching(false); return }
    let live = true
    setSearching(true)
    const t = setTimeout(() => {
      void window.nyx.cloud.search(prefix, query.trim())
        .then((r) => { if (live) { setObjects(r); setPrefixes([]); setNextPage(null) } })
        .catch((e: Error) => { if (live) setError(e.message) })
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [query, prefix])

  const patch = async (p: Partial<CloudConfig>) => {
    setCfg(await window.nyx.cloud.patchConfig(p))
    await refreshStatus()
  }

  const crumbs = useMemo(() => {
    const parts = prefix.split('/').filter(Boolean)
    return parts.map((part, i) => ({ label: part, path: `${parts.slice(0, i + 1).join('/')}/` }))
  }, [prefix])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.nyx.filePath(f)).filter(Boolean) as string[]
    for (const p of paths) {
      try {
        await window.nyx.cloud.upload(p, `${prefix}${p.split('/').pop()}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    }
  }

  if (!cfg || !status) {
    return <div style={{ color: nyx('textMuted') }} className="flex h-full items-center justify-center text-xs">Loading…</div>
  }

  if (!status.connected) {
    return (
      <div className="h-full overflow-y-auto p-5">
        <ConnectPanel status={status} cfg={cfg} onPatch={patch} onRefresh={refreshStatus} />
      </div>
    )
  }

  return (
    <div
      className="flex h-full min-w-0 flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <header
        style={{ borderColor: nyx('outlineVariant') }}
        className="flex h-11 shrink-0 items-center gap-3 border-b px-4"
      >
        <CloudIcon size={15} style={{ color: nyx('textMuted') }} />
        <NyxStatus tone="success">Connected</NyxStatus>
        <span style={{ color: nyx('textSecondary') }} className="truncate font-mono text-[11px]">
          {status.project}
        </span>
        <select
          value={cfg.bucket}
          onChange={(e) => void patch({ bucket: e.target.value })}
          aria-label="Bucket"
          style={{ background: nyx('surfaceVariant'), color: nyx('textSecondary'), borderColor: nyx('outlineVariant') }}
          className="h-7 max-w-56 rounded-lg border px-1.5 text-[11px] outline-none"
        >
          <option value="">Choose a bucket…</option>
          {buckets.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          <NyxButton
            size="sm" variant="ghost" icon={<Upload size={12} />}
            disabled={!cfg.bucket}
            onClick={() => void window.nyx.cloud.uploadDialog(prefix)}
          >
            Upload
          </NyxButton>
          <NyxButton
            size="sm" variant="ghost" icon={<FolderPlus size={12} />}
            disabled={!cfg.bucket}
            onClick={() => {
              const name = window.prompt('New folder name')
              if (name?.trim()) void window.nyx.cloud.createFolder(`${prefix}${name.trim()}/`).then(() => load(prefix))
            }}
          >
            Folder
          </NyxButton>
          <NyxIconButton
            label="Refresh"
            icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />}
            onClick={() => void load(prefix)}
          />
        </div>
      </header>

      {!cfg.bucket ? (
        <NyxEmptyState
          icon={<CloudIcon size={28} strokeWidth={1.5} />}
          title="Choose a bucket"
          description={`${buckets.length} bucket(s) available in ${status.project}.`}
        />
      ) : (
        <>
          <div
            style={{ borderColor: nyx('outlineVariant') }}
            className="flex h-10 shrink-0 items-center gap-2 border-b px-4"
          >
            <button
              onClick={() => { setPrefix(''); setQuery('') }}
              style={{ color: prefix ? nyx('textSecondary') : nyx('textPrimary') }}
              className="font-mono text-[11px]"
            >
              gs://{cfg.bucket}
            </button>
            {crumbs.map((c) => (
              <span key={c.path} className="flex items-center gap-2">
                <ChevronRight size={11} style={{ color: nyx('textMuted') }} />
                <button
                  onClick={() => { setPrefix(c.path); setQuery('') }}
                  style={{ color: c.path === prefix ? nyx('textPrimary') : nyx('textSecondary') }}
                  className="font-mono text-[11px]"
                >
                  {c.label}
                </button>
              </span>
            ))}
            <div className="ml-auto w-64">
              <NyxSearch value={query} onValueChange={setQuery} placeholder="Search cloud files…" />
            </div>
          </div>

          {error ? (
            <div
              style={{ background: nyx('errorContainer'), color: nyx('error') }}
              className="flex shrink-0 items-start gap-2 px-4 py-2 text-xs"
            >
              <span className="min-w-0 flex-1">{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss"><X size={13} /></button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {searching ? (
              <p style={{ color: nyx('textMuted') }} className="px-2 py-1 text-[11px]">
                Searching under {prefix || 'the bucket root'}…
              </p>
            ) : null}

            <ul>
              {prefixes.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => setPrefix(p)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:brightness-125"
                  >
                    <Folder size={14} style={{ color: nyx('primary') }} />
                    <span style={{ color: nyx('textPrimary') }} className="truncate font-mono text-xs">
                      {p.slice(prefix.length).replace(/\/$/, '')}
                    </span>
                  </button>
                </li>
              ))}

              {objects.map((o) => (
                <li key={o.name} className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5">
                  <span style={{ color: nyx('textPrimary') }} className="min-w-0 flex-1 truncate font-mono text-xs">
                    {o.name.slice(prefix.length) || o.name}
                  </span>
                  <span style={{ color: nyx('textMuted') }} className="w-20 shrink-0 text-right font-mono text-[11px]">
                    {fmtSize(o.size)}
                  </span>
                  <span style={{ color: nyx('textMuted') }} className="w-24 shrink-0 text-right text-[11px]">
                    {o.updated ? new Date(o.updated).toLocaleDateString() : '—'}
                  </span>
                  <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                    <NyxIconButton
                      label="Copy gs:// path"
                      icon={<Link2 size={13} />}
                      onClick={() => void window.nyx.snippets.copy(`gs://${cfg.bucket}/${o.name}`)}
                    />
                    {/\.(tar\.zst|tar\.gz|tgz)$/.test(o.name) ? (
                      <NyxIconButton
                        label="Restore this archive"
                        icon={<HardDriveDownload size={13} />}
                        onClick={() => setPendingRestore(o)}
                      />
                    ) : null}
                    <NyxIconButton
                      label="Download"
                      icon={<Download size={13} />}
                      onClick={() => void window.nyx.cloud.download(o.name)}
                    />
                    <NyxIconButton label="Delete" icon={<Trash2 size={13} />} onClick={() => setPendingDelete(o)} />
                  </span>
                </li>
              ))}
            </ul>

            {!prefixes.length && !objects.length && !busy ? (
              <NyxEmptyState
                icon={<CloudIcon size={26} strokeWidth={1.5} />}
                title={query ? 'No match' : 'Nothing here'}
                description={query ? `No object under ${prefix || 'the bucket'} matches “${query}”.` : 'Drag files in, or use Upload.'}
              />
            ) : null}

            {nextPage ? (
              <div className="p-2">
                <NyxButton size="sm" variant="ghost" onClick={() => void load(prefix, nextPage)}>Load more</NyxButton>
              </div>
            ) : null}
          </div>
        </>
      )}

      {project ? <ProjectBackup project={project} cfg={cfg} onPatch={patch} onError={setError} /> : null}

      {transfers.length ? (
        <div style={{ borderColor: nyx('outlineVariant') }} className="shrink-0 border-t px-4 py-2.5">
          {transfers.map((t) => (
            <div key={t.id} className="mb-1.5 flex items-center gap-3 last:mb-0">
              <div className="min-w-0 flex-1">
                <NyxProgress
                  value={t.total ? (t.sent / t.total) * 100 : 0}
                  label={`${t.label} · ${fmtSize(t.sent)}${t.total ? ` / ${fmtSize(t.total)}` : ''}`}
                />
              </div>
              <NyxButton size="sm" variant="ghost" onClick={() => window.nyx.cloud.cancel(t.id)}>Cancel</NyxButton>
            </div>
          ))}
        </div>
      ) : null}

      {dragging ? (
        <div
          style={{ background: 'rgb(0 0 0 / 0.4)', borderColor: nyx('primary') }}
          className="pointer-events-none absolute inset-0 z-40 m-4 flex items-center justify-center rounded-2xl border-2 border-dashed"
        >
          <span style={{ color: nyx('primary') }} className="text-sm font-medium">
            Drop to upload into {prefix || 'the bucket root'}
          </span>
        </div>
      ) : null}

      <NyxPermissionDialog
        open={!!pendingDelete}
        danger
        title="Delete this object?"
        confirmLabel="Delete"
        detail={
          <>
            <p><code style={{ color: nyx('textPrimary') }}>gs://{cfg.bucket}/{pendingDelete?.name}</code></p>
            <p className="mt-2">Deleting from Google Cloud Storage cannot be undone from Nyxium.</p>
          </>
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const o = pendingDelete
          setPendingDelete(null)
          if (!o) return
          try { await window.nyx.cloud.remove(o.name); await load(prefix) }
          catch (e) { setError(e instanceof Error ? e.message : 'Delete failed') }
        }}
      />

      <NyxPermissionDialog
        open={!!pendingRestore}
        title="Restore this backup?"
        confirmLabel="Choose destination"
        detail={
          <>
            <p>
              <code style={{ color: nyx('textPrimary') }}>{pendingRestore?.name}</code> will be downloaded
              and extracted into a directory you pick next.
            </p>
            <p className="mt-2">
              Files already in that directory with the same names will be overwritten. Pick an empty
              directory to be safe.
            </p>
          </>
        }
        onCancel={() => setPendingRestore(null)}
        onConfirm={async () => {
          const o = pendingRestore
          setPendingRestore(null)
          if (!o) return
          try { await window.nyx.cloud.restore(o.name) }
          catch (e) { setError(e instanceof Error ? e.message : 'Restore failed') }
        }}
      />
    </div>
  )
}

function ConnectPanel({
  status, cfg, onPatch, onRefresh,
}: {
  status: CloudStatus
  cfg: CloudConfig
  onPatch: (p: Partial<CloudConfig>) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const [sa, setSa] = useState('')
  const [busy, setBusy] = useState(false)
  const [saError, setSaError] = useState<string | null>(null)

  return (
    <div className="mx-auto max-w-2xl">
      <NyxCard>
        <NyxCardHeader title="Google Cloud" />
        <div className="p-4">
          <div className="mb-4 flex items-center gap-2">
            <NyxStatus tone="idle">Not connected</NyxStatus>
            <span style={{ color: nyx('textMuted') }} className="text-xs">
              credential: {status.credential}
            </span>
          </div>

          {status.detail ? (
            <p style={{ color: nyx('textSecondary') }} className="mb-4 text-xs leading-relaxed">{status.detail}</p>
          ) : null}

          <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <NyxTextField
              label="Google Cloud project ID"
              value={cfg.project}
              placeholder="my-gcp-project"
              onChange={(e) => void onPatch({ project: e.target.value })}
            />
            <NyxTextField
              label="Bucket"
              value={cfg.bucket}
              placeholder="nyxium-projects"
              onChange={(e) => void onPatch({ bucket: e.target.value })}
            />
          </div>

          <div style={{ borderColor: nyx('outlineVariant') }} className="border-t pt-4">
            <div style={{ color: nyx('textPrimary') }} className="mb-1 text-sm">Authentication</div>
            <p style={{ color: nyx('textMuted') }} className="mb-3 text-xs leading-relaxed">
              Preferred: run <code>gcloud auth application-default login</code> in a terminal. Nyxium picks
              those credentials up automatically and stores nothing.
            </p>
            <p style={{ color: nyx('textMuted') }} className="mb-2 text-xs">
              Otherwise paste a service-account JSON key. It is stored in your OS keyring, never in the
              config file, and never reaches the renderer.
            </p>
            <textarea
              value={sa}
              onChange={(e) => setSa(e.target.value)}
              rows={4}
              placeholder='{ "type": "service_account", … }'
              spellCheck={false}
              style={{ background: nyx('codeBackground'), color: nyx('codeForeground'), borderColor: nyx('outlineVariant') }}
              className="w-full resize-y rounded-lg border p-2.5 font-mono text-[11px] outline-none
                         focus:border-[var(--nyx-primary)] placeholder:text-[var(--nyx-textMuted)]"
            />
            {saError ? (
              <p style={{ color: nyx('error') }} className="mt-1.5 text-xs">{saError}</p>
            ) : null}
            <div className="mt-2.5 flex gap-2">
              <NyxButton
                size="sm" variant="filled" loading={busy} disabled={!sa.trim()}
                onClick={async () => {
                  setBusy(true)
                  setSaError(null)
                  try {
                    await window.nyx.cloud.setServiceAccount(sa.trim())
                    setSa('')
                    await onRefresh()
                  } catch (e) {
                    setSaError(e instanceof Error ? e.message : 'Could not store the key')
                  }
                  setBusy(false)
                }}
              >
                Save key
              </NyxButton>
              <NyxButton size="sm" icon={<RefreshCw size={12} />} onClick={() => void onRefresh()}>
                Check connection
              </NyxButton>
            </div>
          </div>
        </div>
      </NyxCard>
    </div>
  )
}

/** Backup configuration and controls for the project in the surrounding tab. */
function ProjectBackup({
  project, cfg, onPatch, onError,
}: {
  project: { id: string; name: string; path: string }
  cfg: CloudConfig
  onPatch: (p: Partial<CloudConfig>) => Promise<void>
  onError: (e: string) => void
}) {
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const enabled = !!cfg.backupEnabled[project.id]
  const last = cfg.lastBackupAt[project.id]
  const prefix = cfg.prefixes[project.id] || `projects/${project.name}/`

  const loadPreview = async () => {
    try { setPreview(await window.nyx.cloud.previewBackup(project.id)) }
    catch (e) { onError(e instanceof Error ? e.message : 'Could not scan the project') }
  }

  useEffect(() => { if (open) void loadPreview() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ borderColor: nyx('outlineVariant') }} className="shrink-0 border-t px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span style={{ color: nyx('textSecondary') }} className="text-[11px] font-semibold tracking-wider uppercase">
          Backup
        </span>
        <span style={{ color: nyx('textPrimary') }} className="truncate text-xs">{project.name}</span>
        <span style={{ color: nyx('textMuted') }} className="truncate font-mono text-[11px]">
          gs://{cfg.bucket}/{prefix}backups/
        </span>
        <span style={{ color: nyx('textMuted') }} className="text-[11px]">
          {last ? `last ${new Date(last).toLocaleString()}` : 'never backed up'}
        </span>
        <div className="ml-auto flex gap-1.5">
          <NyxButton size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Configure'}
          </NyxButton>
          <NyxButton
            size="sm" variant="filled" icon={<Upload size={12} />}
            disabled={!cfg.bucket}
            onClick={() => { void loadPreview(); setConfirming(true) }}
          >
            Backup Now
          </NyxButton>
        </div>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <input
              id={`backup-${project.id}`}
              type="checkbox"
              checked={enabled}
              onChange={(e) => void onPatch({ backupEnabled: { ...cfg.backupEnabled, [project.id]: e.target.checked } })}
            />
            <label htmlFor={`backup-${project.id}`} style={{ color: nyx('textSecondary') }} className="text-xs">
              Cloud backup enabled for this project
            </label>
          </div>
          <NyxTextField
            label="Bucket prefix"
            value={prefix}
            onChange={(e) => void onPatch({ prefixes: { ...cfg.prefixes, [project.id]: e.target.value } })}
          />
          {preview ? (
            <p style={{ color: nyx('textMuted') }} className="text-[11px]">
              {preview.fileCount} files · {fmtSize(preview.totalBytes)} after exclusions
              {preview.excludedSecrets.length
                ? ` · ${preview.excludedSecrets.length} credential file(s) held back`
                : ''}
              {preview.truncated ? ' · file list truncated' : ''}
              {' — edit .nyxiumignore in the project to change what is included.'}
            </p>
          ) : null}
        </div>
      ) : null}

      <NyxPermissionDialog
        open={confirming}
        title="Back up this project to Google Cloud?"
        confirmLabel="Back up"
        detail={
          <>
            <p>
              <strong style={{ color: nyx('textPrimary') }}>{project.name}</strong> will be archived and
              uploaded to <code>gs://{cfg.bucket}/{prefix}backups/</code>.
            </p>
            {preview ? (
              <p className="mt-2">
                {preview.fileCount} files, {fmtSize(preview.totalBytes)}.
              </p>
            ) : null}
            {preview?.excludedSecrets.length ? (
              <p className="mt-2" style={{ color: nyx('success') }}>
                {preview.excludedSecrets.length} credential file(s) are excluded and will not be uploaded:{' '}
                {preview.excludedSecrets.slice(0, 5).join(', ')}
                {preview.excludedSecrets.length > 5 ? ', …' : ''}
              </p>
            ) : null}
          </>
        }
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false)
          try { await window.nyx.cloud.backup(project.id) }
          catch (e) { onError(e instanceof Error ? e.message : 'Backup failed') }
        }}
      />
    </div>
  )
}
