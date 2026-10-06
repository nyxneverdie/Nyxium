import { readFile, writeFile, readdir, stat, unlink, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { ToolSpec, ToolTier } from '../../../shared/types.js'
import { run } from '../system.js'
import * as git from '../git.js'
import { searchCode, searchFiles, findSymbol } from '../search.js'

/* The agent's hands. Every tool is scoped to one project directory, and the
   tier decides whether the renderer must get the user's approval first. */

export interface ToolContext {
  projectPath: string
  /** Honoured by read_file / run_terminal so a huge file cannot blow the context. */
  maxChars: number
}

export interface ToolOutcome {
  ok: boolean
  output: string
  /** Set by write/edit/create so the UI can show a diff before applying. */
  edit?: { path: string; before: string; after: string }
}

/** Files the agent may never read or send anywhere, even when asked. */
const SECRET_PATTERNS = [
  /(^|\/)\.env($|\..*)/,
  /\.pem$/, /\.key$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)service-account.*\.json$/,
  /(^|\/)id_rsa$/, /(^|\/)id_ed25519$/,
]

export const isSecretPath = (rel: string) => SECRET_PATTERNS.some((re) => re.test(rel))

/** Resolve a model-supplied path inside the project, or throw. This is the
 *  only place a path from the model becomes a real filesystem path. */
export function safePath(ctx: ToolContext, input: unknown): { abs: string; rel: string } {
  if (typeof input !== 'string' || !input.trim()) throw new Error('A file path is required')
  const root = resolve(ctx.projectPath)
  const abs = resolve(root, input)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || rel.startsWith(sep) || resolve(abs) === root && input.includes('..')) {
    throw new Error('Path escapes the project directory')
  }
  if (isSecretPath(rel)) throw new Error(`${rel} is a protected credential file and is never read by the agent`)
  return { abs, rel: rel || '.' }
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'read_file', tier: 'safe',
    description: 'Read a UTF-8 text file from the project. Paths are relative to the project root.',
    parameters: { path: { type: 'string', description: 'Path relative to the project root', required: true } },
  },
  {
    name: 'list_directory', tier: 'safe',
    description: 'List the entries of a directory in the project.',
    parameters: { path: { type: 'string', description: 'Directory relative to the project root' } },
  },
  {
    name: 'search_code', tier: 'safe',
    description: 'Search the project for a literal string and return matching lines with their file and line number.',
    parameters: { query: { type: 'string', description: 'Text to search for', required: true } },
  },
  {
    name: 'search_files', tier: 'safe',
    description: 'Find files whose path matches a fragment.',
    parameters: { query: { type: 'string', description: 'Part of a file name or path', required: true } },
  },
  {
    name: 'find_symbol', tier: 'safe',
    description: 'Find likely definitions of a function, class, type or constant.',
    parameters: { name: { type: 'string', description: 'Symbol name', required: true } },
  },
  {
    name: 'git_status', tier: 'safe',
    description: 'List files changed in the working tree.',
    parameters: {},
  },
  {
    name: 'git_diff', tier: 'safe',
    description: 'Show the unified diff of the working tree, optionally for one file.',
    parameters: { path: { type: 'string', description: 'Optional file to diff' } },
  },
  {
    name: 'git_log', tier: 'safe',
    description: 'Show recent commits.',
    parameters: { limit: { type: 'number', description: 'How many commits (default 20)' } },
  },
  {
    name: 'git_branch', tier: 'safe',
    description: 'List branches and show which one is checked out.',
    parameters: {},
  },
  {
    name: 'write_file', tier: 'confirm',
    description: 'Replace the entire contents of a file. The user reviews a diff before it is applied.',
    parameters: {
      path: { type: 'string', description: 'Path relative to the project root', required: true },
      content: { type: 'string', description: 'The complete new file contents', required: true },
    },
  },
  {
    name: 'edit_file', tier: 'confirm',
    description: 'Replace one exact occurrence of a string in a file. The user reviews a diff before it is applied.',
    parameters: {
      path: { type: 'string', description: 'Path relative to the project root', required: true },
      old_text: { type: 'string', description: 'Exact text to replace; must occur exactly once', required: true },
      new_text: { type: 'string', description: 'Replacement text', required: true },
    },
  },
  {
    name: 'create_file', tier: 'confirm',
    description: 'Create a new file that does not yet exist.',
    parameters: {
      path: { type: 'string', description: 'Path relative to the project root', required: true },
      content: { type: 'string', description: 'File contents', required: true },
    },
  },
  {
    name: 'run_terminal', tier: 'confirm',
    description: 'Run a shell command in the project directory and return its output.',
    parameters: { command: { type: 'string', description: 'The command line to run', required: true } },
  },
  {
    name: 'git_commit', tier: 'confirm',
    description: 'Stage all changes and create a commit.',
    parameters: { message: { type: 'string', description: 'Commit message', required: true } },
  },
  {
    name: 'delete_file', tier: 'dangerous',
    description: 'Delete a file from the project. Always requires explicit confirmation.',
    parameters: { path: { type: 'string', description: 'Path relative to the project root', required: true } },
  },
]

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

export const tierOf = (name: string): ToolTier => TOOL_BY_NAME.get(name)?.tier ?? 'dangerous'

/** JSON Schema for the model's tool-calling interface. */
export function toolSchemas() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }]),
      ),
      required: Object.entries(t.parameters).filter(([, v]) => v.required).map(([k]) => k),
    },
  }))
}

