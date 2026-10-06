import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { JsonStore } from './store.js'
import { getSecret, setSecret } from './secrets.js'
import { run } from './system.js'
import type {
  DbConnection, DbDriver, DbQueryResult, DbTable,
} from '../../shared/types.js'

/**
 * Databases through each engine's own CLI client. Passwords live in the OS
 * keyring, never in the connection JSON, and are passed to the client through
 * the environment rather than on the command line, where `ps` would expose them.
 */

export const connectionStore = new JsonStore<{ items: DbConnection[] }>('databases.json', { items: [] })

const secretKey = (id: string) => `db.${id}.password`

/** Statements that change or destroy data. Running one needs confirmation. */
const DESTRUCTIVE = /^\s*(drop|delete|truncate|alter|update|insert|replace|grant|revoke|create|rename|flushall|flushdb)\b/i

export const isDestructive = (sql: string) => {
  // Strip comments first, so `-- harmless` DROP ... is still caught.
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
  return DESTRUCTIVE.test(stripped)
}

export function saveConnection(input: Partial<DbConnection>, password: string | null): DbConnection[] {
  const { items } = connectionStore.read()
  const id = input.id && items.some((c) => c.id === input.id) ? input.id : randomUUID()
  const conn: DbConnection = {
    id,
    name: (input.name ?? 'Connection').slice(0, 80),
    driver: (input.driver ?? 'sqlite') as DbDriver,
    host: (input.host ?? '127.0.0.1').slice(0, 200),
    port: Number(input.port) || defaultPort(input.driver ?? 'sqlite'),
    database: (input.database ?? '').slice(0, 300),
    user: (input.user ?? '').slice(0, 120),
    hasPassword: false,
    projectId: input.projectId ?? null,
  }
  if (password !== null) setSecret(secretKey(id), password || null)
  conn.hasPassword = !!getSecret(secretKey(id))

  const next = items.some((c) => c.id === id)
    ? items.map((c) => (c.id === id ? conn : c))
    : [...items, conn]
  return connectionStore.write({ items: next }).items
}

export function removeConnection(id: string): DbConnection[] {
  setSecret(secretKey(id), null)
  return connectionStore.write({ items: connectionStore.read().items.filter((c) => c.id !== id) }).items
}

function defaultPort(driver: DbDriver) {
  return driver === 'postgres' ? 5432 : driver === 'mysql' ? 3306 : driver === 'redis' ? 6379 : 0
}

const byId = (id: string) => {
  const c = connectionStore.read().items.find((x) => x.id === id)
  if (!c) throw new Error('Unknown connection')
  return c
}

/** Run one statement through the engine's CLI and normalise the result. */
async function exec(conn: DbConnection, sql: string, timeout = 30_000): Promise<DbQueryResult> {
  const password = getSecret(secretKey(conn.id)) ?? ''

  switch (conn.driver) {
    case 'sqlite': {
      if (!conn.database) throw new Error('No database file is set for this connection.')
      if (!existsSync(conn.database)) throw new Error(`No such database file: ${conn.database}`)
      const r = await run('sqlite3', ['-header', '-json', conn.database, sql], undefined, timeout)
      if (!r.ok) throw new Error(cleanError(r.stderr, 'sqlite3'))
      return fromJsonRows(r.stdout)
    }

    case 'postgres': {
      // psql reads PGPASSWORD from the environment, keeping it out of argv.
      // -A unaligned + a field separator, with the header row kept so real
      // column names are shown instead of invented ones.
      const r = await runWithEnv('psql', [
        '-h', conn.host, '-p', String(conn.port), '-U', conn.user, '-d', conn.database,
        '-A', '-F', '\x1f', '--pset=footer=off', '--no-psqlrc', '-c', sql,
      ], { PGPASSWORD: password }, timeout)
      if (!r.ok) throw new Error(cleanError(r.stderr, 'psql'))
      return fromDelimitedWithHeader(r.stdout, '\x1f')
    }

    case 'mysql': {
      const r = await runWithEnv('mysql', [
        '-h', conn.host, '-P', String(conn.port), '-u', conn.user,
        ...(conn.database ? ['-D', conn.database] : []),
        '--batch', '--raw', '-e', sql,
      ], { MYSQL_PWD: password }, timeout)
      if (!r.ok) throw new Error(cleanError(r.stderr, 'mysql'))
      return fromTsvWithHeader(r.stdout)
    }

    case 'redis': {
      const args = ['-h', conn.host, '-p', String(conn.port), ...(password ? ['-a', password, '--no-auth-warning'] : [])]
      const r = await run('redis-cli', [...args, ...sql.trim().split(/\s+/)], undefined, timeout)
      if (!r.ok) throw new Error(cleanError(r.stderr, 'redis-cli'))
      return {
        columns: ['result'],
        rows: r.stdout.split('\n').filter(Boolean).map((v) => [v]),
        rowCount: r.stdout.split('\n').filter(Boolean).length,
      }
    }
  }
}

