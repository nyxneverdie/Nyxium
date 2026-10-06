import { useEffect, useMemo, useState } from 'react'
import { Copy, Plus, Scissors, Star, Trash2 } from 'lucide-react'
import type { Snippet } from '../../shared/types'
import { nyx } from '../palette/PaletteProvider'
import { useStore } from '../state/store'
import {
  NyxButton, NyxChip, NyxEmptyState, NyxIconButton, NyxPermissionDialog, NyxSearch,
} from '../components/nyx'

const LANGUAGES = [
  'bash', 'c', 'cpp', 'rust', 'go', 'javascript', 'typescript', 'python',
  'php', 'laravel', 'sql', 'nix', 'docker', 'git',
] as const

const blank = (): Partial<Snippet> => ({
  title: '', language: 'bash', code: '', tags: [], favorite: false, projectId: null,
})

export function Snippets() {
  const projects = useStore((s) => s.projects)
  const [items, setItems] = useState<Snippet[]>([])
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState<string>('all')
  const [favOnly, setFavOnly] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Snippet>>(blank())
  const [pendingDelete, setPendingDelete] = useState<Snippet | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  // Load once, and open the first snippet so the editor is never blank next to a full list.
  useEffect(() => {
    void window.nyx.snippets.list().then((list) => {
      setItems(list)
      if (list[0]) { setEditingId(list[0].id); setDraft({ ...list[0] }) }
    })
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((s) =>
      (!favOnly || s.favorite) &&
      (lang === 'all' || s.language === lang) &&
      (!q || s.title.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))))
  }, [items, query, lang, favOnly])

  const select = (s: Snippet) => {
    setEditingId(s.id)
    setDraft({ ...s })
  }

  const startNew = () => {
    setEditingId(null)
    setDraft(blank())
  }

  const save = async () => {
    if (!draft.title?.trim() && !draft.code?.trim()) return
    const next = await window.nyx.snippets.save(editingId, {
      ...draft,
      title: draft.title?.trim() || 'Untitled',
    })
    setItems(next)
    if (!editingId) {
      const created = next.find((s) => !items.some((o) => o.id === s.id))
      if (created) setEditingId(created.id)
    }
  }

  const copy = async (s: Snippet) => {
    await window.nyx.snippets.copy(s.code)
    setCopied(s.id)
    setTimeout(() => setCopied(null), 1200)
  }

  const toggleFavorite = async (s: Snippet) => {
    setItems(await window.nyx.snippets.save(s.id, { ...s, favorite: !s.favorite }))
    if (editingId === s.id) setDraft((d) => ({ ...d, favorite: !s.favorite }))
  }

  if (!items.length && editingId === null && !draft.code && !draft.title) {
    return (
      <NyxEmptyState
        icon={<Scissors size={30} strokeWidth={1.4} />}
        title="No snippets yet"
        description="A local library of the commands and fragments you keep retyping. Stored in ~/.config/nyxium/snippets.json."
        actions={
          <NyxButton variant="filled" icon={<Plus size={14} />} onClick={() => setDraft({ ...blank(), title: 'New snippet' })}>
            New Snippet
          </NyxButton>
        }
      />
    )
  }

  return (
    <div className="flex h-full min-w-0">
      <aside style={{ borderColor: nyx('outlineVariant') }} className="flex w-80 shrink-0 flex-col border-r">
        <div className="flex flex-col gap-2 p-3">
          <NyxSearch value={query} onValueChange={setQuery} placeholder="Search snippets…" />
          <div className="flex gap-1.5">
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label="Filter by language"
              style={{ background: nyx('surfaceVariant'), color: nyx('textSecondary'), borderColor: nyx('outlineVariant') }}
              className="h-7 min-w-0 flex-1 rounded-lg border px-1.5 text-[11px] outline-none"
            >
              <option value="all">All languages</option>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <button
              onClick={() => setFavOnly((f) => !f)}
              aria-pressed={favOnly}
              style={{
                background: favOnly ? nyx('primaryContainer') : nyx('surfaceVariant'),
                color: favOnly ? nyx('onPrimaryContainer') : nyx('textMuted'),
              }}
              className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px]"
            >
              <Star size={11} /> Favorites
            </button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => select(s)}
                style={{ background: s.id === editingId ? nyx('selection') : 'transparent' }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div style={{ color: nyx('textPrimary') }} className="truncate text-sm">{s.title}</div>
                  <div style={{ color: nyx('textMuted') }} className="truncate text-[11px]">
                    {s.language}{s.tags.length ? ` · ${s.tags.join(', ')}` : ''}
                  </div>
                </div>
                {s.favorite ? <Star size={11} style={{ color: nyx('warning') }} fill="currentColor" /> : null}
              </button>
            </li>
          ))}
          {!filtered.length ? (
            <li style={{ color: nyx('textMuted') }} className="px-3 py-6 text-center text-xs">No match.</li>
          ) : null}
        </ul>

        <div style={{ borderColor: nyx('outlineVariant') }} className="border-t p-3">
          <NyxButton className="w-full" icon={<Plus size={14} />} onClick={startNew}>New Snippet</NyxButton>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header
          style={{ borderColor: nyx('outlineVariant') }}
          className="flex h-11 shrink-0 items-center gap-2 border-b px-4"
        >
          <input
            value={draft.title ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Snippet title"
            style={{ color: nyx('textPrimary') }}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--nyx-textMuted)]"
          />
          <select
            value={draft.language ?? 'bash'}
            onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
            aria-label="Language"
            style={{ background: nyx('surfaceVariant'), color: nyx('textSecondary'), borderColor: nyx('outlineVariant') }}
            className="h-7 rounded-lg border px-1.5 text-[11px] outline-none"
          >
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select
            value={draft.projectId ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value || null }))}
            aria-label="Project"
            style={{ background: nyx('surfaceVariant'), color: nyx('textSecondary'), borderColor: nyx('outlineVariant') }}
            className="h-7 max-w-40 rounded-lg border px-1.5 text-[11px] outline-none"
          >
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {editingId ? (
            <>
              <NyxIconButton
                label={copied === editingId ? 'Copied' : 'Copy code'}
                icon={<Copy size={14} />}
                onClick={() => { const s = items.find((x) => x.id === editingId); if (s) void copy(s) }}
              />
              <NyxIconButton
                label="Toggle favorite"
                active={!!draft.favorite}
                icon={<Star size={14} />}
                onClick={() => { const s = items.find((x) => x.id === editingId); if (s) void toggleFavorite(s) }}
              />
              <NyxIconButton
                label="Delete snippet"
                icon={<Trash2 size={14} />}
                onClick={() => { const s = items.find((x) => x.id === editingId); if (s) setPendingDelete(s) }}
              />
            </>
          ) : null}
          <NyxButton size="sm" variant="filled" onClick={() => void save()}>Save</NyxButton>
        </header>

        <div className="shrink-0 px-4 py-2">
          <TagEditor
            tags={draft.tags ?? []}
            onChange={(tags) => setDraft((d) => ({ ...d, tags }))}
          />
        </div>

        <textarea
          value={draft.code ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
          spellCheck={false}
          placeholder="Paste or write the snippet…"
          style={{ background: nyx('codeBackground'), color: nyx('codeForeground') }}
          className="min-h-0 flex-1 resize-none p-4 font-mono text-xs leading-relaxed outline-none
                     placeholder:text-[var(--nyx-textMuted)]"
        />
      </section>

      <NyxPermissionDialog
        open={!!pendingDelete}
        danger
        title="Delete snippet?"
        confirmLabel="Delete"
        detail={`“${pendingDelete?.title}” will be removed from your local snippet library.`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          setItems(await window.nyx.snippets.remove(pendingDelete.id))
          if (editingId === pendingDelete.id) { setEditingId(null); setDraft(blank()) }
          setPendingDelete(null)
        }}
      />
    </div>
  )
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <NyxChip key={t} onRemove={() => onChange(tags.filter((x) => x !== t))}>{t}</NyxChip>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !draft.trim()) return
          e.preventDefault()
          if (!tags.includes(draft.trim())) onChange([...tags, draft.trim()])
          setDraft('')
        }}
        placeholder="add tag…"
        style={{ color: nyx('textSecondary') }}
        className="h-6 w-24 bg-transparent text-[11px] outline-none placeholder:text-[var(--nyx-textMuted)]"
      />
    </div>
  )
}
