import { useEffect, useState } from 'react'
import {
  Bot, Boxes, Cloud, FolderGit2, GitBranch, Palette, Plus, TerminalSquare, Upload,
} from 'lucide-react'
import type { AIBackend, CloudStatus, EnvTool, GitSummary } from '../../shared/types'
import { nyx, usePalette } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxCard, NyxCardHeader, NyxChip, NyxEmptyState, NyxListItem, NyxStatus,
} from '../components/nyx'

const relative = (ts: number) => {
  const mins = Math.round((Date.now() - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function gitTone(g: GitSummary | undefined) {
  if (!g?.isRepo) return { tone: 'idle' as const, text: 'No repository' }
  if (g.dirty > 0) return { tone: 'warning' as const, text: `${g.dirty} changed` }
  return { tone: 'success' as const, text: 'Clean' }
}

export function Dashboard() {
  const projects = useStore((s) => s.projects)
  const notifications = useStore((s) => s.notifications)
  const workspaceId = useStore((s) => s.config.activeWorkspaceId)
  const openTab = useStore((s) => s.openTab)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const { snapshot, providers } = usePalette()

  const [gitMap, setGitMap] = useState<Record<string, GitSummary>>({})
  const [env, setEnv] = useState<EnvTool[]>([])
  const [ai, setAi] = useState<{ backend: AIBackend | null; model: string | null } | null>(null)
  const [cloud, setCloud] = useState<CloudStatus | null>(null)
  const [docker, setDocker] = useState<{ ok: boolean; running: number } | null>(null)

  // One probe at mount; the AI view does its own polling when it is open.
  useEffect(() => {
    let live = true
    void Promise.all([window.nyx.ai.detect(), window.nyx.ai.config()]).then(([backends, cfg]) => {
      if (live) setAi({ backend: backends.find((b) => b.id === cfg.provider) ?? null, model: cfg.model })
    })
    return () => { live = false }
  }, [])

  // Cloud and Docker are probed once at mount; neither connects on its own.
  useEffect(() => {
    let live = true
    void window.nyx.cloud.status().then((s) => { if (live) setCloud(s) }).catch(() => {})
    void window.nyx.docker.available().then(async (a) => {
      const running = a.ok
        ? (await window.nyx.docker.containers()).filter((c) => c.state === 'running').length
        : 0
      if (live) setDocker({ ok: a.ok, running })
    }).catch(() => {})
    return () => { live = false }
  }, [])

  const mine = projects.filter((p) => p.workspaceId === workspaceId)
  const recent = [...mine]
    .sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt))
    .slice(0, 5)

  // Git state is read per project, only for the handful shown here.
  useEffect(() => {
    let live = true
    void Promise.all(
      recent.map(async (p) => [p.id, await window.nyx.projects.git(p.id)] as const),
    ).then((pairs) => { if (live) setGitMap(Object.fromEntries(pairs)) })
    return () => { live = false }
  }, [recent.map((p) => p.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true
    const first = recent[0]
    if (!first) { setEnv([]); return }
    void window.nyx.projects.env(first.id).then((e) => { if (live) setEnv(e) })
    return () => { live = false }
  }, [recent[0]?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const importProject = async () => {
    const p = await window.nyx.projects.import()
    await refreshProjects()
    if (p) openTab('projects')
  }

  const installed = env.filter((t) => t.version)

  return (
    <div className="h-full overflow-y-auto p-5">
      <header className="mb-5">
        <h1 style={{ color: nyx('textPrimary') }} className="text-xl font-semibold tracking-tight">
          Development workspace
        </h1>
        <p style={{ color: nyx('textMuted') }} className="mt-0.5 text-xs">
          {mine.length} {mine.length === 1 ? 'project' : 'projects'} · local-first
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <NyxCard className="xl:col-span-2">
          <NyxCardHeader
            title="Recent projects"
            action={
              <NyxButton size="sm" variant="ghost" icon={<Plus size={13} />} onClick={importProject}>
                Import
              </NyxButton>
            }
          />
          {recent.length === 0 ? (
            <NyxEmptyState
              icon={<FolderGit2 size={28} strokeWidth={1.5} />}
              title="No projects yet"
              description="Import an existing directory. Nyxium detects the stack, Git state and toolchain automatically."
              actions={<NyxButton variant="filled" icon={<Plus size={14} />} onClick={importProject}>Import Project</NyxButton>}
            />
          ) : (
            <ul className="p-2">
              {recent.map((p) => {
                const g = gitTone(gitMap[p.id])
                return (
                  <li key={p.id}>
                    <NyxListItem
                      onClick={() => {
                        void window.nyx.projects.touch(p.id).then(refreshProjects)
                        openTab('projects', { projectId: p.id })
                      }}
                      leading={<FolderGit2 size={16} />}
                      title={p.name}
                      subtitle={p.stack.length ? p.stack.join(' · ') : p.path}
                      trailing={<NyxStatus tone={g.tone}>{g.text}</NyxStatus>}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </NyxCard>

        <NyxCard>
          <NyxCardHeader title="System status" />
          <div className="flex flex-col gap-3 p-3.5">
            <StatusRow
              icon={<Bot size={14} />}
              label="Local AI"
              status={
                !ai ? <NyxStatus tone="idle">Checking…</NyxStatus>
                  : ai.backend?.available
                    ? <NyxStatus tone="success">{ai.backend.label}{ai.model ? ` · ${ai.model}` : ''}</NyxStatus>
                    : <NyxStatus tone="idle">Offline</NyxStatus>
              }
            />
            <StatusRow
              icon={<GitBranch size={14} />}
              label="Git"
              status={
                installed.some((t) => t.name === 'Git')
                  ? <NyxStatus tone="success">Available</NyxStatus>
                  : <NyxStatus tone="idle">Not found</NyxStatus>
              }
            />
            <StatusRow
              icon={<Boxes size={14} />}
              label="Docker"
              status={
                !docker ? <NyxStatus tone="idle">Checking…</NyxStatus>
                  : docker.ok
                    ? <NyxStatus tone="success">{docker.running} running</NyxStatus>
                    : <NyxStatus tone="idle">Not available</NyxStatus>
              }
            />
            <StatusRow
              icon={<Cloud size={14} />}
              label="Cloud Storage"
              status={
                !cloud ? <NyxStatus tone="idle">Checking…</NyxStatus>
                  : cloud.connected
                    ? <NyxStatus tone="success">{cloud.bucket || cloud.project}</NyxStatus>
                    : <NyxStatus tone="idle">Not connected</NyxStatus>
              }
            />
            <StatusRow
              icon={<Palette size={14} />}
              label="Palette"
              status={
                snapshot
                  ? <NyxStatus tone={snapshot.source === 'built-in' ? 'idle' : 'success'}>{snapshot.provider}</NyxStatus>
                  : <NyxStatus tone="idle">—</NyxStatus>
              }
            />
          </div>
        </NyxCard>

        <NyxCard>
          <NyxCardHeader title="Environment" />
          <div className="p-3.5">
            {installed.length === 0 ? (
              <p style={{ color: nyx('textMuted') }} className="text-xs">
                Import a project to probe the local toolchain.
              </p>
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

        <NyxCard>
          <NyxCardHeader title="Recent activity" />
          {notifications.length === 0 ? (
            <p style={{ color: nyx('textMuted') }} className="p-3.5 text-xs">Nothing yet.</p>
          ) : (
            <ul className="p-2">
              {notifications.slice(0, 5).map((n) => (
                <li key={n.id}>
                  <NyxListItem
                    title={n.title}
                    subtitle={n.body}
                    trailing={
                      <span style={{ color: nyx('textMuted') }} className="text-[11px] whitespace-nowrap">
                        {relative(n.at)}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </NyxCard>

        <NyxCard>
          <NyxCardHeader title="Quick actions" />
          <div className="flex flex-wrap gap-2 p-3.5">
            <NyxButton size="sm" icon={<Plus size={13} />} onClick={importProject}>Import Project</NyxButton>
            <NyxButton size="sm" variant="outline" icon={<Bot size={13} />} onClick={() => openTab('ai')}>AI Agent</NyxButton>
            <NyxButton size="sm" variant="outline" icon={<TerminalSquare size={13} />} onClick={() => openTab('terminal')}>Terminal</NyxButton>
            <NyxButton size="sm" variant="outline" icon={<Upload size={13} />} onClick={() => openTab('cloud')}>Cloud</NyxButton>
          </div>
          <div className="px-3.5 pb-3.5">
            <div className="flex flex-wrap gap-1.5">
              {providers.filter((p) => p.available).map((p) => (
                <NyxChip key={p.id} tone="accent">{p.id}</NyxChip>
              ))}
              {providers.every((p) => !p.available) ? (
                <span style={{ color: nyx('textMuted') }} className="text-xs">
                  No dynamic palette provider detected
                </span>
              ) : null}
            </div>
          </div>
        </NyxCard>
      </div>
    </div>
  )
}

function StatusRow({ icon, label, status }: { icon: React.ReactNode; label: string; status: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: nyx('textSecondary') }} className="flex items-center gap-2 text-xs">
        <span style={{ color: nyx('textMuted') }}>{icon}</span>
        {label}
      </span>
      {status}
    </div>
  )
}
