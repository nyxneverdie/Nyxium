import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, ExternalLink, LogOut, MoreVertical, Pin, RotateCw, Trash2, X,
} from 'lucide-react'
import type { ServiceEntry, WebviewState } from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import { NyxIconButton, NyxPermissionDialog } from '../components/nyx'

/**
 * Host for one embedded service. The page itself is a WebContentsView owned by
 * the main process; this component only reserves the rectangle it occupies and
 * drives the toolbar. The view is hidden whenever this tab is not on screen.
 */
export function ServiceView({ service, visible }: { service: ServiceEntry; visible: boolean }) {
  const slot = useRef<HTMLDivElement>(null)
  const refreshServices = useStore((s) => s.refreshServices)
  const closeTab = useStore((s) => s.closeTab)
  const activeTabId = useStore((s) => s.activeTabId)

  const [state, setState] = useState<WebviewState>({ serviceId: service.id, loading: true })
  const [menu, setMenu] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  /** The rectangle the embedded page should occupy, in window coordinates. */
  const bounds = () => {
    const r = slot.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0, width: 1, height: 1 }
    return {
      x: Math.round(r.left), y: Math.round(r.top),
      width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)),
    }
  }

  useEffect(() => window.nyx.webview.onState((s) => {
    if (s.serviceId === service.id) setState((prev) => ({ ...prev, ...s }))
  }), [service.id])

  useEffect(() => {
    void window.nyx.webview.open(service.id, service.url, bounds())
    // The view belongs to the tab; closing the tab tears it down.
    return () => window.nyx.webview.close(service.id)
  }, [service.id, service.url]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the native view aligned with this element through resizes and layout
  // changes, and suspend it whenever the tab is not the visible one.
  useLayoutEffect(() => {
    if (!visible) { window.nyx.webview.showOnly(null); return }
    const sync = () => window.nyx.webview.showOnly(service.id, bounds())
    sync()
    const ro = new ResizeObserver(sync)
    if (slot.current) ro.observe(slot.current)
    window.addEventListener('resize', sync)
    return () => { ro.disconnect(); window.removeEventListener('resize', sync) }
  }, [visible, service.id, activeTabId])

  return (
    <div className="flex h-full flex-col">
      <div
        style={{ borderColor: nyx('outlineVariant'), background: nyx('surface') }}
        className="relative flex h-10 shrink-0 items-center gap-1 border-b px-2"
      >
        <NyxIconButton
          label="Back" icon={<ArrowLeft size={15} />}
          disabled={!state.canGoBack}
          onClick={() => window.nyx.webview.back(service.id)}
        />
        <NyxIconButton
          label="Forward" icon={<ArrowRight size={15} />}
          disabled={!state.canGoForward}
          onClick={() => window.nyx.webview.forward(service.id)}
        />
        <NyxIconButton
          label="Reload"
          icon={<RotateCw size={14} className={state.loading ? 'animate-spin' : ''} />}
          onClick={() => window.nyx.webview.reload(service.id)}
        />

        <div className="mx-2 flex min-w-0 flex-1 items-center gap-2">
          <span style={{ color: nyx('textPrimary') }} className="shrink-0 text-xs font-medium">
            {service.name}
          </span>
          <span style={{ color: nyx('textMuted') }} className="min-w-0 truncate font-mono text-[11px]">
            {state.url ?? service.url}
          </span>
        </div>

        <NyxIconButton
          label="Open in browser" icon={<ExternalLink size={14} />}
          onClick={() => void window.nyx.services.openExternal(state.url ?? service.url)}
        />
        <NyxIconButton label="Service menu" icon={<MoreVertical size={15} />} onClick={() => setMenu((m) => !m)} />

        {menu ? (
          <div
            style={{ background: nyx('surfaceElevated'), borderColor: nyx('outline') }}
            className="absolute top-10 right-2 z-30 w-52 rounded-xl border py-1 shadow-2xl"
            onMouseLeave={() => setMenu(false)}
          >
            <MenuItem
              icon={<Pin size={13} />}
              label={service.pinned ? 'Unpin service' : 'Pin service'}
              onClick={async () => {
                setMenu(false)
                // Pinning is stored on the service, not on the tab.
                await window.nyx.services.add({
                  ...service, pinned: !service.pinned,
                } as Omit<ServiceEntry, 'id' | 'builtin'>)
                await refreshServices()
              }}
            />
            <MenuItem
              icon={<LogOut size={13} />}
              label="Sign out / clear session"
              onClick={() => { setMenu(false); setConfirmSignOut(true) }}
            />
            {!service.builtin ? (
              <MenuItem
                icon={<Trash2 size={13} />}
                label="Remove service"
                danger
                onClick={async () => {
                  setMenu(false)
                  await window.nyx.services.remove(service.id)
                  await refreshServices()
                  closeTab(activeTabId)
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {state.error ? (
        <div
          style={{ background: nyx('errorContainer'), color: nyx('error') }}
          className="flex shrink-0 items-start gap-2 px-4 py-2 text-xs"
        >
          <span className="min-w-0 flex-1">
            Could not load {service.name}: {state.error}
          </span>
          <button onClick={() => setState((s) => ({ ...s, error: undefined }))} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ) : null}

      {/* The embedded page is painted over this element by the main process. */}
      <div ref={slot} style={{ background: nyx('background') }} className="min-h-0 flex-1" />

      <NyxPermissionDialog
        open={confirmSignOut}
        danger
        title={`Clear the session for ${service.name}?`}
        confirmLabel="Clear session"
        detail={
          <>
            <p>Cookies, local storage and login state for {service.name} are deleted.</p>
            <p className="mt-2">Other services keep their own sessions — each one is isolated.</p>
          </>
        }
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          setConfirmSignOut(false)
          await window.nyx.webview.clearSession(service.id)
          await window.nyx.webview.open(service.id, service.url, {
            x: 0, y: 0, width: 1, height: 1,
          })
          window.nyx.webview.showOnly(service.id, {
            x: Math.round(slot.current?.getBoundingClientRect().left ?? 0),
            y: Math.round(slot.current?.getBoundingClientRect().top ?? 0),
            width: Math.max(1, Math.round(slot.current?.getBoundingClientRect().width ?? 1)),
            height: Math.max(1, Math.round(slot.current?.getBoundingClientRect().height ?? 1)),
          })
        }}
      />
    </div>
  )
}

function MenuItem({
  icon, label, onClick, danger,
}: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ color: danger ? nyx('error') : nyx('textSecondary') }}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:brightness-150"
    >
      {icon}
      {label}
    </button>
  )
}
