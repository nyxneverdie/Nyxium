import { run } from './system.js'
import type { GitFileChange, GitCommit, GitBranchInfo, GitStashEntry } from '../../shared/types.js'

/** All Git work goes through `git` itself — no reimplementation of its semantics. */
const git = (cwd: string, args: string[], timeout = 15_000) => run('git', args, cwd, timeout)

const STATUS_LABEL: Record<string, GitFileChange['status']> = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflicted', '?': 'untracked',
}

export async function status(cwd: string): Promise<GitFileChange[]> {
  const r = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (!r.ok) return []
  const out: GitFileChange[] = []
  const parts = r.stdout.split('\0').filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const [x, y] = parts[i]
    const path = parts[i].slice(3)
    // With -z a rename writes the old path as the following record.
    if (x === 'R' || x === 'C') i++
    if (x === '?') { out.push({ path, staged: false, status: 'untracked' }); continue }
    if (x !== ' ') out.push({ path, staged: true, status: STATUS_LABEL[x] ?? 'modified' })
    if (y !== ' ') out.push({ path, staged: false, status: STATUS_LABEL[y] ?? 'modified' })
  }
  return out
}

export async function diff(cwd: string, file?: string, staged = false): Promise<string> {
  const args = ['diff', '--no-color', ...(staged ? ['--cached'] : []), ...(file ? ['--', file] : [])]
  const r = await git(cwd, args)
  if (r.stdout.trim()) return r.stdout
  // Untracked files have no diff; show the content as an all-added hunk.
  if (file && !staged) {
    const show = await run('git', ['status', '--porcelain=v1', '--', file], cwd)
    if (show.stdout.startsWith('??')) {
      const cat = await run('cat', [file], cwd)
      if (cat.ok) return cat.stdout.split('\n').map((l) => `+${l}`).join('\n')
    }
  }
  return r.stdout
}

export async function log(cwd: string, limit = 50): Promise<GitCommit[]> {
  const SEP = '\x1f'
  const r = await git(cwd, ['log', `-${Math.min(limit, 500)}`, `--pretty=format:%H${SEP}%h${SEP}%an${SEP}%at${SEP}%s${SEP}%D`])
  if (!r.ok) return []
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, short, author, at, subject, refs] = line.split(SEP)
    return { hash, short, author, at: Number(at) * 1000, subject, refs: refs ? refs.split(', ').filter(Boolean) : [] }
  })
}

export async function branches(cwd: string): Promise<GitBranchInfo[]> {
  const r = await git(cwd, ['branch', '--all', '--format=%(refname:short)\x1f%(HEAD)\x1f%(upstream:short)'])
  if (!r.ok) return []
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [name, head, upstream] = l.split('\x1f')
    return { name, current: head === '*', remote: name.startsWith('remotes/'), upstream: upstream || null }
  })
}

export async function stashes(cwd: string): Promise<GitStashEntry[]> {
  const r = await git(cwd, ['stash', 'list', '--pretty=format:%gd\x1f%s\x1f%at'])
  if (!r.ok) return []
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [ref, subject, at] = l.split('\x1f')
    return { ref, subject, at: Number(at) * 1000 }
  })
}

export const stage = (cwd: string, paths: string[]) => git(cwd, ['add', '--', ...paths])
export const unstage = (cwd: string, paths: string[]) => git(cwd, ['restore', '--staged', '--', ...paths])
export const discard = (cwd: string, paths: string[]) => git(cwd, ['checkout', '--', ...paths])
export const commit = (cwd: string, message: string) => git(cwd, ['commit', '-m', message])
export const pull = (cwd: string) => git(cwd, ['pull', '--ff-only'], 60_000)
export const push = (cwd: string) => git(cwd, ['push'], 60_000)
export const fetch = (cwd: string) => git(cwd, ['fetch', '--all', '--prune'], 60_000)
export const checkout = (cwd: string, name: string) => git(cwd, ['checkout', name])
export const createBranch = (cwd: string, name: string) => git(cwd, ['checkout', '-b', name])
export const merge = (cwd: string, name: string) => git(cwd, ['merge', '--no-edit', name])
export const stashPush = (cwd: string, message?: string) =>
  git(cwd, ['stash', 'push', ...(message ? ['-m', message] : [])])
export const stashPop = (cwd: string, ref: string) => git(cwd, ['stash', 'pop', ref])
export const stashDrop = (cwd: string, ref: string) => git(cwd, ['stash', 'drop', ref])
export const reset = (cwd: string, mode: 'soft' | 'mixed' | 'hard', ref: string) =>
  git(cwd, ['reset', `--${mode}`, ref])
export const clean = (cwd: string) => git(cwd, ['clean', '-fd'])
