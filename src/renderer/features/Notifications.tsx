import { useMemo, useState } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import type { NyxNotification } from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import { NyxButton, NyxCard, NyxEmptyState, NyxListItem, NyxStatus } from '../components/nyx'

const SOURCE_TONE = {
  github: 'info', vercel: 'info', git: 'success', docker: 'info',
  ai: 'warning', cloud: 'success', system: 'idle',
} as const

type Source = NyxNotification['source'] | 'all'

export function Notifications() {
  const items = useStore((s) => s.notifications)
  const refresh = useStore((s) => s.refreshNotifications)
  const [source, setSource] = useState<Source>('all')

  // Only offer filters for sources that have actually reported something.
  const sources = useMemo(() => {
    const present = new Set(items.map((n) => n.source))
    return (['all', ...present] as Source[])
  }, [items])

  const filtered = useMemo(
    () => (source === 'all' ? items : items.filter((n) => n.source === source)),
    [items, source],
  )

  if (items.length === 0) {
    return (
      <NyxEmptyState
        icon={<Bell size={28} strokeWidth={1.5} />}
        title="No notifications"
        description="Git, Docker, the AI agent and cloud transfers all report here."
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 style={{ color: nyx('textPrimary') }} className="text-xl font-semibold tracking-tight">Notifications</h1>
          <p style={{ color: nyx('textMuted') }} className="mt-0.5 text-xs">
            {items.filter((n) => !n.read).length} unread of {items.length}
          </p>
        </div>
        <div className="flex gap-2">
          <NyxButton
            size="sm"
            variant="outline"
            icon={<CheckCheck size={13} />}
            onClick={() => void window.nyx.notifications.markAllRead().then(refresh)}
          >
            Mark all read
          </NyxButton>
          <NyxButton
            size="sm"
            variant="ghost"
            icon={<Trash2 size={13} />}
            onClick={() => void window.nyx.notifications.clear().then(refresh)}
          >
            Clear
          </NyxButton>
        </div>
      </header>

      {sources.length > 2 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              aria-pressed={source === s}
              style={{
                background: source === s ? nyx('primaryContainer') : nyx('surfaceVariant'),
                color: source === s ? nyx('onPrimaryContainer') : nyx('textMuted'),
              }}
              className="h-6 rounded-md px-2 text-[11px] capitalize"
            >
              {s}
              {s !== 'all' ? ` (${items.filter((n) => n.source === s).length})` : ''}
            </button>
          ))}
        </div>
      ) : null}

      <NyxCard>
        <ul className="p-2">
          {filtered.map((n) => (
            <li key={n.id}>
              <NyxListItem
                leading={<NyxStatus tone={n.read ? 'idle' : SOURCE_TONE[n.source]} />}
                title={n.title}
                subtitle={n.body}
                trailing={
                  <span style={{ color: nyx('textMuted') }} className="text-[11px] whitespace-nowrap">
                    {n.source} · {new Date(n.at).toLocaleTimeString()}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </NyxCard>
    </div>
  )
}