const clip = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, max)}\n… [truncated ${s.length - max} characters]`

const str = (v: unknown, field: string): string => {
  if (typeof v !== 'string') throw new Error(`"${field}" must be a string`)
  return v
}

/** Execute one tool call. Approval is the caller's job — by the time a call
 *  reaches here, either it is `safe` or the user has already said yes. */
export async function execute(
  name: string, args: Record<string, unknown>, ctx: ToolContext,
): Promise<ToolOutcome> {
  const cwd = ctx.projectPath
  try {
    switch (name) {
      case 'read_file': {
        const { abs, rel } = safePath(ctx, args.path)
        const info = await stat(abs)
        if (!info.isFile()) return { ok: false, output: `${rel} is not a file` }
        return { ok: true, output: clip(await readFile(abs, 'utf8'), ctx.maxChars) }
      }

      case 'list_directory': {
        const { abs, rel } = safePath(ctx, args.path ?? '.')
        const entries = await readdir(abs, { withFileTypes: true })
        const listed = entries
          .filter((e) => !isSecretPath(join(rel === '.' ? '' : rel, e.name)))
          .slice(0, 400)
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        return { ok: true, output: listed.join('\n') || '(empty)' }
      }

      case 'search_code': {
        const hits = await searchCode(cwd, str(args.query, 'query'))
        if (!hits.length) return { ok: true, output: 'No matches.' }
        return {
          ok: true,
          output: clip(hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n'), ctx.maxChars),
        }
      }

      case 'search_files': {
        const hits = await searchFiles(cwd, str(args.query, 'query'))
        return { ok: true, output: hits.map((h) => h.path).join('\n') || 'No matches.' }
      }

      case 'find_symbol': {
        const hits = await findSymbol(cwd, str(args.name, 'name'))
        return {
          ok: true,
          output: hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n') || 'No definition found.',
        }
      }

      case 'git_status': {
        const changes = await git.status(cwd)
        if (!changes.length) return { ok: true, output: 'Working tree clean.' }
        return {
          ok: true,
          output: changes.map((c) => `${c.staged ? 'staged  ' : 'unstaged'} ${c.status.padEnd(9)} ${c.path}`).join('\n'),
        }
      }

      case 'git_diff': {
        const file = typeof args.path === 'string' && args.path ? safePath(ctx, args.path).rel : undefined
        return { ok: true, output: clip(await git.diff(cwd, file, false) || 'No changes.', ctx.maxChars) }
      }

      case 'git_log': {
        const limit = Number(args.limit) > 0 ? Math.min(Number(args.limit), 100) : 20
        const log = await git.log(cwd, limit)
        return {
          ok: true,
          output: log.map((c) => `${c.short} ${new Date(c.at).toISOString().slice(0, 10)} ${c.author}: ${c.subject}`).join('\n')
            || 'No commits.',
        }
      }

      case 'git_branch': {
        const bs = await git.branches(cwd)
        return { ok: true, output: bs.map((b) => `${b.current ? '*' : ' '} ${b.name}`).join('\n') }
      }

      case 'write_file': {
        const { abs, rel } = safePath(ctx, args.path)
        const after = str(args.content, 'content')
        const before = existsSync(abs) ? await readFile(abs, 'utf8') : ''
        return { ok: true, output: `Prepared a full rewrite of ${rel}.`, edit: { path: rel, before, after } }
      }

      case 'create_file': {
        const { abs, rel } = safePath(ctx, args.path)
        if (existsSync(abs)) return { ok: false, output: `${rel} already exists — use edit_file or write_file.` }
        return {
          ok: true,
          output: `Prepared a new file ${rel}.`,
          edit: { path: rel, before: '', after: str(args.content, 'content') },
        }
      }

      case 'edit_file': {
        const { abs, rel } = safePath(ctx, args.path)
        const before = await readFile(abs, 'utf8')
        const oldText = str(args.old_text, 'old_text')
        const count = before.split(oldText).length - 1
        if (count === 0) return { ok: false, output: `That exact text does not appear in ${rel}.` }
        if (count > 1) return { ok: false, output: `That text appears ${count} times in ${rel}; make it unique.` }
        const after = before.replace(oldText, str(args.new_text, 'new_text'))
        return { ok: true, output: `Prepared an edit to ${rel}.`, edit: { path: rel, before, after } }
      }

      case 'run_terminal': {
        const command = str(args.command, 'command')
        const r = await run('/bin/sh', ['-c', command], cwd, 60_000)
        const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
        return { ok: r.ok, output: clip(out || '(no output)', ctx.maxChars) }
      }

      case 'git_commit': {
        const message = str(args.message, 'message')
        const staged = await run('git', ['add', '-A'], cwd)
        if (!staged.ok) return { ok: false, output: staged.stderr || 'git add failed' }
        const r = await git.commit(cwd, message)
        return { ok: r.ok, output: (r.stdout || r.stderr).trim() }
      }

      case 'delete_file': {
        const { abs, rel } = safePath(ctx, args.path)
        await unlink(abs)
        return { ok: true, output: `Deleted ${rel}.` }
      }

      default:
        return { ok: false, output: `Unknown tool "${name}".` }
    }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : 'Tool failed' }
  }
}

/** Apply an edit the user approved in the diff view. */
export async function applyEdit(ctx: ToolContext, path: string, after: string): Promise<void> {
  const { abs } = safePath(ctx, path)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, after, 'utf8')
}
