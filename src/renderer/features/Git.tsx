import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine, ArrowUpFromLine, Check, FolderGit2, GitBranch, GitCommitHorizontal,
  Minus, Plus, RefreshCw, RotateCcw, Archive,
} from 'lucide-react'
import type {
  CommandResult, GitBranchInfo, GitCommit, GitFileChange, GitStashEntry,
} from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxEmptyState, NyxIconButton, NyxPermissionDialog,
} from '../components/nyx'

type Panel = 'changes' | 'history' | 'branches' | 'stashes'

const STATUS_MARK: Record<GitFileChange['status'], string> = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R',
  copied: 'C', conflicted: 'U', untracked: '?',
}

const statusTone = (s: GitFileChange['status']) =>
  s === 'deleted' || s === 'conflicted' ? nyx('error')
    : s === 'added' || s === 'untracked' ? nyx('success')
      : nyx('warning')

export function Git({ projectId }: { projectId: string | null }) {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const openTab = useStore((s) => s.openTab)
  const id = projectId ?? activeProjectId ?? projects[0]?.id ?? null
  const project = projects.find((p) => p.id === id) ?? null

  const [panel, setPanel] = useState<Panel>('changes')
  const [changes, setChanges] = useState<GitFileChange[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [stashes, setStashes] = useState<GitStashEntry[]>([])
  const [selected, setSelected] = useState<GitFileChange | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<
    { title: string; detail: string; run: () => Promise<CommandResult> } | null
  >(null)

  const refresh = useCallback(async () => {
    if (!id) return
    setBusy(true)
    const [c, l, b, s] = await Promise.all([
      window.nyx.git.status(id),
      window.nyx.git.log(id, 60),
      window.nyx.git.branches(id),
      window.nyx.git.stashes(id),
    ])
    setChanges(c)
    setCommits(l)
    setBranches(b)
    setStashes(s)
    setBusy(false)
  }, [id])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!id || !selected) { setDiff(''); return }
    let live = true
    void window.nyx.git.diff(id, selected.path, selected.staged).then((d) => { if (live) setDiff(d) })
    return () => { live = false }
  }, [id, selected])

  /** Every mutation funnels through here so failures surface instead of vanishing. */
  const act = async (fn: () => Promise<CommandResult>) => {
    setBusy(true)
    setError(null)
    const r = await fn()
    if (!r.ok) setError(r.stderr.trim() || r.stdout.trim() || 'Git command failed')
    await refresh()
    setBusy(false)
    return r
  }

  const staged = useMemo(() => changes.filter((c) => c.staged), [changes])
  const unstaged = useMemo(() => changes.filter((c) => !c.staged), [changes])
  const current = branches.find((b) => b.current)

  if (!project) {
    return (
      <NyxEmptyState
        icon={<FolderGit2 size={30} strokeWidth={1.4} />}
        title="No project selected"
        description="Git operates on a project's working tree. Import or select a project first."
        actions={<NyxButton variant="filled" onClick={() => openTab('projects')}>Open Projects</NyxButton>}
      />
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        style={{ borderColor: nyx('outlineVariant') }}
        className="flex h-11 shrink-0 items-center gap-3 border-b px-4"
      >
        <GitBranch size={15} style={{ color: nyx('textMuted') }} />
        <span style={{ color: nyx('textPrimary') }} className="font-mono text-xs">
          {current?.name ?? '—'}
        </span>
        <span style={{ color: nyx('textMuted') }} className="truncate text-xs">{project.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <NyxButton size="sm" variant="ghost" icon={<RefreshCw size={12} />} loading={busy}
            onClick={() => void act(() => window.nyx.git.fetch(project.id))}>Fetch</NyxButton>
          <NyxButton size="sm" variant="ghost" icon={<ArrowDownToLine size={12} />}
            onClick={() => void act(() => window.nyx.git.pull(project.id))}>Pull</NyxButton>
          <NyxButton size="sm" variant="ghost" icon={<ArrowUpFromLine size={12} />}
            onClick={() => void act(() => window.nyx.git.push(project.id))}>Push</NyxButton>
          <NyxIconButton label="Refresh" icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />}
            onClick={() => void refresh()} />
        </div>
      </header>

      {error ? (
        <div
          style={{ background: nyx('errorContainer'), color: nyx('error'), borderColor: nyx('outlineVariant') }}
          className="shrink-0 border-b px-4 py-2 font-mono text-[11px] whitespace-pre-wrap"
        >
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          style={{ borderColor: nyx('outlineVariant') }}
          className="flex min-h-0 w-80 shrink-0 flex-col border-r"
        >
          <div className="flex shrink-0 gap-1 p-2">
            {(['changes', 'history', 'branches', 'stashes'] as Panel[]).map((p) => (
              <button
                key={p}
                onClick={() => setPanel(p)}
                style={{
                  background: panel === p ? nyx('primaryContainer') : 'transparent',
                  color: panel === p ? nyx('onPrimaryContainer') : nyx('textMuted'),
                }}
                className="h-7 flex-1 rounded-lg text-[11px] capitalize"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {panel === 'changes' ? (
              <ChangesPanel
                staged={staged}
                unstaged={unstaged}
                selected={selected}
                onSelect={setSelected}
                onStage={(paths) => void act(() => window.nyx.git.stage(project.id, paths))}
                onUnstage={(paths) => void act(() => window.nyx.git.unstage(project.id, paths))}
                onDiscard={(paths) => setConfirm({
                  title: 'Discard local changes?',
                  detail: `${paths.length} file(s) will be restored to their last committed state. This cannot be undone.`,
                  run: () => window.nyx.git.discard(project.id, paths),
                })}
              />
            ) : null}

            {panel === 'history' ? (
              <ul className="flex flex-col gap-0.5">
                {commits.map((c) => (
                  <li key={c.hash}>
                    <div className="rounded-lg px-2 py-1.5">
                      <div style={{ color: nyx('textPrimary') }} className="truncate text-xs">{c.subject}</div>
                      <div style={{ color: nyx('textMuted') }} className="mt-0.5 flex gap-2 text-[10px]">
                        <span className="font-mono">{c.short}</span>
                        <span className="truncate">{c.author}</span>
                        <span className="ml-auto shrink-0">{new Date(c.at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </li>
                ))}
                {!commits.length ? <Empty>No commits.</Empty> : null}
              </ul>
            ) : null}

            {panel === 'branches' ? (
              <BranchesPanel
                branches={branches}
                onCheckout={(name) => void act(() => window.nyx.git.checkout(project.id, name))}
                onCreate={(name) => void act(() => window.nyx.git.createBranch(project.id, name))}
                onMerge={(name) => setConfirm({
                  title: `Merge ${name}?`,
                  detail: `${name} will be merged into ${current?.name ?? 'the current branch'}.`,
                  run: () => window.nyx.git.merge(project.id, name),
                })}
              />
            ) : null}

            {panel === 'stashes' ? (
              <div className="flex flex-col gap-1">
                <NyxButton size="sm" icon={<Archive size={12} />}
                  onClick={() => void act(() => window.nyx.git.stashPush(project.id))}>
                  Stash changes
                </NyxButton>
                {stashes.map((s) => (
                  <div key={s.ref} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div style={{ color: nyx('textPrimary') }} className="truncate text-xs">{s.subject}</div>
                      <div style={{ color: nyx('textMuted') }} className="font-mono text-[10px]">{s.ref}</div>
                    </div>
                    <NyxButton size="sm" variant="ghost"
                      onClick={() => void act(() => window.nyx.git.stashPop(project.id, s.ref))}>Pop</NyxButton>
                    <NyxButton size="sm" variant="ghost"
                      onClick={() => setConfirm({
                        title: 'Drop stash?',
                        detail: `${s.ref} — ${s.subject}. The stashed changes are lost permanently.`,
                        run: () => window.nyx.git.stashDrop(project.id, s.ref),
                      })}>Drop</NyxButton>
                  </div>
                ))}
                {!stashes.length ? <Empty>No stashes.</Empty> : null}
              </div>
            ) : null}
          </div>

          {panel === 'changes' ? (
            <div style={{ borderColor: nyx('outlineVariant') }} className="shrink-0 border-t p-2.5">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                placeholder="Commit message"
                style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
                className="w-full resize-none rounded-lg border p-2 text-xs outline-none
                           focus:border-[var(--nyx-primary)] placeholder:text-[var(--nyx-textMuted)]"
              />
              <NyxButton
                className="mt-2 w-full"
                size="sm"
                variant="filled"
                icon={<GitCommitHorizontal size={13} />}
                disabled={!message.trim() || !staged.length}
                onClick={async () => {
                  const r = await act(() => window.nyx.git.commit(project.id, message.trim()))
                  if (r.ok) setMessage('')
                }}
              >
                Commit {staged.length ? `(${staged.length})` : ''}
              </NyxButton>
            </div>
          ) : null}
        </aside>

        <section className="min-w-0 flex-1 overflow-auto">
          {selected ? (
            <DiffView path={selected.path} diff={diff} />
          ) : (
            <div style={{ color: nyx('textMuted') }} className="flex h-full items-center justify-center text-xs">
              Select a changed file to view its diff.
            </div>
          )}
        </section>
      </div>

      <NyxPermissionDialog
        open={!!confirm}
        danger
        title={confirm?.title ?? ''}
        confirmLabel="Continue"
        detail={confirm?.detail ?? ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          if (c) void act(c.run)
        }}
      />
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: nyx('textMuted') }} className="px-2 py-6 text-center text-xs">{children}</p>
  )
}

function ChangesPanel({
  staged, unstaged, selected, onSelect, onStage, onUnstage, onDiscard,
}: {
  staged: GitFileChange[]; unstaged: GitFileChange[]; selected: GitFileChange | null
  onSelect: (f: GitFileChange) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (paths: string[]) => void
}) {
  if (!staged.length && !unstaged.length) return <Empty>Working tree clean.</Empty>

  const row = (f: GitFileChange, action: React.ReactNode) => (
    <li key={`${f.staged}:${f.path}`}>
      <div
        style={{ background: selected?.path === f.path && selected.staged === f.staged ? nyx('selection') : 'transparent' }}
        className="group flex items-center gap-2 rounded-lg px-2 py-1"
      >
        <button onClick={() => onSelect(f)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span style={{ color: statusTone(f.status) }} className="w-3 shrink-0 font-mono text-[11px]">
            {STATUS_MARK[f.status]}
          </span>
          <span style={{ color: nyx('textSecondary') }} className="truncate font-mono text-[11px]">{f.path}</span>
        </button>
        <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">{action}</span>
      </div>
    </li>
  )

  return (
    <div className="flex flex-col gap-2">
      {staged.length ? (
        <div>
          <SectionHead
            label={`Staged (${staged.length})`}
            action={
              <button
                onClick={() => onUnstage(staged.map((f) => f.path))}
                style={{ color: nyx('textMuted') }}
                className="text-[10px] hover:brightness-150"
              >
                Unstage all
              </button>
            }
          />
          <ul>
            {staged.map((f) => row(f,
              <NyxIconButton label="Unstage" icon={<Minus size={12} />} onClick={() => onUnstage([f.path])} />))}
          </ul>
        </div>
      ) : null}

      {unstaged.length ? (
        <div>
          <SectionHead
            label={`Changes (${unstaged.length})`}
            action={
              <button
                onClick={() => onStage(unstaged.map((f) => f.path))}
                style={{ color: nyx('textMuted') }}
                className="text-[10px] hover:brightness-150"
              >
                Stage all
              </button>
            }
          />
          <ul>
            {unstaged.map((f) => row(f, (
              <>
                <NyxIconButton label="Discard" icon={<RotateCcw size={12} />} onClick={() => onDiscard([f.path])} />
                <NyxIconButton label="Stage" icon={<Plus size={12} />} onClick={() => onStage([f.path])} />
              </>
            )))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function SectionHead({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <span style={{ color: nyx('textMuted') }} className="text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </span>
      {action}
    </div>
  )
}

function BranchesPanel({
  branches, onCheckout, onCreate, onMerge,
}: {
  branches: GitBranchInfo[]
  onCheckout: (name: string) => void
  onCreate: (name: string) => void
  onMerge: (name: string) => void
}) {
  const [draft, setDraft] = useState('')
  const local = branches.filter((b) => !b.remote)
  const remote = branches.filter((b) => b.remote)

  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onCreate(draft.trim()); setDraft('') } }}
        className="flex gap-1.5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="new-branch"
          style={{ background: nyx('surfaceVariant'), color: nyx('textPrimary'), borderColor: nyx('outlineVariant') }}
          className="h-7 min-w-0 flex-1 rounded-lg border px-2 font-mono text-[11px] outline-none
                     focus:border-[var(--nyx-primary)]"
        />
        <NyxButton size="sm" type="submit" disabled={!draft.trim()} icon={<Plus size={12} />}>Create</NyxButton>
      </form>

      <SectionHead label="Local" />
      <ul>
        {local.map((b) => (
          <li key={b.name} className="group flex items-center gap-2 rounded-lg px-2 py-1">
            <button onClick={() => onCheckout(b.name)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              {b.current ? <Check size={11} style={{ color: nyx('primary') }} /> : <span className="w-[11px]" />}
              <span style={{ color: b.current ? nyx('textPrimary') : nyx('textSecondary') }} className="truncate font-mono text-[11px]">
                {b.name}
              </span>
            </button>
            {!b.current ? (
              <button
                onClick={() => onMerge(b.name)}
                style={{ color: nyx('textMuted') }}
                className="shrink-0 text-[10px] opacity-0 group-hover:opacity-100"
              >
                Merge
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {remote.length ? (
        <>
          <SectionHead label="Remote" />
          <ul>
            {remote.map((b) => (
              <li key={b.name} className="px-2 py-1">
                <span style={{ color: nyx('textMuted') }} className="truncate font-mono text-[11px]">{b.name}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

/** Unified-diff renderer. Line colour comes from the palette, never from fixed red/green. */
export function DiffView({ path, diff }: { path: string; diff: string }) {
  const lines = diff ? diff.split('\n') : []
  return (
    <div className="flex h-full flex-col">
      <div
        style={{ borderColor: nyx('outlineVariant'), background: nyx('surface') }}
        className="flex h-9 shrink-0 items-center border-b px-4"
      >
        <span style={{ color: nyx('textSecondary') }} className="truncate font-mono text-[11px]">{path}</span>
      </div>
      <div
        style={{ background: nyx('codeBackground') }}
        className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-[1.6]"
      >
        {lines.length === 0 ? (
          <span style={{ color: nyx('textMuted') }}>No textual diff (binary file or no changes).</span>
        ) : lines.map((l, i) => {
          const add = l.startsWith('+') && !l.startsWith('+++')
          const del = l.startsWith('-') && !l.startsWith('---')
          const meta = l.startsWith('@@') || l.startsWith('diff ') || l.startsWith('index ')
          return (
            <div
              key={i}
              style={{
                color: add ? nyx('success') : del ? nyx('error') : meta ? nyx('info') : nyx('codeForeground'),
                background: add ? nyx('selection') : undefined,
              }}
              className="px-2 whitespace-pre-wrap"
            >
              {l || ' '}
            </div>
          )
        })}
      </div>
    </div>
  )
}
