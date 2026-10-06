import { createReadStream, existsSync } from 'node:fs'
import { readFile, readdir, rm, stat, mkdtemp } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { run } from '../system.js'

/**
 * BackupManager: scan → apply exclusions → archive → upload → verify.
 *
 * Two separate exclusion layers. The ignore list is about size and noise, and
 * the user can edit it. The secret list is about safety and cannot be waived —
 * a .env or a private key is never put in an archive bound for the cloud.
 */

/** Heavy, regenerable directories. Excluded unless a .nyxiumignore says otherwise. */
export const DEFAULT_EXCLUDES = [
  'node_modules/', '.git/', 'dist/', 'build/', 'target/', '.venv/',
  '__pycache__/', '.cache/', '.tmp/', 'out/', '.next/', '.turbo/', 'coverage/',
]

/** Never uploaded, regardless of configuration. */
export const SECRET_EXCLUDES = [
  /(^|\/)\.env$/, /(^|\/)\.env\..*/,
  /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)service-account.*\.json$/,
  /(^|\/)id_rsa$/, /(^|\/)id_ed25519$/, /(^|\/)id_ecdsa$/,
  /(^|\/)\.npmrc$/, /(^|\/)\.pypirc$/,
  /(^|\/)\.aws\//, /(^|\/)\.ssh\//,
]

export const isSecret = (rel: string) => SECRET_EXCLUDES.some((re) => re.test(rel))

export interface ScanResult {
  files: string[]
  totalBytes: number
  excludedSecrets: string[]
  truncated: boolean
}

/** One .gitignore-ish rule. Only the subset Nyxium documents is supported. */
interface Rule { negated: boolean; dirOnly: boolean; re: RegExp }

function compile(pattern: string): Rule | null {
  let p = pattern.trim()
  if (!p || p.startsWith('#')) return null

  const negated = p.startsWith('!')
  if (negated) p = p.slice(1)

  const dirOnly = p.endsWith('/')
  if (dirOnly) p = p.slice(0, -1)

  const anchored = p.startsWith('/')
  if (anchored) p = p.slice(1)

  const body = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')     // placeholder so * does not eat it
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*')

  // An unanchored pattern matches at any depth, the way .gitignore behaves.
  const prefix = anchored ? '^' : '^(?:.*/)?'
  return { negated, dirOnly, re: new RegExp(`${prefix}${body}(?:/.*)?$`) }
}

export function parseIgnore(text: string): Rule[] {
  return text.split('\n').map(compile).filter((r): r is Rule => r !== null)
}

/** Last matching rule wins, so a later `!keep` can re-include. */
export function isExcluded(rel: string, rules: Rule[], isDir: boolean): boolean {
  let excluded = false
  for (const r of rules) {
    if (r.dirOnly && !isDir && !r.re.test(rel)) continue
    if (!r.re.test(rel)) continue
    excluded = !r.negated
  }
  return excluded
}

export async function loadIgnore(projectPath: string): Promise<Rule[]> {
  const file = join(projectPath, '.nyxiumignore')
  const text = existsSync(file)
    ? await readFile(file, 'utf8')
    : DEFAULT_EXCLUDES.join('\n')
  return parseIgnore(text)
}

const MAX_FILES = 50_000

/** Walk the project, applying both exclusion layers. */
export async function scan(projectPath: string): Promise<ScanResult> {
  const rules = await loadIgnore(projectPath)
  const files: string[] = []
  const excludedSecrets: string[] = []
  let totalBytes = 0
  let truncated = false

  const queue = [projectPath]
  while (queue.length) {
    const dir = queue.shift()!
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { continue }

    for (const e of entries) {
      const abs = join(dir, e.name)
      const rel = relative(projectPath, abs).split(sep).join('/')

      if (e.isDirectory()) {
        if (!isExcluded(rel, rules, true) && !isSecret(`${rel}/`)) queue.push(abs)
        continue
      }
      if (!e.isFile()) continue

      if (isSecret(rel)) { excludedSecrets.push(rel); continue }
      if (isExcluded(rel, rules, false)) continue

      if (files.length >= MAX_FILES) { truncated = true; break }
      files.push(rel)
      try { totalBytes += (await stat(abs)).size } catch { /* vanished mid-scan */ }
    }
    if (truncated) break
  }

  return { files, totalBytes, excludedSecrets, truncated }
}

export interface Archive { path: string; bytes: number; sha256: string; fileCount: number }

/**
 * Build one archive from the scanned file list. tar reads the list from a file,
 * so no shell quoting is involved and a filename can contain anything.
 */
export async function buildArchive(
  projectPath: string, projectName: string, files: string[],
): Promise<Archive> {
  if (!files.length) throw new Error('Nothing to back up — every file was excluded.')

  const dir = await mkdtemp(join(tmpdir(), 'nyxium-backup-'))
  const listFile = join(dir, 'files.txt')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(listFile, files.join('\n'), 'utf8')

  // zstd when available (much faster at the same ratio), gzip otherwise.
  const hasZstd = (await run('zstd', ['--version'], undefined, 4000)).ok
  const ext = hasZstd ? 'tar.zst' : 'tar.gz'
  const archivePath = join(dir, `${projectName}-${new Date().toISOString().slice(0, 10)}.${ext}`)

  const args = [
    '--create',
    hasZstd ? '--zstd' : '--gzip',
    '--file', archivePath,
    '--directory', projectPath,
    '--files-from', listFile,
  ]
  const r = await run('tar', args, projectPath, 30 * 60_000)
  if (!r.ok) throw new Error(`Could not create the archive: ${r.stderr.trim().slice(0, 300)}`)

  const bytes = (await stat(archivePath)).size
  const sha256 = await hashFile(archivePath)
  return { path: archivePath, bytes, sha256, fileCount: files.length }
}

export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

export const cleanupArchive = (archive: Archive) =>
  rm(join(archive.path, '..'), { recursive: true, force: true })

/** Extract a restored archive into a destination directory. */
export async function extractArchive(archivePath: string, destination: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(destination, { recursive: true })
  const r = await run('tar', ['--extract', '--file', archivePath, '--directory', destination], undefined, 30 * 60_000)
  if (!r.ok) throw new Error(`Could not extract the archive: ${r.stderr.trim().slice(0, 300)}`)
}
