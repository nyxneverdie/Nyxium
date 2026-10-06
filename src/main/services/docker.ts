import { run } from './system.js'
import type { DockerContainer, DockerImage, DockerVolume, DockerNetwork } from '../../shared/types.js'

/**
 * Docker through its CLI. Nothing is reimplemented: `docker` already knows how
 * to talk to whatever daemon or socket the user has configured.
 */

const docker = (args: string[], timeout = 15_000) => run('docker', args, undefined, timeout)

/** Parse `--format '{{json .}}'` output: one JSON object per line. */
function parseLines<T>(stdout: string): T[] {
  const out: T[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try { out.push(JSON.parse(t) as T) } catch { /* a non-JSON warning line */ }
  }
  return out
}

export async function available(): Promise<{ ok: boolean; detail: string | null }> {
  const version = await docker(['version', '--format', '{{.Server.Version}}'], 6000)
  if (version.ok && version.stdout.trim()) return { ok: true, detail: null }
  const cli = await docker(['--version'], 4000)
  if (!cli.ok) return { ok: false, detail: 'The docker command was not found on this system.' }
  return {
    ok: false,
    detail: 'Docker is installed but no daemon is reachable. Start the service, or check your permissions on the socket.',
  }
}

export async function containers(): Promise<DockerContainer[]> {
  const r = await docker(['ps', '--all', '--format', '{{json .}}'])
  if (!r.ok) return []
  return parseLines<{
    ID: string; Names: string; Image: string; State: string; Status: string; Ports: string
  }>(r.stdout).map((c) => ({
    id: c.ID,
    name: c.Names,
    image: c.Image,
    state: c.State,
    status: c.Status,
    ports: c.Ports ? c.Ports.split(', ').filter(Boolean) : [],
  }))
}

export async function images(): Promise<DockerImage[]> {
  const r = await docker(['images', '--format', '{{json .}}'])
  if (!r.ok) return []
  return parseLines<{ ID: string; Repository: string; Tag: string; Size: string; CreatedAt: string }>(r.stdout)
    .map((i) => ({
      id: i.ID,
      repository: i.Repository,
      tag: i.Tag,
      size: i.Size,
      createdAt: i.CreatedAt,
    }))
}

export async function volumes(): Promise<DockerVolume[]> {
  const r = await docker(['volume', 'ls', '--format', '{{json .}}'])
  if (!r.ok) return []
  return parseLines<{ Name: string; Driver: string; Mountpoint?: string }>(r.stdout)
    .map((v) => ({ name: v.Name, driver: v.Driver, mountpoint: v.Mountpoint ?? null }))
}

export async function networks(): Promise<DockerNetwork[]> {
  const r = await docker(['network', 'ls', '--format', '{{json .}}'])
  if (!r.ok) return []
  return parseLines<{ ID: string; Name: string; Driver: string; Scope: string }>(r.stdout)
    .map((n) => ({ id: n.ID, name: n.Name, driver: n.Driver, scope: n.Scope }))
}

export async function logs(id: string, tail = 200): Promise<string> {
  const r = await docker(['logs', '--tail', String(Math.min(tail, 2000)), id], 20_000)
  // Docker writes container stderr to our stderr; both belong in the log view.
  return [r.stdout, r.stderr].filter(Boolean).join('\n')
}

export const start = (id: string) => docker(['start', id], 30_000)
export const stop = (id: string) => docker(['stop', id], 40_000)
export const restart = (id: string) => docker(['restart', id], 60_000)
export const removeContainer = (id: string) => docker(['rm', '-f', id], 30_000)
export const removeImage = (id: string) => docker(['rmi', '-f', id], 30_000)
export const removeVolume = (name: string) => docker(['volume', 'rm', '-f', name], 20_000)

/** The shell command the user should run to get a shell in a container.
 *  Nyxium hands it to its own terminal rather than spawning an unattached TTY. */
export const shellCommand = (id: string) =>
  `docker exec -it ${id} sh -lc 'command -v bash >/dev/null && exec bash || exec sh'`
