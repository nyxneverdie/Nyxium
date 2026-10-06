/**
 * Self-check for the backup exclusion engine — the code that decides which
 * files are allowed to leave the machine. Run via `npm run check`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_EXCLUDES, isExcluded, isSecret, parseIgnore, scan,
} from './backup.ts'

/* ── Secret exclusions are absolute ──────────────────────────────────── */

for (const p of [
  '.env', '.env.production', 'config/.env.local',
  'certs/server.pem', 'certs/server.key', 'deploy/credentials.json',
  'deploy/service-account-prod.json', '.ssh/id_rsa', 'home/.ssh/config',
  '.aws/credentials', '.npmrc',
]) {
  assert.ok(isSecret(p), `${p} must be treated as a secret`)
}

for (const p of ['src/env.ts', 'docs/environment.md', 'keys.ts', 'src/credentials.service.ts']) {
  assert.ok(!isSecret(p), `${p} must NOT be mistaken for a secret`)
}

/* ── Ignore patterns ─────────────────────────────────────────────────── */

const rules = parseIgnore(DEFAULT_EXCLUDES.join('\n'))
assert.ok(isExcluded('node_modules', rules, true), 'node_modules/ excluded at the root')
assert.ok(isExcluded('packages/web/node_modules', rules, true), 'node_modules/ excluded at any depth')
assert.ok(isExcluded('dist', rules, true), 'dist/ excluded')
assert.ok(!isExcluded('src/index.ts', rules, false), 'source is kept')
assert.ok(!isExcluded('distribution.md', rules, false), 'a dist prefix is not a dist directory')

const globs = parseIgnore(['*.log', 'tmp/', '/root-only.txt', '**/generated/'].join('\n'))
assert.ok(isExcluded('server.log', globs, false), '*.log matches at the root')
assert.ok(isExcluded('logs/deep/server.log', globs, false), '*.log matches at depth')
assert.ok(isExcluded('root-only.txt', globs, false), 'an anchored pattern matches at the root')
assert.ok(!isExcluded('sub/root-only.txt', globs, false), 'an anchored pattern does NOT match deeper')
assert.ok(isExcluded('src/generated', globs, true), '**/ matches at depth')

// Last rule wins, so a negation can re-include.
const negated = parseIgnore(['*.log', '!keep.log'].join('\n'))
assert.ok(isExcluded('a.log', negated, false), 'the broad rule still excludes')
assert.ok(!isExcluded('keep.log', negated, false), 'a later negation re-includes')

assert.equal(parseIgnore('# just a comment\n\n   \n').length, 0, 'comments and blanks are ignored')

/* ── Scanning a real tree ────────────────────────────────────────────── */

const dir = mkdtempSync(join(tmpdir(), 'nyx-backup-check-'))
try {
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'node_modules/left-pad'), { recursive: true })
  mkdirSync(join(dir, '.git'))
  mkdirSync(join(dir, 'logs'))

  writeFileSync(join(dir, 'src/index.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'package.json'), '{}\n')
  writeFileSync(join(dir, '.env'), 'SECRET=hunter2\n')
  writeFileSync(join(dir, 'deploy-key.pem'), 'PRIVATE\n')
  writeFileSync(join(dir, 'node_modules/left-pad/index.js'), 'module.exports = 1\n')
  writeFileSync(join(dir, '.git/HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(dir, 'logs/run.log'), 'noise\n')

  const result = await scan(dir)

  assert.ok(result.files.includes('src/index.ts'), 'source is included')
  assert.ok(result.files.includes('package.json'), 'manifest is included')
  assert.ok(!result.files.some((f) => f.startsWith('node_modules/')), 'node_modules is skipped entirely')
  assert.ok(!result.files.some((f) => f.startsWith('.git/')), '.git is skipped entirely')

  // The important guarantee: secrets are not merely skipped, they are reported,
  // so the UI can tell the user what was held back.
  assert.ok(!result.files.includes('.env'), '.env never enters the file list')
  assert.ok(!result.files.includes('deploy-key.pem'), 'a private key never enters the file list')
  assert.ok(result.excludedSecrets.includes('.env'), 'the held-back .env is reported')
  assert.ok(result.excludedSecrets.includes('deploy-key.pem'), 'the held-back key is reported')
  assert.ok(result.totalBytes > 0, 'a size is computed for the included files')

  // A project .nyxiumignore overrides the defaults — but not the secret layer.
  writeFileSync(join(dir, '.nyxiumignore'), 'logs/\n')
  const withIgnore = await scan(dir)
  assert.ok(!withIgnore.files.includes('logs/run.log'), 'the custom ignore applies')
  assert.ok(
    withIgnore.files.some((f) => f.startsWith('node_modules/')),
    'a custom ignore replaces the defaults, so node_modules returns',
  )
  assert.ok(!withIgnore.files.includes('.env'), 'a custom ignore can NEVER re-include a secret')

  // Even an explicit attempt to un-ignore a secret must fail.
  writeFileSync(join(dir, '.nyxiumignore'), '!.env\n!*.pem\n')
  const forced = await scan(dir)
  assert.ok(!forced.files.includes('.env'), 'an explicit !.env does not override the secret layer')
  assert.ok(!forced.files.includes('deploy-key.pem'), 'an explicit !*.pem does not override it either')

  console.log('backup.check: all assertions passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
