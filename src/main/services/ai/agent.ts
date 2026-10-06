import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { JsonStore } from '../store.js'
import { detectStack, gitSummary } from '../system.js'
import type {
  AIConfig, AIMessage, AIMode, AISession, AIStreamEvent, AIToolCall, Project,
} from '../../../shared/types.js'
import { DEFAULT_AI_CONFIG } from '../../../shared/types.js'
import { PROVIDERS, applyResourceMode, customHeaders, type ChatMessage } from './providers.js'
import { getSecret } from '../secrets.js'
import { TOOLS, execute, tierOf, toolSchemas, type ToolContext } from './tools.js'

export const aiConfigStore = new JsonStore<AIConfig>('ai.json', DEFAULT_AI_CONFIG)

/** Vault key for the custom endpoint's API credential. */
export const CUSTOM_KEY = 'ai.custom.apiKey'
export const sessionStore = new JsonStore<{ items: AISession[] }>('ai-sessions.json', { items: [] })

/** Tool calls parked waiting for the user's Allow/Deny. */
const pendingApprovals = new Map<string, {
  resolve: (approved: boolean) => void
  call: AIToolCall
  sessionId: string
}>()

/** One in-flight run per session; low-RAM mode allows only one overall. */
const running = new Map<string, AbortController>()

const MAX_TOOL_ROUNDS = 8

function send(win: BrowserWindow, event: AIStreamEvent) {
  if (!win.isDestroyed()) win.webContents.send('ai:stream', event)
}

export function listSessions(): AISession[] {
  return sessionStore.read().items
}

export function getSession(id: string): AISession | null {
  return sessionStore.read().items.find((s) => s.id === id) ?? null
}

function saveSession(session: AISession) {
  const { items } = sessionStore.read()
  const i = items.findIndex((s) => s.id === session.id)
  const next = i === -1 ? [session, ...items] : items.map((s) => (s.id === session.id ? session : s))
  sessionStore.write({ items: next.slice(0, 200) })
}

export function createSession(projectId: string | null, title = 'New session'): AISession {
  const s: AISession = {
    id: randomUUID(), title, projectId, messages: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  }
  saveSession(s)
  return s
}

export function renameSession(id: string, title: string): AISession[] {
  const items = sessionStore.read().items.map((s) =>
    (s.id === id ? { ...s, title: title.slice(0, 120), updatedAt: Date.now() } : s))
  return sessionStore.write({ items }).items
}

export function deleteSession(id: string): AISession[] {
  running.get(id)?.abort()
  return sessionStore.write({ items: sessionStore.read().items.filter((s) => s.id !== id) }).items
}

/** The agent is told what project it is in — not handed the project's contents. */
async function systemPrompt(project: Project | null, mode: AIMode): Promise<string> {
  const rules = [
    'You are the Nyxium local coding agent. You run entirely on the user\'s machine.',
    'Be concise and concrete. Prefer reading the real files over guessing.',
    'Never claim to have changed a file you did not change through a tool.',
  ]

  const byMode: Record<AIMode, string> = {
    ask: 'MODE: Ask. Explain and answer only. Do not call tools that modify anything.',
    plan: 'MODE: Plan. Investigate with read-only tools and propose a concrete plan. Do not modify files.',
    agent: 'MODE: Agent. You may use tools. Modifications are shown to the user for approval before they take effect.',
    trusted: 'MODE: Trusted Agent. The user has pre-approved routine changes; destructive operations still require confirmation.',
  }
  rules.push(byMode[mode])

  if (!project) {
    rules.push('No project is open, so file and Git tools are unavailable.')
    return rules.join('\n')
  }

  const [git, stack] = await Promise.all([gitSummary(project.path), detectStack(project.path)])
  rules.push(
    '',
    `PROJECT: ${project.name}`,
    `PATH: ${project.path}`,
    `STACK: ${(stack.length ? stack : project.stack).join(', ') || 'unknown'}`,
    git.isRepo
      ? `GIT: branch ${git.branch ?? 'unknown'}, ${git.dirty} changed file(s), ahead ${git.ahead}, behind ${git.behind}`
      : 'GIT: not a repository',
    '',
    'Retrieve context on demand with search_code, search_files, find_symbol and read_file.',
    'Do not ask to read the whole repository.',
  )
  return rules.join('\n')
}

