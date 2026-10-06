// Builds one self-check with esbuild and runs it. Electron is aliased to a stub
// so a check can import real services without a desktop runtime.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const source = process.argv[2]
if (!source) { console.error('usage: run-check.mjs <path/to/file.check.ts>'); process.exit(2) }

const out = join(root, 'node_modules/.cache', `${source.replace(/[\/.]/g, '-')}.mjs`)
execFileSync(join(root, 'node_modules/.bin/esbuild'), [
  source, '--bundle', '--platform=node', '--format=esm',
  `--alias:electron=${join(here, 'electron-stub.mjs')}`,
  `--outfile=${out}`,
], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })

execFileSync(process.execPath, [out], { cwd: root, stdio: 'inherit' })
