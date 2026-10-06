/**
 * Self-check for the agent tool layer — the part that decides what a model is
 * allowed to touch. Run via `npm run check`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyEdit, execute, safePath, tierOf, toolSchemas, isSecretPath, type ToolContext } from './tools.ts'

const dir = mkdtempSync(join(tmpdir(), 'nyx-tools-check-'))
const ctx: ToolContext = { projectPath: dir, maxChars: 1000 }

try {
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src/auth.ts'), 'export function auth() {\n  return getToken()\n}\n')
  writeFileSync(join(dir, '.env'), 'SECRET=hunter2\n')
  writeFileSync(join(dir, 'twice.ts'), 'const x = 1\nconst x2 = 1\n')

  /* ── Path containment ──────────────────────────────────────────────── */

  assert.equal(safePath(ctx, 'src/auth.ts').rel, join('src', 'auth.ts'), 'relative path resolves')
  assert.throws(() => safePath(ctx, '../../../etc/passwd'), /escapes/, 'parent traversal refused')
  assert.throws(() => safePath(ctx, '/etc/passwd'), /escapes/, 'absolute path outside project refused')
  assert.throws(() => safePath(ctx, 'src/../../outside.ts'), /escapes/, 'traversal through a subdir refused')

  /* ── Credential protection ─────────────────────────────────────────── */

  assert.ok(isSecretPath('.env'), '.env is protected')
  assert.ok(isSecretPath('.env.production'), '.env.* is protected')
  assert.ok(isSecretPath('deploy/service-account-prod.json'), 'service account json is protected')
  assert.ok(isSecretPath('keys/id_ed25519'), 'ssh key is protected')
  assert.ok(!isSecretPath('src/env.ts'), 'ordinary source is not mistaken for a secret')

  const envRead = await execute('read_file', { path: '.env' }, ctx)
  assert.equal(envRead.ok, false, '.env cannot be read through the tool')
  assert.ok(/protected/.test(envRead.output), 'refusal explains why')
  assert.ok(!envRead.output.includes('hunter2'), 'secret value never reaches the output')

  const listed = await execute('list_directory', { path: '.' }, ctx)
  assert.ok(!listed.output.includes('.env'), 'protected files are hidden from directory listings')

  /* ── Reads ─────────────────────────────────────────────────────────── */

  const read = await execute('read_file', { path: 'src/auth.ts' }, ctx)
  assert.ok(read.ok && read.output.includes('getToken'), 'ordinary file reads fine')

  const found = await execute('search_code', { query: 'getToken' }, ctx)
  assert.ok(found.output.includes('src/auth.ts'), 'search_code finds the file')

  const sym = await execute('find_symbol', { name: 'auth' }, ctx)
  assert.ok(sym.output.includes('src/auth.ts'), 'find_symbol locates the definition')

  /* ── Edits are proposed, never written ─────────────────────────────── */

  const edit = await execute(
    'edit_file',
    { path: 'src/auth.ts', old_text: 'return getToken()', new_text: 'return await getToken()' },
    ctx,
  )
  assert.ok(edit.ok && edit.edit, 'edit_file returns a proposed edit')
  assert.ok(edit.edit!.after.includes('await getToken()'), 'edit content is correct')
  assert.equal(
    readFileSync(join(dir, 'src/auth.ts'), 'utf8').includes('await'),
    false,
    'edit_file does NOT touch the disk by itself',
  )

  const ambiguous = await execute(
    'edit_file', { path: 'twice.ts', old_text: 'const x', new_text: 'const y' }, ctx,
  )
  assert.equal(ambiguous.ok, false, 'a non-unique match is refused')
  assert.ok(/2 times/.test(ambiguous.output), 'refusal says how many matches there were')

  const missing = await execute(
    'edit_file', { path: 'src/auth.ts', old_text: 'nonexistent', new_text: 'x' }, ctx,
  )
  assert.equal(missing.ok, false, 'a missing match is refused')

  const clobber = await execute('create_file', { path: 'src/auth.ts', content: 'x' }, ctx)
  assert.equal(clobber.ok, false, 'create_file refuses to overwrite an existing file')

  // Applying the approved edit is a separate, explicit step.
  await applyEdit(ctx, edit.edit!.path, edit.edit!.after)
  assert.ok(
    readFileSync(join(dir, 'src/auth.ts'), 'utf8').includes('await getToken()'),
    'applyEdit writes the approved content',
  )

  /* ── Permission tiers ──────────────────────────────────────────────── */

  assert.equal(tierOf('read_file'), 'safe')
  assert.equal(tierOf('git_status'), 'safe')
  assert.equal(tierOf('write_file'), 'confirm')
  assert.equal(tierOf('run_terminal'), 'confirm')
  assert.equal(tierOf('delete_file'), 'dangerous')
  assert.equal(tierOf('something_invented'), 'dangerous', 'unknown tools default to the strictest tier')

  const schemas = toolSchemas()
  assert.ok(schemas.every((s) => s.parameters.type === 'object'), 'every schema is an object schema')
  assert.ok(
    schemas.find((s) => s.name === 'edit_file')!.parameters.required.includes('old_text'),
    'required parameters are declared',
  )

  console.log('tools.check: all assertions passed')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
