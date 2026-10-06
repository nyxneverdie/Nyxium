import { randomUUID } from 'node:crypto'
import { JsonStore } from './store.js'
import type { Snippet } from '../../shared/types.js'

export const snippetStore = new JsonStore<{ items: Snippet[] }>('snippets.json', { items: [] })

export const SNIPPET_LANGUAGES = [
  'bash', 'c', 'cpp', 'rust', 'go', 'javascript', 'typescript', 'python',
  'php', 'laravel', 'sql', 'nix', 'docker', 'git',
] as const

type Draft = Partial<Omit<Snippet, 'id' | 'createdAt' | 'updatedAt'>>

export function upsert(id: string | null, draft: Draft): Snippet[] {
  const { items } = snippetStore.read()
  const now = Date.now()
  const lang = SNIPPET_LANGUAGES.includes(draft.language as never) ? draft.language! : 'bash'
  const base = {
    title: (draft.title ?? 'Untitled').slice(0, 160),
    language: lang,
    code: (draft.code ?? '').slice(0, 500_000),
    tags: (draft.tags ?? []).slice(0, 20).map((t) => String(t).slice(0, 40)),
    favorite: !!draft.favorite,
    projectId: draft.projectId ?? null,
  }
  const next = id
    ? items.map((s) => (s.id === id ? { ...s, ...base, updatedAt: now } : s))
    : [{ id: randomUUID(), ...base, createdAt: now, updatedAt: now }, ...items]
  return snippetStore.write({ items: next }).items
}

export function remove(id: string): Snippet[] {
  return snippetStore.write({ items: snippetStore.read().items.filter((s) => s.id !== id) }).items
}
