import { useEffect, useMemo, useState } from 'react'
import {
  Bot, Boxes, ExternalLink, FolderGit2, GitBranch, Plus, RefreshCw, TerminalSquare, Trash2,
} from 'lucide-react'
import type { EnvTool, GitSummary, Project } from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxCard, NyxCardHeader, NyxChip, NyxEmptyState, NyxIconButton, NyxListItem,
  NyxPermissionDialog, NyxSearch, NyxStatus,
} from '../components/nyx'

export function Projects({ projectId }: { projectId: string | null }) {
  const projects = useStore((s) => s.projects)
  const workspaceId = useStore((s) => s.config.activeWorkspaceId)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const openTab = useStore((s) => s.openTab)
  const setActiveProject = useStore((s) => s.setActiveProject)

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(projectId)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)

  const mine = useMemo(
    () => projects.filter((p) => p.workspaceId === workspaceId),
    [projects, workspaceId],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return mine
    return mine.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.path.toLowerCase().includes(q) ||
      p.stack.some((s) => s.toLowerCase().includes(q)))
  }, [mine, query])

  const selected = mine.find((p) => p.id === selectedId) ?? filtered[0] ?? null

  useEffect(() => { if (projectId) setSelectedId(projectId) }, [projectId])
  useEffect(() => { setActiveProject(selected?.id ?? null) }, [selected?.id, setActiveProject])

  const importProject = async () => {
    const p = await window.nyx.projects.import()
    await refreshProjects()
    if (p) setSelectedId(p.id)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    await window.nyx.projects.remove(pendingDelete.id)
    setPendingDelete(null)
    if (selectedId === pendingDelete.id) setSelectedId(null)
    await refreshProjects()
  }

  if (mine.length === 0) {
    return (
      <>
        <NyxEmptyState
          icon={<FolderGit2 size={30} strokeWidth={1.4} />}
          title="No projects yet"
          description="Nyxium is project-centric. Import a directory and it detects Git, the stack and your toolchain — nothing is uploaded anywhere."
          actions={<NyxButton variant="filled" icon={<Plus size={14} />} onClick={importProject}>Import Project</NyxButton>}
        />
      </>
    )
  }

  return (
    <div className="flex h-full min-w-0">
      <aside
        style={{ borderColor: nyx('outlineVariant') }}
        className="flex w-72 shrink-0 flex-col border-r"
      >
        <div className="p-3">
          <NyxSearch value={query} onValueChange={setQuery} placeholder="Filter projects…" />
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-2">
          {filtered.map((p) => (
            <li key={p.id}>
              <NyxListItem
                selected={p.id === selected?.id}
                onClick={() => setSelectedId(p.id)}
                leading={<FolderGit2 size={15} />}
                title={p.name}
                subtitle={p.stack.slice(0, 3).join(' · ') || p.path}
              />
            </li>
          ))}
          {filtered.length === 0 ? (
            <li style={{ color: nyx('textMuted') }} className="px-3 py-6 text-center text-xs">
              No match for “{query}”
            </li>
          ) : null}
        </ul>
        <div style={{ borderColor: nyx('outlineVariant') }} className="border-t p-3">
          <NyxButton className="w-full" icon={<Plus size={14} />} onClick={importProject}>Import Project</NyxButton>
        </div>
      </aside>

      {selected ? (
        <ProjectDetail
          key={selected.id}
          project={selected}
          onOpenTab={openTab}
          onDelete={() => setPendingDelete(selected)}
        />
      ) : null}

      <NyxPermissionDialog
        open={!!pendingDelete}
        danger
        title="Remove project from Nyxium?"
        confirmLabel="Remove"
        detail={
          <>
            <p>
              <strong style={{ color: nyx('textPrimary') }}>{pendingDelete?.name}</strong> will be removed from
              Nyxium's project list.
            </p>
            <p className="mt-2">
              The directory on disk is left untouched — nothing is deleted from your filesystem.
            </p>
          </>
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function ProjectDetail({
  project, onOpenTab, onDelete,
}: {
  project: Project
  onOpenTab: ReturnType<typeof useStore.getState>['openTab']
  onDelete: () => void
}) {
  const refreshProjects = useStore((s) => s.refreshProjects)
  const [git, setGit] = useState<GitSummary | null>(null)
  const [env, setEnv] = useState<EnvTool[] | null>(null)
  const [notes, setNotes] = useState(project.notes)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    const [g, e] = await Promise.all([
      window.nyx.projects.git(project.id),
      window.nyx.projects.env(project.id),
    ])
    setGit(g)
    setEnv(e)
    setBusy(false)
  }

  useEffect(() => { void load() }, [project.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notes are debounced so typing does not hit disk on every keystroke.
  useEffect(() => {
    if (notes === project.notes) return
    const t = setTimeout(() => {
      void window.nyx.projects.setNotes(project.id, notes).then(refreshProjects)
    }, 500)
    return () => clearTimeout(t)
  }, [notes, project.id, project.notes, refreshProjects])

  const installed = (env ?? []).filter((t) => t.version)

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 style={{ color: nyx('textPrimary') }} className="truncate text-xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <p style={{ color: nyx('textMuted') }} className="mt-0.5 truncate font-mono text-xs">{project.path}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {project.stack.map((s) => <NyxChip key={s}>{s}</NyxChip>)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <NyxIconButton label="Refresh project state" icon={<RefreshCw size={15} className={busy ? 'animate-spin' : ''} />} onClick={() => void load()} />
          <NyxIconButton label="Open folder" icon={<ExternalLink size={15} />} onClick={() => void window.nyx.projects.reveal(project.id)} />
          <NyxIconButton label="Remove project" icon={<Trash2 size={15} />} onClick={onDelete} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NyxCard>
          <NyxCardHeader title="Git" />
          <div className="p-3.5">
            {!git ? (
              <span style={{ color: nyx('textMuted') }} className="text-xs">Reading…</span>
            ) : !git.isRepo ? (
              <span style={{ color: nyx('textMuted') }} className="text-xs">Not a Git repository.</span>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span style={{ color: nyx('textSecondary') }} className="flex items-center gap-2 text-xs">
                    <GitBranch size={13} /> Branch
                  </span>
                  <span style={{ color: nyx('textPrimary') }} className="font-mono text-xs">{git.branch ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ color: nyx('textSecondary') }} className="text-xs">Working tree</span>
                  <NyxStatus tone={git.dirty ? 'warning' : 'success'}>
                    {git.dirty ? `${git.dirty} changed` : 'Clean'}
                  </NyxStatus>
                </div>
                {git.ahead || git.behind ? (
                  <div className="flex items-center justify-between">
                    <span style={{ color: nyx('textSecondary') }} className="text-xs">Remote</span>
                    <span style={{ color: nyx('textPrimary') }} className="font-mono text-xs">
                      ↑{git.ahead} ↓{git.behind}
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </NyxCard>

        <NyxCard>
          <NyxCardHeader title="Environment" />
          <div className="p-3.5">
            {env === null ? (
              <span style={{ color: nyx('textMuted') }} className="text-xs">Probing toolchain…</span>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {installed.map((t) => (
                  <div key={t.name} className="flex items-baseline justify-between gap-2">
                    <dt style={{ color: nyx('textSecondary') }} className="text-xs">{t.name}</dt>
                    <dd style={{ color: nyx('textPrimary') }} className="font-mono text-xs">{t.version}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </NyxCard>

        <NyxCard className="lg:col-span-2">
          <NyxCardHeader title="Notes" />
          <div className="p-3.5">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={'TODO\n[ ] …'}
              rows={8}
              style={{
                background: nyx('codeBackground'), color: nyx('codeForeground'),
                borderColor: nyx('outlineVariant'),
              }}
              className="w-full resize-y rounded-lg border p-3 font-mono text-xs leading-relaxed outline-none
                         focus:border-[var(--nyx-primary)] placeholder:text-[var(--nyx-textMuted)]"
            />
            <p style={{ color: nyx('textMuted') }} className="mt-1.5 text-[11px]">
              Saved locally to ~/.config/nyxium/projects.json
            </p>
          </div>
        </NyxCard>

        <NyxCard className="lg:col-span-2">
          <NyxCardHeader title="Open with" />
          <div className="flex flex-wrap gap-2 p-3.5">
            <NyxButton
              size="sm"
              icon={<Bot size={13} />}
              onClick={() => onOpenTab('ai', { projectId: project.id, title: `AI · ${project.name}` })}
            >
              AI Agent
            </NyxButton>
            <NyxButton
              size="sm"
              variant="outline"
              icon={<TerminalSquare size={13} />}
              onClick={() => onOpenTab('terminal', { projectId: project.id, title: `Terminal · ${project.name}` })}
            >
              Terminal
            </NyxButton>
            <NyxButton
              size="sm"
              variant="outline"
              icon={<GitBranch size={13} />}
              onClick={() => onOpenTab('git', { projectId: project.id, title: `Git · ${project.name}` })}
            >
              Git
            </NyxButton>
            <NyxButton
              size="sm"
              variant="outline"
              icon={<Boxes size={13} />}
              onClick={() => onOpenTab('docker', { projectId: project.id, title: `Docker · ${project.name}` })}
            >
              Docker
            </NyxButton>
          </div>
        </NyxCard>
      </div>
    </div>
  )
}
