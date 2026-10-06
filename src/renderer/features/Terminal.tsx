import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { ShellInfo } from '../../shared/types'
import { nyx, usePalette } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import { NyxIconButton } from '../components/nyx'

interface Pane { key: string; shell: string; label: string }

const newKey = () => Math.random().toString(36).slice(2, 9)

/** One PTY per pane, created lazily when the pane first mounts. Hidden panes
 *  stay mounted so scrollback survives tab switching. */
export function Terminal({ projectId }: { projectId: string | null }) {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId) ?? null)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [panes, setPanes] = useState<Pane[]>([])
  const [activeKey, setActiveKey] = useState<string>('')

  useEffect(() => {
    void window.nyx.terminal.shells().then((list) => {
      setShells(list)
      if (list[0]) {
        const first = { key: newKey(), shell: list[0].path, label: list[0].name }
        setPanes([first])
        setActiveKey(first.key)
      }
    })
  }, [])

  const addPane = (shell: string) => {
    const name = shells.find((s) => s.path === shell)?.name ?? 'shell'
    const pane = { key: newKey(), shell, label: name }
    setPanes((p) => [...p, pane])
    setActiveKey(pane.key)
  }

  const closePane = (key: string) => {
    setPanes((prev) => {
      const next = prev.filter((p) => p.key !== key)
      if (key === activeKey) setActiveKey(next[next.length - 1]?.key ?? '')
      return next
    })
  }

  if (!shells.length) {
    return (
      <div style={{ color: nyx('textMuted') }} className="flex h-full items-center justify-center text-xs">
        No usable shell found on this system.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div
        style={{ borderColor: nyx('outlineVariant') }}
        className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-2"
      >
        {panes.map((p) => (
          <div
            key={p.key}
            style={{
              background: p.key === activeKey ? nyx('surfaceElevated') : 'transparent',
              color: p.key === activeKey ? nyx('textPrimary') : nyx('textMuted'),
            }}
            className="group flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs"
          >
            <button onClick={() => setActiveKey(p.key)}>{p.label}</button>
            <button
              onClick={() => closePane(p.key)}
              aria-label={`Close ${p.label}`}
              className="opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <NyxIconButton
          label="New terminal"
          icon={<Plus size={14} />}
          onClick={() => addPane(shells[0].path)}
        />
        {shells.length > 1 ? (
          <select
            value=""
            onChange={(e) => { if (e.target.value) addPane(e.target.value) }}
            aria-label="New terminal with shell"
            style={{ background: nyx('surfaceVariant'), color: nyx('textSecondary'), borderColor: nyx('outlineVariant') }}
            className="h-6 rounded-md border px-1 text-[11px] outline-none"
          >
            <option value="">shell…</option>
            {shells.map((s) => <option key={s.path} value={s.path}>{s.name}</option>)}
          </select>
        ) : null}
        <span style={{ color: nyx('textMuted') }} className="ml-auto shrink-0 truncate pl-3 font-mono text-[11px]">
          {project ? project.path : '~'}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {panes.map((p) => (
          <TerminalPane
            key={p.key}
            visible={p.key === activeKey}
            shell={p.shell}
            cwd={project?.path}
            onExit={() => closePane(p.key)}
          />
        ))}
      </div>
    </div>
  )
}

function TerminalPane({
  visible, shell, cwd, onExit,
}: { visible: boolean; shell: string; cwd?: string; onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Xterm | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const sessionId = useRef<string | null>(null)
  const { snapshot } = usePalette()
  const fontSize = useStore((s) => s.config.terminal.fontSize)
  const fontFamily = useStore((s) => s.config.terminal.fontFamily)

  useEffect(() => {
    if (!host.current) return
    const x = new Xterm({
      fontSize,
      fontFamily,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    })
    const f = new FitAddon()
    x.loadAddon(f)
    x.loadAddon(new WebLinksAddon())
    x.open(host.current)
    term.current = x
    fit.current = f

    let disposed = false
    let offData: (() => void) | null = null
    let offExit: (() => void) | null = null

    void (async () => {
      f.fit()
      const s = await window.nyx.terminal.create({ shell, cwd, cols: x.cols, rows: x.rows })
      if (disposed) { window.nyx.terminal.kill(s.id); return }
      sessionId.current = s.id
      offData = window.nyx.terminal.onData((e) => { if (e.id === s.id) x.write(e.data) })
      offExit = window.nyx.terminal.onExit((e) => { if (e.id === s.id) onExit() })
      x.onData((d) => window.nyx.terminal.write(s.id, d))
      x.onResize(({ cols, rows }) => window.nyx.terminal.resize(s.id, cols, rows))
    })()

    const ro = new ResizeObserver(() => { try { f.fit() } catch { /* detached */ } })
    ro.observe(host.current)

    return () => {
      disposed = true
      ro.disconnect()
      offData?.()
      offExit?.()
      if (sessionId.current) window.nyx.terminal.kill(sessionId.current)
      x.dispose()
    }
    // Session identity is fixed for a pane's lifetime; font/palette are applied separately.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The terminal inherits the live Nyxium palette.
  useEffect(() => {
    const x = term.current
    if (!x || !snapshot) return
    const c = snapshot.colors
    x.options.theme = {
      background: c.terminalBackground,
      foreground: c.terminalForeground,
      cursor: c.primary,
      cursorAccent: c.terminalBackground,
      selectionBackground: c.selection,
      black: c.terminalBackground,
      red: c.error,
      green: c.success,
      yellow: c.warning,
      blue: c.primary,
      magenta: c.tertiary,
      cyan: c.info,
      white: c.textSecondary,
      brightBlack: c.textMuted,
      brightRed: c.error,
      brightGreen: c.success,
      brightYellow: c.warning,
      brightBlue: c.primary,
      brightMagenta: c.tertiary,
      brightCyan: c.info,
      brightWhite: c.textPrimary,
    }
  }, [snapshot])

  useEffect(() => {
    const x = term.current
    if (!x) return
    x.options.fontSize = fontSize
    x.options.fontFamily = fontFamily
    try { fit.current?.fit() } catch { /* not laid out yet */ }
  }, [fontSize, fontFamily])

  // Refit on becoming visible — a hidden pane has no measurable size.
  useLayoutEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => {
      try { fit.current?.fit() } catch { /* detached */ }
      term.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  return (
    <div
      ref={host}
      style={{ background: nyx('terminalBackground'), visibility: visible ? 'visible' : 'hidden' }}
      className="absolute inset-0 p-2"
    />
  )
}
