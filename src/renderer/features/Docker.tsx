import { useCallback, useEffect, useState } from 'react'
import {
  Boxes, Play, RefreshCw, RotateCw, ScrollText, Square, TerminalSquare, Trash2, X,
} from 'lucide-react'
import type {
  DockerContainer, DockerImage, DockerNetwork, DockerVolume,
} from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxEmptyState, NyxIconButton, NyxPermissionDialog, NyxStatus,
} from '../components/nyx'

type Tab = 'containers' | 'images' | 'volumes' | 'networks'

export function Docker() {
  const openTab = useStore((s) => s.openTab)
  const [tab, setTab] = useState<Tab>('containers')
  const [status, setStatus] = useState<{ ok: boolean; detail: string | null } | null>(null)
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [images, setImages] = useState<DockerImage[]>([])
  const [volumes, setVolumes] = useState<DockerVolume[]>([])
  const [networks, setNetworks] = useState<DockerNetwork[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(null)
  const [confirm, setConfirm] = useState<
    { title: string; detail: string; run: () => Promise<unknown> } | null
  >(null)

  const load = useCallback(async () => {
    setBusy(true)
    const s = await window.nyx.docker.available()
    setStatus(s)
    if (s.ok) {
      const [c, i, v, n] = await Promise.all([
        window.nyx.docker.containers(),
        window.nyx.docker.images(),
        window.nyx.docker.volumes(),
        window.nyx.docker.networks(),
      ])
      setContainers(c); setImages(i); setVolumes(v); setNetworks(n)
    }
    setBusy(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Docker command failed') }
    await load()
  }

  if (status && !status.ok) {
    return (
      <NyxEmptyState
        icon={<Boxes size={30} strokeWidth={1.4} />}
        title="Docker is not available"
        description={status.detail ?? 'No Docker daemon is reachable from this machine.'}
        actions={
          <NyxButton variant="filled" icon={<RefreshCw size={13} />} onClick={() => void load()}>
            Check again
          </NyxButton>
        }
      />
    )
  }

  const running = containers.filter((c) => c.state === 'running').length

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        style={{ borderColor: nyx('outlineVariant') }}
        className="flex h-11 shrink-0 items-center gap-3 border-b px-4"
      >
        <Boxes size={15} style={{ color: nyx('textMuted') }} />
        <NyxStatus tone={running ? 'success' : 'idle'}>
          {running} running · {containers.length} total
        </NyxStatus>
        <div className="ml-4 flex gap-1">
          {(['containers', 'images', 'volumes', 'networks'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? nyx('primaryContainer') : 'transparent',
                color: tab === t ? nyx('onPrimaryContainer') : nyx('textMuted'),
              }}
              className="h-7 rounded-lg px-3 text-[11px] capitalize"
            >
              {t}
            </button>
          ))}
        </div>
        <NyxIconButton
          label="Refresh"
          className="ml-auto"
          icon={<RefreshCw size={14} className={busy ? 'animate-spin' : ''} />}
          onClick={() => void load()}
        />
      </header>

      {error ? (
        <div
          style={{ background: nyx('errorContainer'), color: nyx('error') }}
          className="flex shrink-0 items-start gap-2 px-4 py-2 font-mono text-[11px]"
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {tab === 'containers' ? (
          containers.length ? (
            <ul>
              {containers.map((c) => (
                <li key={c.id} className="group flex items-center gap-3 rounded-lg px-2.5 py-2">
                  <NyxStatus tone={c.state === 'running' ? 'success' : 'idle'} />
                  <div className="min-w-0 flex-1">
                    <div style={{ color: nyx('textPrimary') }} className="truncate text-sm">{c.name}</div>
                    <div style={{ color: nyx('textMuted') }} className="truncate font-mono text-[11px]">
                      {c.image} · {c.status}{c.ports.length ? ` · ${c.ports.join(', ')}` : ''}
                    </div>
                  </div>
                  <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                    {c.state === 'running' ? (
                      <>
                        <NyxIconButton label="Stop" icon={<Square size={13} />}
                          onClick={() => void act(() => window.nyx.docker.stop(c.id))} />
                        <NyxIconButton label="Restart" icon={<RotateCw size={13} />}
                          onClick={() => void act(() => window.nyx.docker.restart(c.id))} />
                        <NyxIconButton
                          label="Open a shell in this container"
                          icon={<TerminalSquare size={13} />}
                          onClick={async () => {
                            const cmd = await window.nyx.docker.shellCommand(c.id)
                            await window.nyx.snippets.copy(cmd)
                            openTab('terminal')
                            setError(`Shell command copied to the clipboard — paste it in the terminal:\n${cmd}`)
                          }}
                        />
                      </>
                    ) : (
                      <NyxIconButton label="Start" icon={<Play size={13} />}
                        onClick={() => void act(() => window.nyx.docker.start(c.id))} />
                    )}
                    <NyxIconButton
                      label="Logs"
                      icon={<ScrollText size={13} />}
                      onClick={async () => setLogs({ name: c.name, text: await window.nyx.docker.logs(c.id) })}
                    />
                    <NyxIconButton
                      label="Remove"
                      icon={<Trash2 size={13} />}
                      onClick={() => setConfirm({
                        title: 'Remove this container?',
                        detail: `${c.name} (${c.image}) will be force-removed. Any data not in a volume is lost.`,
                        run: () => window.nyx.docker.removeContainer(c.id),
                      })}
                    />
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty>No containers.</Empty>
        ) : null}

        {tab === 'images' ? (
          images.length ? (
            <ul>
              {images.map((i) => (
                <li key={i.id + i.tag} className="group flex items-center gap-3 rounded-lg px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div style={{ color: nyx('textPrimary') }} className="truncate font-mono text-xs">
                      {i.repository}:{i.tag}
                    </div>
                    <div style={{ color: nyx('textMuted') }} className="text-[11px]">{i.createdAt}</div>
                  </div>
                  <span style={{ color: nyx('textSecondary') }} className="shrink-0 font-mono text-[11px]">{i.size}</span>
                  <NyxIconButton
                    label="Remove image"
                    className="opacity-0 group-hover:opacity-100"
                    icon={<Trash2 size={13} />}
                    onClick={() => setConfirm({
                      title: 'Remove this image?',
                      detail: `${i.repository}:${i.tag} will be force-removed. Containers using it must be removed first.`,
                      run: () => window.nyx.docker.removeImage(i.id),
                    })}
                  />
                </li>
              ))}
            </ul>
          ) : <Empty>No images.</Empty>
        ) : null}

        {tab === 'volumes' ? (
          volumes.length ? (
            <ul>
              {volumes.map((v) => (
                <li key={v.name} className="group flex items-center gap-3 rounded-lg px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div style={{ color: nyx('textPrimary') }} className="truncate font-mono text-xs">{v.name}</div>
                    <div style={{ color: nyx('textMuted') }} className="truncate text-[11px]">
                      {v.driver}{v.mountpoint ? ` · ${v.mountpoint}` : ''}
                    </div>
                  </div>
                  <NyxIconButton
                    label="Remove volume"
                    className="opacity-0 group-hover:opacity-100"
                    icon={<Trash2 size={13} />}
                    onClick={() => setConfirm({
                      title: 'Remove this volume?',
                      detail: `${v.name} and every byte of data in it will be deleted permanently.`,
                      run: () => window.nyx.docker.removeVolume(v.name),
                    })}
                  />
                </li>
              ))}
            </ul>
          ) : <Empty>No volumes.</Empty>
        ) : null}

        {tab === 'networks' ? (
          networks.length ? (
            <ul>
              {networks.map((n) => (
                <li key={n.id} className="flex items-center gap-3 rounded-lg px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div style={{ color: nyx('textPrimary') }} className="truncate font-mono text-xs">{n.name}</div>
                    <div style={{ color: nyx('textMuted') }} className="text-[11px]">{n.driver} · {n.scope}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>No networks.</Empty>
        ) : null}
      </div>

      {logs ? (
        <div
          style={{ borderColor: nyx('outlineVariant'), background: nyx('codeBackground') }}
          className="flex max-h-[45%] shrink-0 flex-col border-t"
        >
          <div className="flex h-9 shrink-0 items-center gap-2 px-4">
            <ScrollText size={13} style={{ color: nyx('textMuted') }} />
            <span style={{ color: nyx('textPrimary') }} className="font-mono text-[11px]">{logs.name}</span>
            <NyxIconButton label="Close logs" className="ml-auto" icon={<X size={13} />} onClick={() => setLogs(null)} />
          </div>
          <pre
            style={{ color: nyx('codeForeground') }}
            className="min-h-0 flex-1 overflow-auto px-4 pb-3 font-mono text-[11px] whitespace-pre-wrap"
          >
            {logs.text || '(no output)'}
          </pre>
        </div>
      ) : null}

      <NyxPermissionDialog
        open={!!confirm}
        danger
        title={confirm?.title ?? ''}
        confirmLabel="Remove"
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
  return <p style={{ color: nyx('textMuted') }} className="px-3 py-8 text-center text-xs">{children}</p>
}
