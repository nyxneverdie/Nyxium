/**
 * Self-check for the Git service against a real repository.
 * Run with:  node --experimental-strip-types src/main/services/git.check.ts
 *
 * It creates a throwaway repo in /tmp, exercises the parsers that have real
 * logic in them (porcelain -z status, log, branches) and asserts the results.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from './git.ts'

const dir = mkdtempSync(join(tmpdir(), 'nyx-git-check-'))
const sh = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } })

try {
  sh('init', '-q')
  sh('config', 'user.email', 'check@nyxium')
  sh('config', 'user.name', 'Nyxium Check')

  writeFileSync(join(dir, 'kept.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'old name.ts'), 'export const b = 2\n')
  writeFileSync(join(dir, 'gone.ts'), 'export const c = 3\n')
  sh('add', '-A')
  sh('commit', '-qm', 'initial')

  // One of each interesting state, including a path with a space and a rename.
  writeFileSync(join(dir, 'kept.ts'), 'export const a = 99\n')      // unstaged modify
  sh('mv', 'old name.ts', 'new name.ts')                            // staged rename
  sh('rm', '-q', 'gone.ts')                                         // staged delete
  writeFileSync(join(dir, 'fresh.ts'), 'export const d = 4\n')      // untracked
  writeFileSync(join(dir, 'staged.ts'), 'export const e = 5\n')
  sh('add', 'staged.ts')                                            // staged add

  const changes = await git.status(dir)
  const find = (p: string, staged: boolean) =>
    changes.find((c) => c.path === p && c.staged === staged)

  assert.equal(find('kept.ts', false)?.status, 'modified', 'unstaged modify')
  assert.equal(find('staged.ts', true)?.status, 'added', 'staged add')
  assert.equal(find('gone.ts', true)?.status, 'deleted', 'staged delete')
  assert.equal(find('fresh.ts', false)?.status, 'untracked', 'untracked file')

  // The rename's new path must be reported, and the old path must NOT leak in
  // as a phantom entry — that is the trap in parsing `--porcelain -z`.
  assert.equal(find('new name.ts', true)?.status, 'renamed', 'staged rename keeps new path')
  assert.equal(find('old name.ts', true), undefined, 'rename old path is not a separate entry')
  assert.ok(!changes.some((c) => c.path.includes('\0')), 'no NUL leaked into a path')

  const log = await git.log(dir, 10)
  assert.equal(log.length, 1, 'one commit')
  assert.equal(log[0].subject, 'initial', 'commit subject parsed')
  assert.ok(log[0].at > 0 && log[0].at < Date.now() + 60_000, 'commit time in ms, not seconds')
  assert.equal(log[0].short.length >= 7, true, 'short hash parsed')

  const branches = await git.branches(dir)
  const current = branches.find((b) => b.current)
  assert.ok(current, 'a current branch is reported')
  assert.ok(!current!.name.includes('*'), 'branch name has no HEAD marker in it')

  const diff = await git.diff(dir, 'kept.ts', false)
  assert.ok(diff.includes('+export const a = 99'), 'unstaged diff shows the new line')

  const untrackedDiff = await git.diff(dir, 'fresh.ts', false)
  assert.ok(untrackedDiff.includes('+export const d = 4'), 'untracked file renders as added lines')

  console.log('git.check: all assertions passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
