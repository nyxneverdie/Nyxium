import { Pin, Plus } from 'lucide-react'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import { NyxIconButton, NyxTab } from './nyx'

export function TabStrip() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const { setActiveTab, closeTab, togglePin, openTab } = useStore.getState()

  return (
    <div
      style={{ background: nyx('background'), borderColor: nyx('outlineVariant') }}
      className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b px-2"
    >
      {tabs.map((t) => (
        <div key={t.id} className="group/tab flex items-center">
          <NyxTab
            active={t.id === activeTabId}
            onClick={() => setActiveTab(t.id)}
            onClose={t.pinned ? undefined : () => closeTab(t.id)}
          >
            {t.pinned ? <Pin size={10} className="mr-1 inline opacity-60" /> : null}
            {t.title}
          </NyxTab>
          <button
            onClick={() => togglePin(t.id)}
            aria-label={t.pinned ? 'Unpin tab' : 'Pin tab'}
            title={t.pinned ? 'Unpin tab' : 'Pin tab'}
            style={{ color: nyx('textMuted') }}
            className="ml-0.5 opacity-0 transition-opacity group-hover/tab:opacity-70 hover:!opacity-100"
          >
            <Pin size={11} />
          </button>
        </div>
      ))}
      <NyxIconButton label="New tab" icon={<Plus size={15} />} onClick={() => openTab('projects')} />
    </div>
  )
}
