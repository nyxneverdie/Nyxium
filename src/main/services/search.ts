import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { CodeHit, FileHit } from '../../shared/types.js'

/** Directories never worth walking for code search or backup. */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', '.venv', 'venv',
  '__pycache__', '.cache', '.tmp', '.next', '.turbo', 'vendor', '.gradle', 'coverage',
])

const MAX_FILE_BYTES = 512 * 1024
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|zst|xz|tar|mp4|mp3|wav|woff2?|ttf|so|a|o|bin|wasm|exe|class|jar)$/i

/** Breadth-first walk with hard caps, so a huge repo can never stall the main process. */
async function* walk(root: string, maxFiles: number): AsyncGenerator<string> {
  const queue = [root]
  let seen = 0
  while (queue.length && seen < maxFiles) {
    const dir = queue.shift()!
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env.example') {
        if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
      }
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) queue.push(full)
      } else if (e.isFile() && !BINARY_EXT.test(e.name)) {
        seen++
        yield full
        if (seen >= maxFiles) return
      }
    }
  }
}

export async function searchFiles(root: string, query: string, limit = 60): Promise<FileHit[]> {
  const q = query.toLowerCase()
  const hits: FileHit[] = []
  for await (const file of walk(root, 20_000)) {
    const rel = relative(root, file)
    if (!q || rel.toLowerCase().includes(q)) {
      hits.push({ path: rel })
      if (hits.length >= limit) break
    }
  }
  // Shallower paths first — they are usually the ones meant.
  return hits.sort((a, b) => a.path.split(sep).length - b.path.split(sep).length)
}

export async function searchCode(
  root: string, query: string, opts: { limit?: number; maxPerFile?: number } = {},
): Promise<CodeHit[]> {
  if (!query.trim()) return []
  const limit = opts.limit ?? 80
  const maxPerFile = opts.maxPerFile ?? 4
  const needle = query.toLowerCase()
  const hits: CodeHit[] = []

  for await (const file of walk(root, 20_000)) {
    if (hits.length >= limit) break
    try {
      const info = await stat(file)
      if (info.size > MAX_FILE_BYTES) continue
      const text = await readFile(file, 'utf8')
      if (!text.toLowerCase().includes(needle)) continue
      const lines = text.split('\n')
      let perFile = 0
      for (let i = 0; i < lines.length && perFile < maxPerFile && hits.length < limit; i++) {
        if (!lines[i].toLowerCase().includes(needle)) continue
        perFile++
        hits.push({ path: relative(root, file), line: i + 1, text: lines[i].slice(0, 400).trim() })
      }
    } catch { /* unreadable or non-UTF8 — skip */ }
  }
  return hits
}

/** Definition-ish lines for a symbol, across the common languages Nyxium targets. */
export async function findSymbol(root: string, name: string, limit = 30): Promise<CodeHit[]> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `\\b(function|class|interface|type|struct|enum|trait|impl|const|let|var|def|fn|public|private|protected)\\b[^\\n]*\\b${escaped}\\b`,
  )
  const hits: CodeHit[] = []
  for await (const file of walk(root, 20_000)) {
    if (hits.length >= limit) break
    try {
      const info = await stat(file)
      if (info.size > MAX_FILE_BYTES) continue
      const lines = (await readFile(file, 'utf8')).split('\n')
      for (let i = 0; i < lines.length && hits.length < limit; i++) {
        if (re.test(lines[i])) hits.push({ path: relative(root, file), line: i + 1, text: lines[i].slice(0, 400).trim() })
      }
    } catch { /* skip */ }
  }
  return hits
}