function runWithEnv(cmd: string, args: string[], env: Record<string, string>, timeout: number) {
  const prev = { ...process.env }
  Object.assign(process.env, env)
  return run(cmd, args, undefined, timeout).finally(() => {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  })
}

function cleanError(stderr: string, tool: string): string {
  const first = stderr.split('\n').map((l) => l.trim()).find(Boolean)
  if (!first) return `${tool} failed.`
  if (/command not found|ENOENT/i.test(first)) {
    return `${tool} is not installed. Install the client to use this connection.`
  }
  return first.slice(0, 400)
}

function fromJsonRows(stdout: string): DbQueryResult {
  const text = stdout.trim()
  if (!text) return { columns: [], rows: [], rowCount: 0 }
  try {
    const parsed = JSON.parse(text) as Array<Record<string, unknown>>
    const columns = parsed.length ? Object.keys(parsed[0]) : []
    return {
      columns,
      rows: parsed.map((r) => columns.map((c) => (r[c] === null ? null : String(r[c])))),
      rowCount: parsed.length,
    }
  } catch {
    return { columns: ['output'], rows: text.split('\n').map((l) => [l]), rowCount: 0 }
  }
}

function fromDelimitedWithHeader(stdout: string, sep: string): DbQueryResult {
  const lines = stdout.split('\n').filter((l) => l.length)
  if (!lines.length) return { columns: [], rows: [], rowCount: 0 }
  const [header, ...rest] = lines
  return { columns: header.split(sep), rows: rest.map((l) => l.split(sep)), rowCount: rest.length }
}

function fromTsvWithHeader(stdout: string): DbQueryResult {
  const lines = stdout.split('\n').filter((l) => l.length)
  if (!lines.length) return { columns: [], rows: [], rowCount: 0 }
  const [header, ...rest] = lines
  return {
    columns: header.split('\t'),
    rows: rest.map((l) => l.split('\t')),
    rowCount: rest.length,
  }
}

export async function testConnection(id: string): Promise<{ ok: boolean; detail: string | null }> {
  const conn = byId(id)
  const probe = conn.driver === 'redis' ? 'PING'
    : conn.driver === 'sqlite' ? 'SELECT 1' : 'SELECT 1'
  try {
    await exec(conn, probe, 10_000)
    return { ok: true, detail: null }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'Connection failed' }
  }
}

export async function tables(id: string): Promise<DbTable[]> {
  const conn = byId(id)
  const sql = conn.driver === 'sqlite'
    ? "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    : conn.driver === 'postgres'
      ? "SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY tablename"
      : conn.driver === 'mysql'
        ? 'SHOW TABLES'
        : 'KEYS *'
  const r = await exec(conn, sql)
  return r.rows.map((row) => ({ name: String(row[0] ?? '') })).filter((t) => t.name)
}

export async function schema(id: string, table: string): Promise<DbQueryResult> {
  const conn = byId(id)
  const safe = table.replace(/[^\w.$-]/g, '')
  if (!safe) throw new Error('Invalid table name')
  const sql = conn.driver === 'sqlite' ? `PRAGMA table_info("${safe}")`
    : conn.driver === 'postgres'
      ? `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='${safe}' ORDER BY ordinal_position`
      : conn.driver === 'mysql' ? `DESCRIBE \`${safe}\``
        : `TYPE ${safe}`
  return exec(conn, sql)
}

export async function browse(id: string, table: string, limit = 100): Promise<DbQueryResult> {
  const conn = byId(id)
  const safe = table.replace(/[^\w.$-]/g, '')
  if (!safe) throw new Error('Invalid table name')
  const n = Math.min(Math.max(1, limit), 1000)
  const sql = conn.driver === 'redis' ? `GET ${safe}`
    : conn.driver === 'mysql' ? `SELECT * FROM \`${safe}\` LIMIT ${n}`
      : `SELECT * FROM "${safe}" LIMIT ${n}`
  return exec(conn, sql)
}

/** Free-form query. The caller must already have confirmed a destructive one. */
export async function query(id: string, sql: string): Promise<DbQueryResult> {
  return exec(byId(id), sql.slice(0, 100_000))
}
