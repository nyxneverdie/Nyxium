import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { dataPath } from './store.js'

/**
 * Credentials live here and nowhere else: encrypted with the OS keyring via
 * Electron's safeStorage, in the data directory, never in the JSON config and
 * never handed to the renderer. The renderer may only set a value or ask
 * whether one exists.
 */

const FILE = dataPath('credentials.bin')

type Vault = Record<string, string>

function read(): Vault {
  if (!existsSync(FILE)) return {}
  try {
    const raw = readFileSync(FILE)
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : Buffer.from(raw.toString('utf8'), 'base64').toString('utf8')
    return JSON.parse(json) as Vault
  } catch {
    // A corrupt or undecryptable vault must not break startup; the user can re-enter.
    return {}
  }
}

function write(vault: Vault) {
  const json = JSON.stringify(vault)
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    // No OS keyring (a bare Linux session, say). Still kept out of the config
    // directory and off the renderer, and the UI says it is not encrypted.
    : Buffer.from(Buffer.from(json, 'utf8').toString('base64'), 'utf8')
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, buf)
  chmodSync(tmp, 0o600)
  renameSync(tmp, FILE)
}

export const getSecret = (key: string): string | null => read()[key] ?? null

export function setSecret(key: string, value: string | null) {
  const vault = read()
  if (value) vault[key] = value
  else delete vault[key]
  write(vault)
}

export const hasSecret = (key: string) => !!read()[key]

/** True when the OS keyring is backing the vault. Surfaced in Settings. */
export const encryptionAvailable = () => safeStorage.isEncryptionAvailable()
