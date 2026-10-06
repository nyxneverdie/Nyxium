/**
 * Electron's loader reads node_modules/electron/path.txt and joins it onto the
 * dist directory WITHOUT trimming. Some installs write that file with a
 * trailing newline, which produces a spawn path ending in "\n" and fails with
 * ENOENT — the binary is fine, the path is not.
 *
 * This runs on postinstall, so a reinstall cannot reintroduce the problem.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const file = join(process.cwd(), 'node_modules/electron/path.txt')
if (existsSync(file)) {
  const raw = readFileSync(file, 'utf8')
  const trimmed = raw.trim()
  if (raw !== trimmed) {
    writeFileSync(file, trimmed, 'utf8')
    console.log(`[nyxium] trimmed whitespace from electron/path.txt (${JSON.stringify(raw)} → ${JSON.stringify(trimmed)})`)
  }
}
