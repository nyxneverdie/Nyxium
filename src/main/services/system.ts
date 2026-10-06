import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EnvTool, GitSummary } from '../../shared/types.js'

/** Run a command with a hard timeout; never throws. */
export function run(
  cmd: string, args: string[], cwd?: string, timeout = 5000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

const VERSION_PROBES: Array<[string, string, string[]]> = [
  ['Node', 'node', ['--version']],
  ['npm', 'npm', ['--version']],
  ['pnpm', 'pnpm', ['--version']],
  ['Bun', 'bun', ['--version']],
  ['Python', 'python3', ['--version']],
  ['PHP', 'php', ['--version']],
  ['Rust', 'rustc', ['--version']],
  ['Go', 'go', ['version']],
  ['Docker', 'docker', ['--version']],
  ['Git', 'git', ['--version']],
]

const firstVersion = (s: string) => s.match(/\d+(\.\d+)*/)?.[0] ?? null

/** Probe installed toolchains. Nothing is hardcoded — absent tools report null. */
export async function detectEnvironment(cwd?: string): Promise<EnvTool[]> {
  const results = await Promise.all(
    VERSION_PROBES.map(async ([name, bin, args]) => {
      const r = await run(bin, args, cwd, 4000)
      return { name, version: r.ok ? firstVersion(r.stdout || r.stderr) : null }
    }),
  )
  return results
}

/** Stack markers → tags. Order matters only for readability. */
const MARKERS: Array<[string, string[]]> = [
  ['.git', ['Git']],
  ['package.json', ['Node']],
  ['composer.json', ['PHP', 'Composer']],
  ['Cargo.toml', ['Rust', 'Cargo']],
  ['go.mod', ['Go']],
  ['requirements.txt', ['Python']],
  ['pyproject.toml', ['Python']],
  ['Dockerfile', ['Docker']],
  ['docker-compose.yml', ['Docker Compose']],
  ['docker-compose.yaml', ['Docker Compose']],
  ['flake.nix', ['Nix']],
  ['Makefile', ['Make']],
  ['pnpm-lock.yaml', ['pnpm']],
  ['package-lock.json', ['npm']],
  ['yarn.lock', ['Yarn']],
  ['artisan', ['Laravel']],
]

/** Dependency names → tags, read from package.json when one exists. */
const DEP_TAGS: Array<[string, string]> = [
  ['electron', 'Electron'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['next', 'Next.js'],
  ['vite', 'Vite'],
  ['typescript', 'TypeScript'],
  ['tailwindcss', 'Tailwind'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['prisma', 'Prisma'],
]

export async function detectStack(dir: string): Promise<string[]> {
  const tags = new Set<string>()
  for (const [file, add] of MARKERS) {
    if (existsSync(join(dir, file))) add.forEach((t) => tags.add(t))
  }
  const pkgPath = join(dir, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const { readFile } = await import('node:fs/promises')
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      for (const [dep, tag] of DEP_TAGS) if (deps[dep]) tags.add(tag)
    } catch {
      /* unreadable package.json — markers already covered the basics */
    }
  }
  return [...tags]
}

export async function gitSummary(dir: string): Promise<GitSummary> {
  const empty: GitSummary = { isRepo: false, branch: null, dirty: 0, ahead: 0, behind: 0 }
  if (!existsSync(join(dir, '.git'))) return empty

  const status = await run('git', ['status', '--porcelain=v1', '--branch'], dir)
  if (!status.ok) return empty

  const lines = status.stdout.split('\n').filter(Boolean)
  const head = lines.find((l) => l.startsWith('##')) ?? ''
  const branch = head.replace(/^## /, '').split(/\.\.\.|\s/)[0] || null
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0)
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0)
  const dirty = lines.filter((l) => !l.startsWith('##')).length
  return { isRepo: true, branch, dirty, ahead, behind }
}
