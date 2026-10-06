import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import type { CodeHit, Snippet, ViewId } from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore, VIEW_TITLES } from '../state/store'
import { usePalette } from '../palette/PaletteProvider'
import { NyxSearch } from './nyx'

export type PaletteMode = 'commands' | 'search'

interface Entry {
  id: string
  label: string
  hint: string
  group: string
  run: () => void
}

/** Subsequence match — "oai" finds "Open AI Agent". Score favours earlier, tighter hits. */
function fuzzy(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let ti = 0
  let score = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    streak = found === ti ? streak + 1 : 0
    score += found - ti - streak
    ti = found + 1
  }
  return score
}

export function CommandPalette({
  open, mode, onClose,
}: { open: boolean; mode: PaletteMode; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const projects = useStore((s) => s.projects)
  const services = useStore((s) => s.services)
  const config = useStore((s) => s.config)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const { reload } = usePalette()

  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [codeHits, setCodeHits] = useState<CodeHit[]>([])

  useEffect(() => { if (open) { setQuery(''); setIndex(0); setCodeHits([]) } }, [open, mode])

  // Snippets are small and local — loaded once per palette opening.
  useEffect(() => {
    if (!open) return
    void window.nyx.snippets.list().then(setSnippets)
  }, [open])

  // Project code search runs in the main process; debounced, and only in search mode
  // with a query long enough to be worth walking the tree for.
  useEffect(() => {
    if (!open || mode !== 'search' || !activeProjectId || query.trim().length < 3) {
      setCodeHits([])
      return
    }
    let live = true
    const t = setTimeout(() => {
      void window.nyx.search.code(activeProjectId, query.trim())
        .then((h) => { if (live) setCodeHits(h.slice(0, 20)) })
        .catch(() => { if (live) setCodeHits([]) })
    }, 220)
    return () => { live = false; clearTimeout(t) }
  }, [open, mode, activeProjectId, query])

  const entries = useMemo<Entry[]>(() => {
    const { openTab, patchConfig, refreshProjects } = useStore.getState()
    const views: ViewId[] = ['dashboard', 'projects', 'services', 'ai', 'terminal', 'git',
      'database', 'docker', 'snippets', 'api', 'cloud', 'notifications', 'settings']

    const commands: Entry[] = [
      ...views.map((v) => ({
        id: `view:${v}`,
        label: `Open ${VIEW_TITLES[v]}`,
        hint: 'View',
        group: 'Navigate',
        run: () => openTab(v),
      })),
      {
        id: 'cmd:import',
        label: 'Import Project',
        hint: 'Choose a directory',
        group: 'Actions',
        run: () => void window.nyx.projects.import().then(() => { void refreshProjects(); openTab('projects') }),
      },
      {
        id: 'cmd:palette',
        label: 'Reload Palette',
        hint: 'Re-read the palette file',
        group: 'Actions',
        run: () => void reload(),
      },
      {
        id: 'cmd:sidebar',
        label: config.sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar',
        hint: 'Ctrl + B',
        group: 'Actions',
        run: () => void patchConfig({ sidebarCollapsed: !config.sidebarCollapsed }),
      },
    ]

    const searchables: Entry[] = [
      ...projects.map((p) => ({
        id: `project:${p.id}`,
        label: p.name,
        hint: p.stack.join(' · ') || p.path,
        group: 'Projects',
        run: () => openTab('projects', { projectId: p.id }),
      })),
      ...services.map((s) => ({
        id: `service:${s.id}`,
        label: s.name,
        hint: new URL(s.url).host,
        group: 'Services',
        run: () => openTab('services', { serviceId: s.id, title: s.name }),
      })),
      ...snippets.map((s) => ({
        id: `snippet:${s.id}`,
        label: s.title,
        hint: `${s.language}${s.tags.length ? ` · ${s.tags.join(', ')}` : ''}`,
        group: 'Snippets',
        run: () => openTab('snippets'),
      })),
    ]

    return mode === 'commands' ? [...commands, ...searchables] : [...searchables, ...commands]
  }, [mode, projects, services, snippets, config.sidebarCollapsed, reload])

  const results = useMemo(() => {
    const scored = entries
      .map((e) => {
        const s = fuzzy(query, `${e.label} ${e.hint}`)
        return s === null ? null : { e, s }
      })
      .filter((x): x is { e: Entry; s: number } => x !== null)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.e)

    const code: Entry[] = codeHits.map((h, i) => ({
      id: `code:${h.path}:${h.line}:${i}`,
      label: `${h.path}:${h.line}`,
      hint: h.text,
      group: 'Code',
      run: () => useStore.getState().openTab('projects', { projectId: activeProjectId }),
    }))

    return [...scored.slice(0, 30), ...code]
  }, [entries, query, codeHits, activeProjectId])

  useEffect(() => { setIndex(0) }, [query])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        results[index]?.run()
        onClose()
      } else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, results, index, onClose])

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 pt-[12vh]"
      style={{ background: 'rgb(0 0 0 / 0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'commands' ? 'Command palette' : 'Global search'}
        style={{ background: nyx('surfaceElevated'), borderColor: nyx('outline') }}
        className="nyx-enter flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
      >
        <div className="p-2.5">
          <NyxSearch
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={mode === 'commands' ? 'Run a command…' : 'Search projects, services, commands…'}
          />
        </div>
        {results.length === 0 ? (
          <p style={{ color: nyx('textMuted') }} className="px-4 pb-4 text-xs">No match.</p>
        ) : (
          <ul ref={listRef} className="max-h-80 overflow-y-auto px-2 pb-2">
            {results.map((e, i) => (
              <li key={e.id}>
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => { e.run(); onClose() }}
                  style={{ background: i === index ? nyx('selection') : 'transparent' }}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left"
                >
                  <span
                    style={{ color: nyx('textMuted') }}
                    className="w-16 shrink-0 text-[10px] tracking-wider uppercase"
                  >
                    {e.group}
                  </span>
                  <span style={{ color: nyx('textPrimary') }} className="min-w-0 flex-1 truncate text-sm">
                    {e.label}
                  </span>
                  <span style={{ color: nyx('textMuted') }} className="max-w-48 truncate text-[11px]">
                    {e.hint}
                  </span>
                  {i === index ? <CornerDownLeft size={12} style={{ color: nyx('textMuted') }} /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
