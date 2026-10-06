import { useCallback, useEffect, useState } from 'react'
import { NyxiumMark } from './components/Brand'
import { CommandPalette, type PaletteMode } from './components/CommandPalette'
import { Sidebar } from './components/Sidebar'
import { TabStrip } from './components/TabStrip'
import { TitleBar } from './components/TitleBar'
import { ViewRouter } from './features'
import { useShortcuts } from './lib/useShortcuts'
import { nyx } from './palette/PaletteProvider'
import { useActiveTab, useStore, VIEW_TITLES } from './state/store'
import type { ViewId } from '../shared/types'

const DENSITY_SCALE = { compact: 0.9, comfortable: 1, spacious: 1.12 }

export function App() {
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)
  const config = useStore((s) => s.config)
  const refreshNotifications = useStore((s) => s.refreshNotifications)
  const tab = useActiveTab()
  const tabs = useStore((s) => s.tabs)

  const [palette, setPalette] = useState<{ open: boolean; mode: PaletteMode }>({ open: false, mode: 'commands' })
  const openPalette = useCallback((mode: PaletteMode) => setPalette({ open: true, mode }), [])
  useShortcuts(openPalette)

  useEffect(() => {
    void init().then(() => {
      // #<view> in the URL opens that view directly (used by the smoke capture).
      const v = location.hash.slice(1)
      if (v && v in VIEW_TITLES) useStore.getState().openTab(v as ViewId)
    })
  }, [init])

  // Main-process notifications arrive after init; pick them up once.
  useEffect(() => {
    if (!ready) return
    return window.nyx.notifications.onNew(() => void refreshNotifications())
  }, [ready, refreshNotifications])

  // Below ~1100px the sidebar costs more than it gives; collapse it without
  // touching the user's saved preference, and restore when there is room again.
  const [narrow, setNarrow] = useState(window.innerWidth < 1100)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1100)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.reducedMotion = String(config.reducedMotion)
    root.style.setProperty('--nyx-density', String(DENSITY_SCALE[config.density]))
    root.style.fontSize = `${14 * DENSITY_SCALE[config.density]}px`
  }, [config.reducedMotion, config.density])

  if (!ready) {
    return (
      <div
        style={{ background: nyx('background'), color: nyx('textMuted') }}
        className="flex h-full flex-col items-center justify-center gap-3"
      >
        <NyxiumMark size={34} />
        <span className="text-xs">Starting Nyxium…</span>
      </div>
    )
  }

  return (
    <div style={{ background: nyx('background') }} className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar forceCollapsed={narrow} />
        <main className="flex min-w-0 flex-1 flex-col">
          <TabStrip />
          {/* Service tabs stay mounted while hidden so their session, scroll
              position and any OAuth flow survive a tab switch; everything else
              is unmounted, which is cheaper and loses nothing. */}
          {tabs.filter((t) => t.serviceId).map((t) => (
            <div
              key={t.id}
              className="min-h-0 flex-1 overflow-hidden"
              style={{ display: t.id === tab.id ? undefined : 'none' }}
            >
              <ViewRouter
                view={t.view}
                projectId={t.projectId}
                serviceId={t.serviceId}
                visible={t.id === tab.id}
              />
            </div>
          ))}
          {!tab.serviceId ? (
            <div key={tab.id} className="nyx-enter min-h-0 flex-1 overflow-hidden">
              <ViewRouter view={tab.view} projectId={tab.projectId} serviceId={tab.serviceId} />
            </div>
          ) : null}
        </main>
      </div>
      <CommandPalette
        open={palette.open}
        mode={palette.mode}
        onClose={() => setPalette((p) => ({ ...p, open: false }))}
      />
    </div>
  )
}
