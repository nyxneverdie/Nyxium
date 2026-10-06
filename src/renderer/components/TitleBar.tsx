import { Minus, Square, X } from 'lucide-react'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import { NyxIconButton } from './nyx'
import { Brand } from './Brand'

/** Frameless window chrome. The drag region is the whole strip minus the controls. */
export function TitleBar() {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.config.activeWorkspaceId)
  const patchConfig = useStore((s) => s.patchConfig)

  return (
    <header
      style={{ background: nyx('surface'), borderColor: nyx('outlineVariant') }}
      className="flex h-11 shrink-0 items-center justify-between border-b pr-1.5"
    >
      <div className="flex min-w-0 items-center">
        <Brand />
        <div
          style={{ borderColor: nyx('outlineVariant') }}
          className="ml-1 flex items-center gap-2 border-l pl-3"
        >
          <span
            style={{ color: nyx('textMuted') }}
            className="hidden text-[11px] tracking-wider uppercase lg:inline"
          >
            Workspace
          </span>
          <select
            value={activeWorkspaceId}
            onChange={(e) => void patchConfig({ activeWorkspaceId: e.target.value })}
            style={{ background: nyx('surfaceVariant'), color: nyx('textSecondary'), borderColor: nyx('outlineVariant') }}
            aria-label="Active workspace"
            className="h-6 max-w-32 rounded-md border px-1.5 text-xs outline-none"
          >
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      {/* Draggable filler */}
      <div className="h-full flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <div className="flex items-center gap-0.5">
        <NyxIconButton label="Minimize" icon={<Minus size={14} />} onClick={() => window.nyx.window.minimize()} />
        <NyxIconButton label="Maximize" icon={<Square size={12} />} onClick={() => window.nyx.window.toggleMaximize()} />
        <NyxIconButton label="Close" icon={<X size={15} />} onClick={() => window.nyx.window.close()} />
      </div>
    </header>
  )
}
