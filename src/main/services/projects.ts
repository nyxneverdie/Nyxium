import { dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import { JsonStore } from './store.js'
import { detectStack } from './system.js'
import type { Project, ServiceEntry, Workspace, NyxNotification } from '../../shared/types.js'

export const workspaceStore = new JsonStore<{ items: Workspace[] }>('workspaces.json', {
  items: [
    { id: 'personal', name: 'Personal' },
    { id: 'work', name: 'Work' },
  ],
})

export const projectStore = new JsonStore<{ items: Project[] }>('projects.json', { items: [] })

const BUILTIN_SERVICES: Array<Pick<ServiceEntry, 'name' | 'url'>> = [
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'GitLab', url: 'https://gitlab.com' },
  { name: 'Replit', url: 'https://replit.com' },
  { name: 'Laravel', url: 'https://laravel.com/docs' },
  { name: 'Vercel', url: 'https://vercel.com/dashboard' },
  { name: 'Netlify', url: 'https://app.netlify.com' },
  { name: 'StackBlitz', url: 'https://stackblitz.com' },
  { name: 'CodeSandbox', url: 'https://codesandbox.io' },
  { name: 'Figma', url: 'https://figma.com' },
  { name: 'Linear', url: 'https://linear.app' },
  { name: 'Jira', url: 'https://jira.atlassian.com' },
  { name: 'Supabase', url: 'https://supabase.com/dashboard' },
  { name: 'Firebase', url: 'https://console.firebase.google.com' },
  { name: 'npm', url: 'https://npmjs.com' },
  { name: 'Docker Hub', url: 'https://hub.docker.com' },
  { name: 'MDN', url: 'https://developer.mozilla.org' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com' },
]

export const serviceStore = new JsonStore<{ items: ServiceEntry[] }>('services.json', {
  items: BUILTIN_SERVICES.map((s) => ({
    ...s, id: s.name.toLowerCase().replace(/\W+/g, '-'),
    icon: null, projectId: null, workspaceId: null, pinned: false, builtin: true,
  })),
})

export const notificationStore = new JsonStore<{ items: NyxNotification[] }>('notifications.json', {
  items: [],
})

export async function importProject(workspaceId: string): Promise<Project | null> {
  const r = await dialog.showOpenDialog({
    title: 'Import project directory',
    properties: ['openDirectory'],
  })
  if (r.canceled || !r.filePaths[0]) return null
  return registerPath(r.filePaths[0], workspaceId)
}

export async function registerPath(path: string, workspaceId: string): Promise<Project | null> {
  if (!existsSync(path)) return null
  const { items } = projectStore.read()
  const existing = items.find((p) => p.path === path)
  if (existing) return existing

  const project: Project = {
    id: randomUUID(),
    name: basename(path),
    path,
    stack: await detectStack(path),
    workspaceId,
    createdAt: Date.now(),
    lastOpenedAt: null,
    notes: '',
  }
  projectStore.write({ items: [project, ...items] })
  return project
}

export const reveal = (path: string) => shell.openPath(path)

export function pushNotification(n: Omit<NyxNotification, 'id' | 'at' | 'read'>): NyxNotification {
  const full: NyxNotification = { ...n, id: randomUUID(), at: Date.now(), read: false }
  const { items } = notificationStore.read()
  notificationStore.write({ items: [full, ...items].slice(0, 200) })
  return full
}
