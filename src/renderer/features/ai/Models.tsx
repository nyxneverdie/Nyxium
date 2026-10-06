import { useCallback, useEffect, useState } from 'react'
import { Check, Download, RefreshCw, Trash2 } from 'lucide-react'
import type { AIBackend, AIConfig, AIModel } from '../../../shared/types'
import { nyx } from '../../palette/PaletteProvider'
import {
  NyxButton, NyxEmptyState, NyxIconButton, NyxPermissionDialog, NyxProgress, NyxStatus,
} from '../../components/nyx'

const formatSize = (bytes: number | null) =>
  bytes === null ? '—'
    : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB`
      : `${Math.max(1, Math.round(bytes / 1e6))} MB`

/** Models large enough to be a bad idea on the 8 GB machines Nyxium targets. */
const LARGE_MODEL_BYTES = 8e9

export function Models({
  config, backends, onSelect, onRefreshBackends,
}: {
  config: AIConfig
  backends: AIBackend[]
  onSelect: (model: string) => void
  onRefreshBackends: () => void
}) {
  const [models, setModels] = useState<AIModel[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pullName, setPullName] = useState('')
  const [pull, setPull] = useState<{ model: string; pct: number; status: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AIModel | null>(null)
  const [confirmLarge, setConfirmLarge] = useState<string | null>(null)

  const backend = backends.find((b) => b.id === config.provider)
  const supportsManagement = config.provider === 'ollama'

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setModels(await window.nyx.ai.models())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list models')
      setModels([])
    }
    setBusy(false)
  }, [])

  useEffect(() => { void load() }, [load, config.provider])

  useEffect(() => window.nyx.ai.onPullProgress((e) => setPull(e)), [])

  const startPull = async (name: string) => {
    setError(null)
    setPull({ model: name, pct: 0, status: 'starting' })
    try {
      await window.nyx.ai.pull(name)
      setPullName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pull failed')
    }
    setPull(null)
  }

  if (!backend?.available) {
    return (
      <NyxEmptyState
        icon={<Download size={28} strokeWidth={1.5} />}
        title="No local AI backend detected"
        description={backend?.detail ?? `Start a local inference server at ${config.endpoints[config.provider]}, or pick a different provider in Settings.`}
        actions={
          <NyxButton variant="filled" icon={<RefreshCw size={13} />} onClick={onRefreshBackends}>
            Check again
          </NyxButton>
        }
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <header className="mb-3 flex items-center gap-3">
        <h2 style={{ color: nyx('textPrimary') }} className="text-sm font-semibold">Local models</h2>
        <NyxStatus tone="success">{backend.label} · {backend.endpoint}</NyxStatus>
        <NyxIconButton
          label="Refresh models"
          icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />}
          onClick={() => void load()}
        />
      </header>

      {error ? (
        <div
          style={{ background: nyx('errorContainer'), color: nyx('error') }}
          className="mb-3 rounded-lg px-3 py-2 text-xs"
        >
          {error}
        </div>
      ) : null}

      {supportsManagement ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const name = pullName.trim()
            if (!name || pull) return
            // Nothing is downloaded without an explicit action, and big models warn first.
            if (/\b(70b|65b|34b|32b)\b/i.test(name) && config.resourceMode === 'low-ram') {
              setConfirmLarge(name)
            } else void startPull(name)
          }}
          className="mb-4 flex gap-2"
        >
          <input
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            placeholder="Pull a model, e.g. qwen2.5-coder:7b"
            style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
            className="h-8 min-w-0 flex-1 rounded-lg border px-2.5 font-mono text-xs outline-none
                       focus:border-[var(--nyx-primary)] placeholder:text-[var(--nyx-textMuted)]"
          />
          <NyxButton size="sm" type="submit" icon={<Download size={12} />} disabled={!pullName.trim() || !!pull}>
            Pull
          </NyxButton>
        </form>
      ) : null}

      {pull ? (
        <div className="mb-4">
          <NyxProgress value={pull.pct} label={`${pull.model} · ${pull.status}`} />
        </div>
      ) : null}

      {models === null ? (
        <p style={{ color: nyx('textMuted') }} className="text-xs">Listing models…</p>
      ) : models.length === 0 ? (
        <NyxEmptyState
          icon={<Download size={26} strokeWidth={1.5} />}
          title="No models installed"
          description={supportsManagement
            ? 'Pull a model above. Nyxium never downloads one on its own.'
            : `${backend.label} reports no models. Start the server with a model loaded.`}
        />
      ) : (
        <ul className="flex flex-col gap-1">
          <li
            style={{ color: nyx('textMuted'), borderColor: nyx('outlineVariant') }}
            className="grid grid-cols-[1fr_6rem_5rem_5rem_auto] gap-3 border-b px-2 pb-1.5 text-[10px]
                       font-semibold tracking-wider uppercase"
          >
            <span>Model</span><span>Size</span><span>Context</span><span>Status</span><span />
          </li>
          {models.map((m) => {
            const selected = m.name === config.model
            const heavy = (m.size ?? 0) > LARGE_MODEL_BYTES && config.resourceMode === 'low-ram'
            return (
              <li
                key={m.name}
                style={{ background: selected ? nyx('selection') : 'transparent' }}
                className="grid grid-cols-[1fr_6rem_5rem_5rem_auto] items-center gap-3 rounded-lg px-2 py-1.5"
              >
                <button onClick={() => onSelect(m.name)} className="flex min-w-0 items-center gap-2 text-left">
                  {selected
                    ? <Check size={12} style={{ color: nyx('primary') }} />
                    : <span className="w-3" />}
                  <span style={{ color: nyx('textPrimary') }} className="truncate font-mono text-xs">{m.name}</span>
                  {m.family ? (
                    <span style={{ color: nyx('textMuted') }} className="shrink-0 text-[10px]">{m.family}</span>
                  ) : null}
                </button>
                <span style={{ color: heavy ? nyx('warning') : nyx('textSecondary') }} className="font-mono text-[11px]">
                  {formatSize(m.size)}
                </span>
                <span style={{ color: nyx('textSecondary') }} className="font-mono text-[11px]">
                  {m.context ? `${Math.round(m.context / 1024)}K` : '—'}
                </span>
                <NyxStatus tone={m.loaded ? 'success' : 'idle'}>{m.loaded ? 'Loaded' : 'On disk'}</NyxStatus>
                {supportsManagement ? (
                  <NyxIconButton label={`Delete ${m.name}`} icon={<Trash2 size={13} />} onClick={() => setPendingDelete(m)} />
                ) : <span />}
              </li>
            )
          })}
        </ul>
      )}

      {config.resourceMode === 'low-ram' ? (
        <p style={{ color: nyx('textMuted') }} className="mt-4 text-[11px]">
          Low-RAM mode is on: context is capped at 4K, one request runs at a time, and large models are flagged.
        </p>
      ) : null}

      <NyxPermissionDialog
        open={!!pendingDelete}
        danger
        title="Delete model?"
        confirmLabel="Delete"
        detail={`${pendingDelete?.name} (${formatSize(pendingDelete?.size ?? null)}) will be removed from ${backend.label}. You would have to download it again to use it.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const m = pendingDelete
          setPendingDelete(null)
          if (!m) return
          try {
            await window.nyx.ai.removeModel(m.name)
            await load()
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Delete failed')
          }
        }}
      />

      <NyxPermissionDialog
        open={!!confirmLarge}
        title="Download a large model?"
        confirmLabel="Download anyway"
        detail={`“${confirmLarge}” looks like a large model and Low-RAM mode is on. It may not fit in memory on this machine.`}
        onCancel={() => setConfirmLarge(null)}
        onConfirm={() => {
          const n = confirmLarge
          setConfirmLarge(null)
          if (n) void startPull(n)
        }}
      />
    </div>
  )
}
