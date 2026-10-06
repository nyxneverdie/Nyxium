import { useMemo, useState } from 'react'
import { ExternalLink, Globe, Pin, Plus, Trash2 } from 'lucide-react'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxCard, NyxDialog, NyxIconButton, NyxSearch, NyxTextField,
} from '../components/nyx'

/** Each service opens in its own WebContentsView with a persistent session
 *  partition, so logins survive restarts and no service can see another's. */
export function Services() {
  const services = useStore((s) => s.services)
  const refreshServices = useStore((s) => s.refreshServices)
  const openTab = useStore((s) => s.openTab)

  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', url: '' })
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return services.filter((s) => !q || s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q))
  }, [services, query])

  const submit = async () => {
    setError(null)
    try {
      await window.nyx.services.add({
        name: form.name.trim(),
        url: form.url.trim(),
        icon: null, projectId: null, workspaceId: null, pinned: false,
      })
      await refreshServices()
      setForm({ name: '', url: '' })
      setAdding(false)
    } catch {
      setError('Enter a name and a valid http(s) URL.')
    }
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 style={{ color: nyx('textPrimary') }} className="text-xl font-semibold tracking-tight">Services</h1>
          <p style={{ color: nyx('textMuted') }} className="mt-0.5 text-xs">
            Each opens embedded, in its own isolated session. Embedded sites never reach Nyxium's local tools.
          </p>
        </div>
        <NyxButton icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add Service</NyxButton>
      </header>

      <div className="mb-4 max-w-sm">
        <NyxSearch value={query} onValueChange={setQuery} placeholder="Filter services…" />
      </div>

      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {filtered.map((s) => (
          <li key={s.id}>
            <NyxCard className="group flex h-full items-center gap-3 p-3">
              <span
                style={{ background: nyx('surfaceVariant'), color: nyx('primary') }}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg"
              >
                <Globe size={16} />
              </span>
              <button
                onClick={() => openTab('services', { serviceId: s.id, title: s.name })}
                className="min-w-0 flex-1 text-left"
              >
                <div style={{ color: nyx('textPrimary') }} className="truncate text-sm">{s.name}</div>
                <div style={{ color: nyx('textMuted') }} className="truncate text-[11px]">
                  {new URL(s.url).host}
                </div>
              </button>
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {s.pinned ? <Pin size={12} style={{ color: nyx('primary') }} /> : null}
                <NyxIconButton
                  label={`Open ${s.name} in your browser`}
                  icon={<ExternalLink size={14} />}
                  onClick={() => void window.nyx.services.openExternal(s.url)}
                />
                {s.builtin ? null : (
                  <NyxIconButton
                    label={`Remove ${s.name}`}
                    icon={<Trash2 size={14} />}
                    onClick={() => void window.nyx.services.remove(s.id).then(refreshServices)}
                  />
                )}
              </div>
            </NyxCard>
          </li>
        ))}
      </ul>

      <NyxDialog
        open={adding}
        title="Add service"
        onClose={() => setAdding(false)}
        footer={
          <>
            <NyxButton variant="ghost" onClick={() => setAdding(false)}>Cancel</NyxButton>
            <NyxButton variant="filled" onClick={() => void submit()}>Add</NyxButton>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <NyxTextField
            label="Name"
            value={form.name}
            placeholder="Internal Dashboard"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <NyxTextField
            label="URL"
            value={form.url}
            placeholder="https://example.com"
            hint="Only http and https are accepted."
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
          {error ? <p style={{ color: nyx('error') }} className="text-xs">{error}</p> : null}
        </div>
      </NyxDialog>
    </div>
  )
}
