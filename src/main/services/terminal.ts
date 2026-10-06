import { spawn, type IPty } from '@lydell/node-pty'
import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'

export interface ShellInfo { path: string; name: string }

const CANDIDATE_SHELLS = ['/bin/fish', '/usr/bin/fish', '/bin/zsh', '/usr/bin/zsh', '/bin/bash', '/usr/bin/bash', '/bin/sh']

/** Shells actually present on this machine, login shell first. */
export function detectShells(): ShellInfo[] {
  const login = (() => {
    try { return userInfo().shell ?? null } catch { return null }
  })()
  const seen = new Set<string>()
  const out: ShellInfo[] = []
  for (const p of [login, ...CANDIDATE_SHELLS]) {
    if (!p || seen.has(p) || !existsSync(p)) continue
    seen.add(p)
    out.push({ path: p, name: p.split('/').pop()! })
  }
  return out
}

interface Session { pty: IPty; windowId: number }
const sessions = new Map<string, Session>()

/** Sessions are created lazily — one PTY per terminal tab the user actually opens. */
export function createSession(
  win: BrowserWindow,
  opts: { shell?: string; cwd?: string; cols?: number; rows?: number },
): { id: string; shell: string } {
  const shells = detectShells()
  const shell = opts.shell && shells.some((s) => s.path === opts.shell) ? opts.shell : shells[0]?.path
  if (!shell) throw new Error('No usable shell found on this system')

  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : homedir()
  const pty = spawn(shell, [], {
    name: 'xterm-256color',
    cols: Math.max(2, opts.cols ?? 80),
    rows: Math.max(2, opts.rows ?? 24),
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', NYXIUM: '1' } as Record<string, string>,
  })

  const id = randomUUID()
  sessions.set(id, { pty, windowId: win.id })

  pty.onData((data) => {
    if (!win.isDestroyed()) win.webContents.send('terminal:data', { id, data })
  })
  pty.onExit(({ exitCode }) => {
    sessions.delete(id)
    if (!win.isDestroyed()) win.webContents.send('terminal:exit', { id, exitCode })
  })

  return { id, shell }
}

export function write(id: string, data: string) {
  sessions.get(id)?.pty.write(data)
}

export function resize(id: string, cols: number, rows: number) {
  const s = sessions.get(id)
  if (s) s.pty.resize(Math.max(2, Math.floor(cols)), Math.max(2, Math.floor(rows)))
}

export function kill(id: string) {
  const s = sessions.get(id)
  if (!s) return
  try { s.pty.kill() } catch { /* already gone */ }
  sessions.delete(id)
}

/** Reap every PTY belonging to a closing window so no shell is orphaned. */
export function killForWindow(windowId: number) {
  for (const [id, s] of sessions) if (s.windowId === windowId) { kill(id) }
}

export const sessionCount = () => sessions.size
