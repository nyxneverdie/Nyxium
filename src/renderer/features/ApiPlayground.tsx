import { useEffect, useState } from 'react'
import { History, Plus, Save, Send, Trash2, Webhook, X } from 'lucide-react'
import type {
  ApiHistoryEntry, ApiRequest, ApiResponse, HttpMethod,
} from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxEmptyState, NyxIconButton, NyxStatus,
} from '../components/nyx'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
type Pair = { key: string; value: string }
type BodyTab = 'params' | 'headers' | 'body'

const blank = (projectId: string | null): Partial<ApiRequest> => ({
  name: '', method: 'GET', url: '', headers: [], params: [], body: '', projectId,
})

const statusTone = (s: number) =>
  s >= 500 ? 'error' : s >= 400 ? 'warning' : s >= 200 && s < 300 ? 'success' : 'info'

export function ApiPlayground({ projectId }: { projectId: string | null }) {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const effectiveProjectId = projectId ?? activeProjectId ?? null

  const [draft, setDraft] = useState<Partial<ApiRequest>>(blank(effectiveProjectId))
  const [saved, setSaved] = useState<ApiRequest[]>([])
  const [history, setHistory] = useState<ApiHistoryEntry[]>([])
  const [pane, setPane] = useState<'saved' | 'history'>('saved')
  const [tab, setTab] = useState<BodyTab>('params')
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.nyx.api.saved().then(setSaved)
    void window.nyx.api.history().then(setHistory)
  }, [])

  const send = async () => {
    if (!draft.url?.trim()) return
    setSending(true)
    setError(null)
    setResponse(null)
    try {
      setResponse(await window.nyx.api.send({
        method: draft.method ?? 'GET',
        url: draft.url.trim(),
        headers: draft.headers ?? [],
        params: draft.params ?? [],
        body: draft.body ?? '',
      }))
      setHistory(await window.nyx.api.history())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    }
    setSending(false)
  }

  const save = async () => {
    if (!draft.url?.trim()) return
    setSaved(await window.nyx.api.save({
      ...draft,
      name: draft.name?.trim() || `${draft.method} ${draft.url}`.slice(0, 60),
    }))
  }

  const pairs = (which: 'headers' | 'params') => (draft[which] ?? []) as Pair[]
  const setPairs = (which: 'headers' | 'params', next: Pair[]) =>
    setDraft((d) => ({ ...d, [which]: next }))

  return (
    <div className="flex h-full min-w-0">
      <aside style={{ borderColor: nyx('outlineVariant') }} className="flex w-64 shrink-0 flex-col border-r">
        <div className="flex shrink-0 gap-1 p-2">
          {(['saved', 'history'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPane(p)}
              style={{
                background: pane === p ? nyx('primaryContainer') : 'transparent',
                color: pane === p ? nyx('onPrimaryContainer') : nyx('textMuted'),
              }}
              className="h-7 flex-1 rounded-lg text-[11px] capitalize"
            >
              {p}
            </button>
          ))}
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {pane === 'saved' ? saved.map((r) => (
            <li key={r.id} className="group flex items-center gap-1">
              <button
                onClick={() => { setDraft(r); setResponse(null); setError(null) }}
                className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left hover:brightness-125"
              >
                <div style={{ color: nyx('textPrimary') }} className="truncate text-xs">{r.name}</div>
                <div style={{ color: nyx('textMuted') }} className="truncate font-mono text-[10px]">
                  {r.method} {r.url}
                </div>
              </button>
              <NyxIconButton
                label="Delete saved request"
                className="opacity-0 group-hover:opacity-100"
                icon={<Trash2 size={11} />}
                onClick={async () => setSaved(await window.nyx.api.remove(r.id))}
              />
            </li>
          )) : history.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => { setDraft({ ...blank(effectiveProjectId), method: h.method, url: h.url }); setResponse(null) }}
                className="w-full rounded-lg px-2.5 py-1.5 text-left hover:brightness-125"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    style={{ color: nyx(statusTone(h.status) === 'success' ? 'success' : statusTone(h.status) === 'error' ? 'error' : 'warning') }}
                    className="font-mono text-[10px]"
                  >
                    {h.status}
                  </span>
                  <span style={{ color: nyx('textPrimary') }} className="truncate font-mono text-[10px]">
                    {h.method}
                  </span>
                  <span style={{ color: nyx('textMuted') }} className="ml-auto shrink-0 text-[10px]">
                    {h.durationMs}ms
                  </span>
                </div>
                <div style={{ color: nyx('textMuted') }} className="truncate font-mono text-[10px]">{h.url}</div>
              </button>
            </li>
          ))}
          {pane === 'saved' && !saved.length ? (
            <li style={{ color: nyx('textMuted') }} className="px-2 py-6 text-center text-[11px]">
              No saved requests.
            </li>
          ) : null}
          {pane === 'history' && !history.length ? (
            <li style={{ color: nyx('textMuted') }} className="px-2 py-6 text-center text-[11px]">
              No requests yet.
            </li>
          ) : null}
        </ul>

        <div style={{ borderColor: nyx('outlineVariant') }} className="flex gap-1.5 border-t p-2.5">
          <NyxButton
            className="flex-1" size="sm" icon={<Plus size={13} />}
            onClick={() => { setDraft(blank(effectiveProjectId)); setResponse(null); setError(null) }}
          >
            New
          </NyxButton>
          {pane === 'history' && history.length ? (
            <NyxButton size="sm" variant="ghost" icon={<History size={12} />}
              onClick={async () => setHistory(await window.nyx.api.clearHistory())}>
              Clear
            </NyxButton>
          ) : null}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div style={{ borderColor: nyx('outlineVariant') }} className="shrink-0 border-b p-3">
          <div className="flex gap-2">
            <select
              value={draft.method ?? 'GET'}
              onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value as HttpMethod }))}
              aria-label="Method"
              style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
              className="h-9 w-24 shrink-0 rounded-lg border px-2 font-mono text-xs outline-none"
            >
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              value={draft.url ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
              placeholder="https://api.example.com/v1/users  — or http://localhost:3000"
              style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
              className="h-9 min-w-0 flex-1 rounded-lg border px-2.5 font-mono text-xs outline-none
                         focus:border-[var(--nyx-primary)] placeholder:text-[var(--nyx-textMuted)]"
            />
            <NyxButton size="md" variant="filled" icon={<Send size={13} />} loading={sending}
              disabled={!draft.url?.trim()} onClick={() => void send()}>
              Send
            </NyxButton>
            <NyxIconButton label="Save request" icon={<Save size={15} />} onClick={() => void save()} />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              value={draft.name ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Request name (for saving)"
              style={{ color: nyx('textSecondary') }}
              className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--nyx-textMuted)]"
            />
            <select
              value={draft.projectId ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value || null }))}
              aria-label="Project"
              style={{ background: nyx('surfaceVariant'), color: nyx('textSecondary'), borderColor: nyx('outlineVariant') }}
              className="h-6 max-w-40 rounded-md border px-1.5 text-[11px] outline-none"
            >
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ borderColor: nyx('outlineVariant') }} className="flex shrink-0 gap-1 border-b px-3 py-1.5">
          {(['params', 'headers', 'body'] as BodyTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? nyx('primaryContainer') : 'transparent',
                color: tab === t ? nyx('onPrimaryContainer') : nyx('textMuted'),
              }}
              className="h-6 rounded-md px-2.5 text-[11px] capitalize"
            >
              {t}
              {t !== 'body' && pairs(t).length ? ` (${pairs(t).length})` : ''}
            </button>
          ))}
        </div>

        <div className="max-h-56 shrink-0 overflow-y-auto p-3">
          {tab === 'body' ? (
            <textarea
              value={draft.body ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              rows={6}
              spellCheck={false}
              placeholder={draft.method === 'GET' ? 'GET requests are sent without a body.' : '{\n  "key": "value"\n}'}
              disabled={draft.method === 'GET'}
              style={{ background: nyx('codeBackground'), color: nyx('codeForeground'), borderColor: nyx('outlineVariant') }}
              className="w-full resize-y rounded-lg border p-2.5 font-mono text-xs outline-none
                         focus:border-[var(--nyx-primary)] disabled:opacity-50
                         placeholder:text-[var(--nyx-textMuted)]"
            />
          ) : (
            <PairEditor pairs={pairs(tab)} onChange={(next) => setPairs(tab, next)} />
          )}
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

        <div style={{ borderColor: nyx('outlineVariant') }} className="flex min-h-0 flex-1 flex-col border-t">
          {response ? (
            <>
              <div className="flex h-9 shrink-0 items-center gap-3 px-4">
                <NyxStatus tone={statusTone(response.status)}>
                  {response.status} {response.statusText}
                </NyxStatus>
                <span style={{ color: nyx('textMuted') }} className="font-mono text-[11px]">
                  {response.durationMs}ms · {response.size >= 1024 ? `${(response.size / 1024).toFixed(1)} KB` : `${response.size} B`}
                </span>
                <span style={{ color: nyx('textMuted') }} className="truncate font-mono text-[11px]">
                  {response.headers['content-type'] ?? ''}
                </span>
              </div>
              <pre
                style={{ background: nyx('codeBackground'), color: nyx('codeForeground') }}
                className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] whitespace-pre-wrap"
              >
                {response.body || '(empty response body)'}
              </pre>
            </>
          ) : (
            <NyxEmptyState
              icon={<Webhook size={26} strokeWidth={1.5} />}
              title="No response yet"
              description="Requests run from the main process, so local endpoints and CORS-restricted APIs both work."
            />
          )}
        </div>
      </section>
    </div>
  )
}

function PairEditor({ pairs, onChange }: { pairs: Pair[]; onChange: (p: Pair[]) => void }) {
  const update = (i: number, patch: Partial<Pair>) =>
    onChange(pairs.map((p, j) => (i === j ? { ...p, ...patch } : p)))

  return (
    <div className="flex flex-col gap-1.5">
      {pairs.map((p, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={p.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder="name"
            style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
            className="h-7 w-48 rounded-lg border px-2 font-mono text-[11px] outline-none focus:border-[var(--nyx-primary)]"
          />
          <input
            value={p.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value"
            style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
            className="h-7 min-w-0 flex-1 rounded-lg border px-2 font-mono text-[11px] outline-none focus:border-[var(--nyx-primary)]"
          />
          <NyxIconButton
            label="Remove"
            icon={<X size={12} />}
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <NyxButton
        size="sm" variant="ghost" icon={<Plus size={12} />}
        onClick={() => onChange([...pairs, { key: '', value: '' }])}
      >
        Add
      </NyxButton>
    </div>
  )
}
