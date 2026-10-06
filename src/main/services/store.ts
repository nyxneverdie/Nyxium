import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const configDir = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'nyxium')
  : join(homedir(), '.config', 'nyxium')

const dataDir = process.env.XDG_DATA_HOME
  ? join(process.env.XDG_DATA_HOME, 'nyxium')
  : join(homedir(), '.local', 'share', 'nyxium')

mkdirSync(configDir, { recursive: true })
mkdirSync(dataDir, { recursive: true })

export const paths = { configDir, dataDir }
export const dataPath = (f: string) => join(dataDir, f)

/** JSON file backed by ~/.config/nyxium. Atomic writes; falls back to the default on any read error. */
export class JsonStore<T> {
  private cache: T | null = null
  constructor(private file: string, private fallback: T) {}

  private get full() {
    return join(configDir, this.file)
  }

  read(): T {
    if (this.cache) return this.cache
    try {
      this.cache = { ...this.fallback, ...JSON.parse(readFileSync(this.full, 'utf8')) }
    } catch {
      this.cache = this.fallback
    }
    return this.cache as T
  }

  write(value: T): T {
    this.cache = value
    const tmp = `${this.full}.tmp`
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, this.full)
    return value
  }

  patch(patch: Partial<T>): T {
    return this.write({ ...this.read(), ...patch })
  }
}

export const userDataReady = () => app.getPath('userData')
