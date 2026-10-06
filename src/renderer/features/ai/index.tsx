import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot, Check, FileCode, MessageSquare, Plus, Search, Send, Settings2, Square, Trash2, Wrench, X,
} from 'lucide-react'
import type {
  AIBackend, AIConfig, AIMessage, AIMode, AIResourceMode, AISession, AIToolCall,
} from '../../../shared/types'
import { nyx } from '../../palette/PaletteProvider'
import { useStore } from '../../state/store'
import {
  NyxButton, NyxDropdown, NyxEmptyState, NyxIconButton, NyxPermissionDialog, NyxSearch, NyxStatus,
} from '../../components/nyx'
import { DiffReview, type PendingEdit } from './DiffReview'
import { Models } from './Models'

type Pane = 'chat' | 'models'

/** Tools whose names the UI should present as destructive, matching the main-process tiers. */
const DANGEROUS = new Set(['delete_file'])
const CONFIRMING = new Set(['write_file', 'edit_file', 'create_file', 'run_terminal', 'git_commit'])

export function AIAgent({ projectId }: { projectId: string | null }) {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const [pane, setPane] = useState<Pane>('chat')
  const [config, setConfig] = useState<AIConfig | null>(null)
  const [backends, setBackends] = useState<AIBackend[]>([])
  const [sessions, setSessions] = useState<AISession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  /** Messages for the open session. Seeded from storage, then appended to live
   *  so each round closes into its own bubble instead of one growing blob. */
  const [transcript, setTranscript] = useState<AIMessage[]>([])
  const [liveCalls, setLiveCalls] = useState<AIToolCall[]>([])
  const [approval, setApproval] = useState<AIToolCall | null>(null)
  const [edits, setEdits] = useState<PendingEdit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [sessionQuery, setSessionQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<AISession | null>(null)

  // A session remembers the project it was opened for; that wins over whatever
  // the surrounding tab happens to point at, so reopening a session keeps its tools.
  const openSession = sessions.find((s) => s.id === sessionId) ?? null
  const effectiveProjectId = projectId ?? openSession?.projectId ?? activeProjectId ?? null
  const project = projects.find((p) => p.id === effectiveProjectId) ?? null

  const scroller = useRef<HTMLDivElement>(null)

  const refreshBackends = useCallback(async () => {
    setBackends(await window.nyx.ai.detect())
  }, [])

  useEffect(() => {
    void (async () => {
      const [cfg, list] = await Promise.all([window.nyx.ai.config(), window.nyx.ai.sessions()])
      setConfig(cfg)
      setSessions(list)
      const tabProject = projectId ?? activeProjectId ?? null
      const forProject = list.find((s) => s.projectId === tabProject) ?? list[0] ?? null
      setSessionId(forProject?.id ?? null)
      await refreshBackends()
    })()
  }, [refreshBackends, projectId, activeProjectId])

  const backend = backends.find((b) => b.id === config?.provider) ?? null

  // Switching sessions loads that session's stored history.
  useEffect(() => {
    setTranscript(sessions.find((s) => s.id === sessionId)?.messages ?? [])
    setStreamText('')
    setLiveCalls([])
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Streaming ─────────────────────────────────────────────────────── */

  useEffect(() => window.nyx.ai.onStream((e) => {
    if (e.sessionId !== sessionId) return
    switch (e.type) {
      case 'token':
        setStreamText((t) => t + (e.text ?? ''))
        break
      case 'message': {
        const m = e.message!
        // The optimistic user bubble is replaced by main's authoritative record.
        setTranscript((prev) => {
          const withoutOptimistic = m.role === 'user'
            ? prev.filter((x) => !x.id.startsWith('local-'))
            : prev
          return withoutOptimistic.some((x) => x.id === m.id) ? withoutOptimistic : [...withoutOptimistic, m]
        })
        setStreamText('')
        setLiveCalls([])
        break
      }
      case 'tool-call': {
        const call = e.toolCall!
        if (call.status === 'awaiting-approval') setApproval(call)
        setLiveCalls((c) => [...c.filter((x) => x.id !== call.id), call])
        break
      }
      case 'tool-result': {
        const call = e.toolCall!
        // Main attaches the proposed edit here; it is not yet on disk.
        const edit = call.args.__edit as { path: string; before: string; after: string } | undefined
        if (edit) {
          setEdits((prev) => prev.some((p) => p.path === edit.path && p.after === edit.after)
            ? prev
            : [...prev, { id: call.id, ...edit }])
        }
        setLiveCalls((c) => c.map((x) => (x.id === call.id ? call : x)))
        break
      }
      case 'done':
        setStreaming(false)
        setStreamText('')
        setLiveCalls([])
        void window.nyx.ai.sessions().then(setSessions)
        break
      case 'error':
        setStreaming(false)
        setError(e.error ?? 'Local inference failed')
        setStreamText('')
        void window.nyx.ai.sessions().then(setSessions)
        break
    }
  }), [sessionId])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [transcript.length, streamText, edits.length])

  /* ── Actions ───────────────────────────────────────────────────────── */

  const newSession = async () => {
    const s = await window.nyx.ai.createSession(effectiveProjectId)
    setSessions(await window.nyx.ai.sessions())
    setSessionId(s.id)
    setEdits([])
    setError(null)
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || streaming || !config) return
    let id = sessionId
    if (!id) {
      const s = await window.nyx.ai.createSession(effectiveProjectId)
      id = s.id
      setSessionId(id)
    }
    setDraft('')
    setError(null)
    setStreaming(true)
    setStreamText('')
    setLiveCalls([])
    // Show the user's message at once; main replaces it with the stored record.
    setTranscript((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: text, at: Date.now() }])
    try {
      await window.nyx.ai.send({ sessionId: id, text, projectId: effectiveProjectId, attachments })
    } catch (e) {
      setStreaming(false)
      setError(e instanceof Error ? e.message : 'Could not reach the local model')
    }
    setSessions(await window.nyx.ai.sessions())
  }

  const applyEdit = async (edit: PendingEdit) => {
    try {
      await window.nyx.ai.applyEdit(effectiveProjectId, edit.path, edit.after)
      setEdits((e) => e.filter((x) => x.id !== edit.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not write the file')
    }
  }

  const patchConfig = async (patch: Partial<AIConfig>) => {
    setConfig(await window.nyx.ai.patchConfig(patch))
  }

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase()
    return sessions.filter((s) => !q || s.title.toLowerCase().includes(q))
  }, [sessions, sessionQuery])

  if (!config) {
    return <div style={{ color: nyx('textMuted') }} className="flex h-full items-center justify-center text-xs">Loading…</div>
  }

  const online = !!backend?.available
  const modelLabel = config.model ?? 'no model'

  return (
    <div className="flex h-full min-w-0">
      <aside style={{ borderColor: nyx('outlineVariant') }} className="flex w-64 shrink-0 flex-col border-r">
        <div className="flex shrink-0 gap-1 p-2">
          {(['chat', 'models'] as Pane[]).map((p) => (
            <button
              key={p}
              onClick={() => setPane(p)}
              style={{
                background: pane === p ? nyx('primaryContainer') : 'transparent',
                color: pane === p ? nyx('onPrimaryContainer') : nyx('textMuted'),
              }}
              className="h-7 flex-1 rounded-lg text-[11px] capitalize"
            >
              {p === 'chat' ? 'Sessions' : 'Models'}
            </button>
          ))}
        </div>

        <div className="px-2 pb-2">
          <NyxSearch value={sessionQuery} onValueChange={setSessionQuery} placeholder="Search sessions…" />
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2">
          {filteredSessions.map((s) => (
            <li key={s.id} className="group flex items-center gap-1">
              <button
                onClick={() => { setSessionId(s.id); setPane('chat'); setEdits([]) }}
                style={{ background: s.id === sessionId ? nyx('selection') : 'transparent' }}
                className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left"
              >
                <div style={{ color: nyx('textPrimary') }} className="truncate text-xs">{s.title}</div>
                <div style={{ color: nyx('textMuted') }} className="text-[10px]">
                  {new Date(s.updatedAt).toLocaleDateString()} · {s.messages.length} messages
                </div>
              </button>
              <NyxIconButton
                label="Delete session"
                icon={<Trash2 size={12} />}
                className="opacity-0 group-hover:opacity-100"
                onClick={() => setPendingDelete(s)}
              />
            </li>
          ))}
          {!filteredSessions.length ? (
            <li style={{ color: nyx('textMuted') }} className="px-2 py-6 text-center text-xs">No sessions.</li>
          ) : null}
        </ul>

        <div style={{ borderColor: nyx('outlineVariant') }} className="border-t p-2.5">
          <NyxButton className="w-full" size="sm" icon={<Plus size={13} />} onClick={() => void newSession()}>
            New session
          </NyxButton>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header
          style={{ borderColor: nyx('outlineVariant') }}
          className="flex h-11 shrink-0 items-center gap-3 border-b px-4"
        >
          <Bot size={15} style={{ color: nyx('textMuted') }} />
          <NyxStatus tone={online ? 'success' : 'idle'}>
            {online ? 'LOCAL' : 'OFFLINE'}
          </NyxStatus>
          <span style={{ color: nyx('textSecondary') }} className="truncate font-mono text-[11px]">
            {backend?.label ?? config.provider} · {modelLabel}
          </span>
          {project ? (
            <span style={{ color: nyx('textMuted') }} className="truncate text-[11px]">{project.name}</span>
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <NyxDropdown<AIMode>
              value={config.mode}
              onChange={(mode) => void patchConfig({ mode })}
              options={[
                { value: 'ask', label: 'Ask' },
                { value: 'plan', label: 'Plan' },
                { value: 'agent', label: 'Agent' },
                { value: 'trusted', label: 'Trusted Agent' },
              ]}
            />
            <NyxDropdown<AIResourceMode>
              value={config.resourceMode}
              onChange={(resourceMode) => void patchConfig({ resourceMode })}
              options={[
                { value: 'performance', label: 'Performance' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'low-ram', label: 'Low RAM' },
              ]}
            />
            <NyxIconButton
              label="Models"
              active={pane === 'models'}
              icon={<Settings2 size={14} />}
              onClick={() => setPane(pane === 'models' ? 'chat' : 'models')}
            />
          </div>
        </header>

        {config.mode === 'trusted' ? (
          <div
            style={{ background: nyx('errorContainer'), color: nyx('error') }}
            className="shrink-0 px-4 py-1.5 text-[11px]"
          >
            Trusted Agent: file writes and commands run without asking. Deleting files and other
            destructive operations still require confirmation.
          </div>
        ) : null}

        {pane === 'models' ? (
          <Models
            config={config}
            backends={backends}
            onSelect={(model) => void patchConfig({ model })}
            onRefreshBackends={() => void refreshBackends()}
          />
        ) : !online ? (
          <NyxEmptyState
            icon={<Bot size={28} strokeWidth={1.5} />}
            title="No local AI backend detected"
            description={backend?.detail
              ?? `Nyxium looked for a server at ${config.endpoints[config.provider]}. Start Ollama, a llama.cpp server, or any local OpenAI-compatible endpoint — no API key is ever required.`}
            actions={
              <>
                <NyxButton variant="filled" onClick={() => void refreshBackends()}>Check again</NyxButton>
                <NyxButton variant="outline" onClick={() => setPane('models')}>Configure</NyxButton>
              </>
            }
          />
        ) : (
          <>
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {!transcript.length && !streamText ? (
                <NyxEmptyState
                  icon={<MessageSquare size={26} strokeWidth={1.5} />}
                  title="Ask the local agent"
                  description={project
                    ? `It knows it is working in ${project.name} and retrieves files on demand — it does not read your whole repository.`
                    : 'Open a project first to give the agent file and Git tools.'}
                />
              ) : (
                <div className="mx-auto flex max-w-3xl flex-col gap-5">
                  {transcript.map((m) => <Message key={m.id} message={m} />)}
                  {liveCalls.length ? (
                    <div className="flex flex-col gap-1">
                      {liveCalls.map((c) => <ToolLine key={c.id} call={c} />)}
                    </div>
                  ) : null}
                  {streamText ? (
                    <Message
                      message={{ id: 'streaming', role: 'assistant', content: streamText, at: Date.now() }}
                      streaming
                    />
                  ) : null}
                </div>
              )}
            </div>

            <DiffReview
              edits={edits}
              onApply={(e) => void applyEdit(e)}
              onReject={(e) => setEdits((prev) => prev.filter((x) => x.id !== e.id))}
              onApplyAll={() => void Promise.all(edits.map(applyEdit))}
              onRejectAll={() => setEdits([])}
            />

            {error ? (
              <div
                style={{ background: nyx('errorContainer'), color: nyx('error') }}
                className="flex shrink-0 items-start gap-2 px-4 py-2 text-xs"
              >
                <span className="min-w-0 flex-1">{error}</span>
                <button onClick={() => setError(null)} aria-label="Dismiss error"><X size={13} /></button>
              </div>
            ) : null}

            {project ? (
              <ContextBar
                projectId={project.id}
                attachments={attachments}
                onChange={setAttachments}
              />
            ) : null}

            <div style={{ borderColor: nyx('outlineVariant') }} className="shrink-0 border-t p-3">
              <div
                style={{ background: nyx('surfaceVariant'), borderColor: nyx('outlineVariant') }}
                className="flex items-end gap-2 rounded-xl border p-2"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
                  }}
                  rows={2}
                  placeholder={config.model ? 'Ask the local agent…' : 'Select a model first'}
                  disabled={!config.model}
                  style={{ color: nyx('textPrimary') }}
                  className="max-h-40 min-h-0 flex-1 resize-none bg-transparent text-sm outline-none
                             placeholder:text-[var(--nyx-textMuted)] disabled:opacity-50"
                />
                {streaming ? (
                  <NyxButton
                    size="sm"
                    variant="danger"
                    icon={<Square size={12} />}
                    onClick={() => { window.nyx.ai.cancel(sessionId!); setStreaming(false) }}
                  >
                    Stop
                  </NyxButton>
                ) : (
                  <NyxButton
                    size="sm"
                    variant="filled"
                    icon={<Send size={12} />}
                    disabled={!draft.trim() || !config.model}
                    onClick={() => void send()}
                  >
                    Send
                  </NyxButton>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <NyxPermissionDialog
        open={!!approval}
        danger={!!approval && DANGEROUS.has(approval.name)}
        title={approval && DANGEROUS.has(approval.name) ? 'Allow a destructive operation?' : 'Allow this tool?'}
        confirmLabel="Allow"
        detail={approval ? <ApprovalDetail call={approval} /> : ''}
        onCancel={() => { if (approval) window.nyx.ai.approve(approval.id, false); setApproval(null) }}
        onConfirm={() => { if (approval) window.nyx.ai.approve(approval.id, true); setApproval(null) }}
      />

      <NyxPermissionDialog
        open={!!pendingDelete}
        danger
        title="Delete session?"
        confirmLabel="Delete"
        detail={`“${pendingDelete?.title}” and its messages will be removed from ~/.config/nyxium/ai-sessions.json.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const s = pendingDelete
          setPendingDelete(null)
          if (!s) return
          const next = await window.nyx.ai.deleteSession(s.id)
          setSessions(next)
          if (sessionId === s.id) setSessionId(next[0]?.id ?? null)
        }}
      />
    </div>
  )
}

function ApprovalDetail({ call }: { call: AIToolCall }) {
  const command = typeof call.args.command === 'string' ? call.args.command : null
  const path = typeof call.args.path === 'string' ? call.args.path : null
  return (
    <div className="flex flex-col gap-2">
      <p>
        The agent wants to run <strong style={{ color: nyx('textPrimary') }}>{call.name}</strong>
        {path ? <> on <code style={{ color: nyx('textPrimary') }}>{path}</code></> : null}.
      </p>
      {command ? (
        <pre
          style={{ background: nyx('codeBackground'), color: nyx('codeForeground'), borderColor: nyx('outlineVariant') }}
          className="overflow-auto rounded-lg border p-2.5 font-mono text-[11px]"
        >
          {command}
        </pre>
      ) : null}
      {DANGEROUS.has(call.name) ? (
        <p style={{ color: nyx('error') }}>This cannot be undone from inside Nyxium.</p>
      ) : null}
    </div>
  )
}

function Message({ message, streaming }: { message: AIMessage; streaming?: boolean }) {
  const isUser = message.role === 'user'
  return (
    <div className="flex flex-col gap-1.5">
      <span
        style={{ color: isUser ? nyx('textSecondary') : nyx('primary') }}
        className="text-[11px] font-semibold tracking-wide"
      >
        {isUser ? 'You' : 'Nyxium Agent'}
      </span>
      <div
        style={{
          background: isUser ? nyx('surfaceVariant') : 'transparent',
          color: nyx('textPrimary'),
        }}
        className={`text-sm leading-relaxed whitespace-pre-wrap ${isUser ? 'rounded-xl px-3 py-2' : ''}`}
      >
        {message.content}
        {streaming ? <span style={{ color: nyx('primary') }}>▌</span> : null}
      </div>
      {message.toolCalls?.length ? (
        <div className="mt-1 flex flex-col gap-1">
          {message.toolCalls.map((c) => <ToolLine key={c.id} call={c} />)}
        </div>
      ) : null}
    </div>
  )
}

function ToolLine({ call }: { call: AIToolCall }) {
  const tone = call.status === 'denied' ? nyx('warning')
    : call.status === 'error' ? nyx('error')
      : call.status === 'done' ? nyx('success')
        : nyx('info')
  const icon = call.status === 'done' ? <Check size={11} />
    : call.status === 'denied' ? <X size={11} />
      : DANGEROUS.has(call.name) || CONFIRMING.has(call.name) ? <Wrench size={11} /> : <Search size={11} />
  const arg = typeof call.args.path === 'string' ? call.args.path
    : typeof call.args.query === 'string' ? call.args.query
      : typeof call.args.command === 'string' ? call.args.command
        : typeof call.args.name === 'string' ? call.args.name : ''

  return (
    <div
      style={{ background: nyx('surfaceVariant'), color: tone }}
      className="flex items-center gap-2 self-start rounded-lg px-2 py-1 font-mono text-[11px]"
    >
      {icon}
      <span>{call.name}</span>
      {arg ? <span style={{ color: nyx('textMuted') }} className="max-w-80 truncate">{arg}</span> : null}
      {call.status === 'awaiting-approval' ? (
        <span style={{ color: nyx('warning') }}>waiting for approval</span>
      ) : null}
    </div>
  )
}

/** Explicit file attachments. The agent otherwise pulls context on demand. */
function ContextBar({
  projectId, attachments, onChange,
}: { projectId: string; attachments: string[]; onChange: (a: string[]) => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<string[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || query.trim().length < 2) { setHits([]); return }
    let live = true
    const t = setTimeout(() => {
      void window.nyx.search.files(projectId, query.trim())
        .then((f) => { if (live) setHits(f.slice(0, 8).map((x) => x.path)) })
    }, 200)
    return () => { live = false; clearTimeout(t) }
  }, [open, query, projectId])

  return (
    <div style={{ borderColor: nyx('outlineVariant') }} className="shrink-0 border-t px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span style={{ color: nyx('textMuted') }} className="text-[10px] font-semibold tracking-wider uppercase">
          Context
        </span>
        {attachments.map((a) => (
          <span
            key={a}
            style={{ background: nyx('primaryContainer'), color: nyx('onPrimaryContainer') }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px]"
          >
            <FileCode size={10} />
            {a}
            <button onClick={() => onChange(attachments.filter((x) => x !== a))} aria-label={`Remove ${a}`}>
              <X size={9} />
            </button>
          </span>
        ))}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ color: nyx('textMuted') }}
          className="inline-flex items-center gap-1 text-[10px] hover:brightness-150"
        >
          <Plus size={10} /> Attach file
        </button>
      </div>

      {open ? (
        <div className="mt-2">
          <NyxSearch value={query} onValueChange={setQuery} placeholder="Find a file to attach…" autoFocus />
          {hits.length ? (
            <ul className="mt-1 max-h-32 overflow-y-auto">
              {hits.map((h) => (
                <li key={h}>
                  <button
                    onClick={() => {
                      if (!attachments.includes(h)) onChange([...attachments, h])
                      setOpen(false)
                      setQuery('')
                    }}
                    style={{ color: nyx('textSecondary') }}
                    className="w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] hover:brightness-150"
                  >
                    {h}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