/** Ask the renderer for permission and block until the user answers. */
function requestApproval(win: BrowserWindow, sessionId: string, call: AIToolCall): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApprovals.set(call.id, { resolve, call, sessionId })
    send(win, { sessionId, type: 'tool-call', toolCall: { ...call, status: 'awaiting-approval' } })
  })
}

export function resolveApproval(callId: string, approved: boolean) {
  const entry = pendingApprovals.get(callId)
  if (!entry) return
  pendingApprovals.delete(callId)
  entry.resolve(approved)
}

/** Whether a tier may run without asking, given the mode. */
function autoApproved(tier: ReturnType<typeof tierOf>, mode: AIMode): boolean {
  if (tier === 'safe') return true
  if (tier === 'dangerous') return false          // never, in any mode
  return mode === 'trusted'                        // 'confirm' tier
}

export function cancel(sessionId: string) {
  running.get(sessionId)?.abort()
  running.delete(sessionId)
}

export interface SendOptions {
  sessionId: string
  text: string
  project: Project | null
  /** Files the user explicitly attached to the context. */
  attachments: Array<{ path: string; content: string }>
}

/**
 * Run one user turn: stream tokens, execute tool calls (asking first where the
 * tier demands it), and loop until the model stops calling tools.
 */
export async function sendMessage(win: BrowserWindow, opts: SendOptions): Promise<void> {
  const cfg = aiConfigStore.read()
  const session = getSession(opts.sessionId)
  if (!session) throw new Error('Unknown AI session')
  if (!cfg.enabled) throw new Error('Local AI is disabled in settings')
  if (!cfg.model) throw new Error('No model selected. Choose one in AI Agent → Models.')

  const limits = applyResourceMode(cfg)
  if (limits.concurrency <= running.size) {
    throw new Error('Another AI request is still running. Low-RAM mode allows one at a time.')
  }

  const provider = PROVIDERS[cfg.provider]
  const isCustom = cfg.provider === 'custom'
  const endpoint = isCustom ? cfg.custom.url : cfg.endpoints[cfg.provider]
  if (!endpoint) throw new Error('No endpoint URL is configured for this provider.')
  // The key is read here, per request, and never leaves the main process.
  const headers = isCustom ? customHeaders(cfg.custom, getSecret(CUSTOM_KEY)) : undefined
  const ctrl = new AbortController()
  running.set(session.id, ctrl)

  // With no project there is no directory the agent may touch. Falling back to
  // the process cwd would point its tools at Nyxium's own source tree.
  const ctx: ToolContext | null = opts.project
    ? { projectPath: opts.project.path, maxChars: cfg.resourceMode === 'low-ram' ? 6_000 : 20_000 }
    : null

  const userMessage: AIMessage = {
    id: randomUUID(), role: 'user', at: Date.now(),
    content: opts.attachments.length
      ? `${opts.text}\n\n--- attached files ---\n${opts.attachments
          .map((a) => `### ${a.path}\n${a.content}`).join('\n\n')}`
      : opts.text,
  }
  session.messages.push(userMessage)
  if (session.title === 'New session') session.title = opts.text.slice(0, 60) || 'New session'
  session.updatedAt = Date.now()
  saveSession(session)
  send(win, { sessionId: session.id, type: 'message', message: userMessage })

  const wire: ChatMessage[] = [
    { role: 'system', content: await systemPrompt(opts.project, cfg.mode) },
    ...session.messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  // Ask/Plan get no mutating tools at all — the model cannot even propose one.
  const allowed = cfg.mode === 'ask' ? []
    : cfg.mode === 'plan' ? toolSchemas().filter((t) => tierOf(t.name) === 'safe')
      : toolSchemas()

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let text = ''
      const calls: Array<{ name: string; args: Record<string, unknown> }> = []

      for await (const chunk of provider.chat(endpoint, {
        model: cfg.model,
        messages: wire,
        temperature: cfg.temperature,
        maxTokens: limits.maxTokens,
        contextSize: limits.contextSize,
        tools: allowed.length ? allowed : undefined,
        signal: ctrl.signal,
        headers,
      })) {
        if (chunk.text) {
          text += chunk.text
          send(win, { sessionId: session.id, type: 'token', text: chunk.text })
        }
        if (chunk.toolCalls?.length) calls.push(...chunk.toolCalls)
        if (chunk.done) break
      }

      const assistantMessage: AIMessage = {
        id: randomUUID(), role: 'assistant', content: text, at: Date.now(),
        toolCalls: calls.length ? [] : undefined,
      }

      if (!calls.length) {
        session.messages.push(assistantMessage)
        session.updatedAt = Date.now()
        saveSession(session)
        send(win, { sessionId: session.id, type: 'message', message: assistantMessage })
        send(win, { sessionId: session.id, type: 'done' })
        return
      }

      wire.push({ role: 'assistant', content: text })

      for (const c of calls) {
        const call: AIToolCall = { id: randomUUID(), name: c.name, args: c.args, status: 'pending' }
        const tier = tierOf(c.name)

        if (!TOOLS.some((t) => t.name === c.name)) {
          call.status = 'error'
          call.result = `Unknown tool "${c.name}"`
        } else if (!autoApproved(tier, cfg.mode)) {
          const ok = await requestApproval(win, session.id, call)
          if (!ok) {
            call.status = 'denied'
            call.result = 'The user denied this operation.'
          }
        }

        if (call.status === 'pending' && !ctx) {
          call.status = 'error'
          call.result = 'No project is open, so this tool is unavailable. Open a project first.'
        }

        if (call.status === 'pending' && ctx) {
          call.status = 'running'
          send(win, { sessionId: session.id, type: 'tool-call', toolCall: call })
          const outcome = await execute(c.name, c.args, ctx)
          call.status = outcome.ok ? 'done' : 'error'
          // A file edit is NOT applied here: it is handed to the renderer as a
          // diff for the user to apply or reject.
          call.result = outcome.edit
            ? `${outcome.output}\n(Shown to the user as a diff; not yet written to disk.)`
            : outcome.output
          if (outcome.edit) {
            send(win, {
              sessionId: session.id,
              type: 'tool-result',
              toolCall: { ...call, args: { ...call.args, __edit: outcome.edit } },
            })
          }
        }

        assistantMessage.toolCalls = [...(assistantMessage.toolCalls ?? []), call]
        send(win, { sessionId: session.id, type: 'tool-result', toolCall: call })
        wire.push({ role: 'tool', content: `${c.name}: ${call.result ?? ''}` })
      }

      session.messages.push(assistantMessage)
      session.updatedAt = Date.now()
      saveSession(session)
      send(win, { sessionId: session.id, type: 'message', message: assistantMessage })
    }

    send(win, {
      sessionId: session.id, type: 'error',
      error: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer.`,
    })
  } catch (e) {
    if (ctrl.signal.aborted) {
      send(win, { sessionId: session.id, type: 'done' })
      return
    }
    send(win, {
      sessionId: session.id, type: 'error',
      error: e instanceof Error ? e.message : 'Local inference failed',
    })
  } finally {
    running.delete(session.id)
    for (const [id, p] of pendingApprovals) {
      if (p.sessionId === session.id) { p.resolve(false); pendingApprovals.delete(id) }
    }
  }
}
