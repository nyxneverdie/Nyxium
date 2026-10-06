import {
  Bell, Bot, Boxes, Cloud, Database, FolderGit2, GitBranch, Globe, LayoutDashboard,
  PanelLeftClose, PanelLeftOpen, Scissors, Settings, TerminalSquare, Webhook,
  type LucideIcon,
} from 'lucide-react'
import type { ViewId } from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useActiveTab, useStore } from '../state/store'
import { NyxTooltip } from './nyx'

interface NavItem { view: ViewId; label: string; icon: LucideIcon }

const SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Home',
    items: [
      { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { view: 'projects', label: 'Projects', icon: FolderGit2 },
      { view: 'services', label: 'Services', icon: Globe },
    ],
  },
  {
    label: 'Development',
    items: [
      { view: 'ai', label: 'AI Agent', icon: Bot },
      { view: 'terminal', label: 'Terminal', icon: TerminalSquare },
      { view: 'git', label: 'Git', icon: GitBranch },
      { view: 'database', label: 'Database', icon: Database },
      { view: 'docker', label: 'Docker', icon: Boxes },
      { view: 'snippets', label: 'Snippets', icon: Scissors },
      { view: 'api', label: 'API Playground', icon: Webhook },
    ],
  },
  { label: 'Cloud', items: [{ view: 'cloud', label: 'Cloud Storage', icon: Cloud }] },
  {
    label: 'System',
    items: [
      { view: 'notifications', label: 'Notifications', icon: Bell },
      { view: 'settings', label: 'Settings', icon: Settings },
    ],
  },
]

export function Sidebar({ forceCollapsed }: { forceCollapsed?: boolean }) {
  const preference = useStore((s) => s.config.sidebarCollapsed)
  const collapsed = forceCollapsed || preference
  const patchConfig = useStore((s) => s.patchConfig)
  const openTab = useStore((s) => s.openTab)
  const unread = useStore((s) => s.notifications.filter((n) => !n.read).length)
  const active = useActiveTab()

  return (
    <nav
      aria-label="Primary"
      style={{ background: nyx('surface'), borderColor: nyx('outlineVariant'), width: collapsed ? 76 : 250 }}
      className="flex shrink-0 flex-col border-r transition-[width] duration-200"
    >
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {SECTIONS.map((section) => (
          <div key={section.label} className="mb-3">
            {collapsed ? (
              <div style={{ background: nyx('outlineVariant') }} className="mx-auto mb-2 h-px w-8" />
            ) : (
              <h2
                style={{ color: nyx('textMuted') }}
                className="mb-1 px-2 text-[10px] font-semibold tracking-[0.12em] uppercase"
              >
                {section.label}
              </h2>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map(({ view, label, icon: Icon }) => {
                const selected = active.view === view
                const badge = view === 'notifications' && unread > 0 ? unread : null
                const button = (
                  <button
                    onClick={() => openTab(view)}
                    aria-current={selected ? 'page' : undefined}
                    style={{
                      background: selected ? nyx('primaryContainer') : 'transparent',
                      color: selected ? nyx('onPrimaryContainer') : nyx('textSecondary'),
                    }}
                    className={`flex h-9 w-full items-center gap-3 rounded-full text-sm transition-colors
                                duration-150 hover:brightness-125
                                ${collapsed ? 'justify-center px-0' : 'px-3'}`}
                  >
                    <Icon size={17} strokeWidth={selected ? 2.2 : 1.8} className="shrink-0" />
                    {collapsed ? null : <span className="flex-1 truncate text-left">{label}</span>}
                    {badge !== null && !collapsed ? (
                      <span
                        style={{ background: nyx('primary'), color: nyx('onPrimary') }}
                        className="rounded-full px-1.5 text-[10px] font-semibold"
                      >
                        {badge}
                      </span>
                    ) : null}
                    {badge !== null && collapsed ? (
                      <span style={{ background: nyx('primary') }} className="absolute top-1.5 right-4 size-1.5 rounded-full" />
                    ) : null}
                  </button>
                )
                return (
                  <li key={view} className="relative">
                    {collapsed ? <NyxTooltip text={label}>{button}</NyxTooltip> : button}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div style={{ borderColor: nyx('outlineVariant') }} className="border-t p-3">
        <button
          disabled={forceCollapsed}
          title={forceCollapsed ? 'The window is too narrow for the expanded sidebar' : undefined}
          onClick={() => void patchConfig({ sidebarCollapsed: !preference })}
          style={{ color: nyx('textMuted') }}
          className={`flex h-8 w-full items-center gap-2 rounded-lg text-xs hover:brightness-150
                      ${collapsed ? 'justify-center' : 'px-2'}`}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /> Collapse</>}
        </button>
      </div>
    </nav>
  )
}
