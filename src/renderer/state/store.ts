import { create } from 'zustand'
import type {
  AppConfig, NyxNotification, Project, ServiceEntry, ViewId, Workspace,
} from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/types'

export interface Tab {
  id: string
  view: ViewId
  title: string
  projectId: string | null
  /** Set when this tab hosts an embedded web service. */
  serviceId?: string | null
  pinned: boolean
}

interface State {
  ready: boolean
  config: AppConfig
  workspaces: Workspace[]
  projects: Project[]
  services: ServiceEntry[]
  notifications: NyxNotification[]
  tabs: Tab[]
  activeTabId: string
  closedTabs: Tab[]
  activeProjectId: string | null

  init: () => Promise<void>
  patchConfig: (patch: Partial<AppConfig>) => Promise<void>
  refreshProjects: () => Promise<void>
  refreshServices: () => Promise<void>
  refreshNotifications: () => Promise<void>

  openTab: (
    view: ViewId,
    opts?: { projectId?: string | null; serviceId?: string | null; title?: string; focus?: boolean },
  ) => void
  closeTab: (id: string) => void
  restoreTab: () => void
  setActiveTab: (id: string) => void
  togglePin: (id: string) => void
  setActiveProject: (id: string | null) => void
}

export const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: 'Dashboard', projects: 'Projects', services: 'Services',
  ai: 'AI Agent', terminal: 'Terminal', git: 'Git', database: 'Database',
  docker: 'Docker', snippets: 'Snippets', api: 'API Playground',
  cloud: 'Cloud Storage', notifications: 'Notifications', settings: 'Settings',
}

const newId = () => Math.random().toString(36).slice(2, 10)
const HOME: Tab = { id: 'home', view: 'dashboard', title: 'Dashboard', projectId: null, pinned: true }

export const useStore = create<State>((set, get) => ({
  ready: false,
  config: DEFAULT_CONFIG,
  workspaces: [],
  projects: [],
  services: [],
  notifications: [],
  tabs: [HOME],
  activeTabId: HOME.id,
  closedTabs: [],
  activeProjectId: null,

  async init() {
    const [config, workspaces, projects, services, notifications] = await Promise.all([
      window.nyx.config.get(),
      window.nyx.workspaces.list(),
      window.nyx.projects.list(),
      window.nyx.services.list(),
      window.nyx.notifications.list(),
    ])
    set({ config, workspaces, projects, services, notifications, ready: true })
  },

  async patchConfig(patch) {
    set({ config: await window.nyx.config.patch(patch) })
  },

  async refreshProjects() { set({ projects: await window.nyx.projects.list() }) },
  async refreshServices() { set({ services: await window.nyx.services.list() }) },
  async refreshNotifications() { set({ notifications: await window.nyx.notifications.list() }) },

  openTab(view, opts = {}) {
    const { tabs } = get()
    const projectId = opts.projectId ?? null
    const serviceId = opts.serviceId ?? null
    const existing = tabs.find((t) =>
      t.view === view && t.projectId === projectId && (t.serviceId ?? null) === serviceId)
    if (existing) {
      set({ activeTabId: existing.id, ...(projectId ? { activeProjectId: projectId } : {}) })
      return
    }
    const tab: Tab = {
      id: newId(),
      view,
      title: opts.title ?? VIEW_TITLES[view],
      projectId,
      serviceId,
      pinned: false,
    }
    set({
      tabs: [...tabs, tab],
      activeTabId: opts.focus === false ? get().activeTabId : tab.id,
      ...(projectId ? { activeProjectId: projectId } : {}),
    })
  },

  closeTab(id) {
    const { tabs, activeTabId, closedTabs } = get()
    const target = tabs.find((t) => t.id === id)
    if (!target || target.pinned || tabs.length === 1) return
    const index = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    set({
      tabs: next,
      closedTabs: [target, ...closedTabs].slice(0, 10),
      activeTabId: activeTabId === id ? (next[index] ?? next[index - 1] ?? next[0]).id : activeTabId,
    })
  },

  restoreTab() {
    const [restored, ...rest] = get().closedTabs
    if (!restored) return
    set({ tabs: [...get().tabs, restored], closedTabs: rest, activeTabId: restored.id })
  },

  setActiveTab(id) {
    const tab = get().tabs.find((t) => t.id === id)
    set({ activeTabId: id, ...(tab?.projectId ? { activeProjectId: tab.projectId } : {}) })
  },

  togglePin(id) {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)) })
  },

  setActiveProject(id) { set({ activeProjectId: id }) },
}))

export const useActiveTab = () => useStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0])
export const useActiveProject = () =>
  useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)
