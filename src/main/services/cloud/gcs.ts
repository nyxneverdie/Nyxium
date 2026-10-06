import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CloudObject, CloudBucket, CloudCredentialKind } from '../../../shared/types.js'
import { run } from '../system.js'
import { getSecret } from '../secrets.js'

/**
 * Google Cloud Storage over its JSON API.
 *
 * Credentials never reach the renderer and are never written to the config.
 * Two sources, in order of preference:
 *   1. gcloud's application-default credentials, via the installed CLI
 *   2. a service-account JSON the user supplied, kept in the OS keyring
 */

export const GCS_SA_KEY = 'cloud.gcs.serviceAccount'

// NYX_GCS_ORIGIN redirects the API at a stub, for verifying the browser and
// transfer code without a real Google Cloud project.
const ORIGIN = process.env.NYX_GCS_ORIGIN ?? 'https://storage.googleapis.com'
const API = `${ORIGIN}/storage/v1`
const UPLOAD = `${ORIGIN}/upload/storage/v1`

interface Token { value: string; expiresAt: number }
let cached: Token | null = null

/** A token from the gcloud CLI, when the user is already logged in there. */
async function gcloudToken(): Promise<Token | null> {
  const r = await run('gcloud', ['auth', 'application-default', 'print-access-token'], undefined, 10_000)
  const value = r.stdout.trim()
  if (!r.ok || !value) return null
  // gcloud does not report the lifetime here; one hour is the documented default,
  // and we refresh a minute early.
  return { value, expiresAt: Date.now() + 55 * 60_000 }
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Mint a token from a service-account key with a signed JWT assertion. */
async function serviceAccountToken(json: string): Promise<Token | null> {
  let sa: { client_email?: string; private_key?: string; token_uri?: string }
  try { sa = JSON.parse(json) } catch { return null }
  if (!sa.client_email || !sa.private_key) return null

  const { createSign } = await import('node:crypto')
  const now = Math.floor(Date.now() / 1000)
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = b64url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_write',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = b64url(signer.sign(sa.private_key))

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) return null
  return { value: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 3600) - 300) * 1000 }
}

async function token(): Promise<Token | null> {
  if (process.env.NYX_GCS_ORIGIN) return { value: 'stub-token', expiresAt: Date.now() + 3.6e6 }
  if (cached && cached.expiresAt > Date.now()) return cached
  const sa = getSecret(GCS_SA_KEY)
  cached = (sa ? await serviceAccountToken(sa) : null) ?? (await gcloudToken())
  return cached
}

export function forgetToken() {
  cached = null
}

/** Which credential Nyxium would use right now, without exposing it. */
export async function credentialKind(): Promise<CloudCredentialKind> {
  if (process.env.NYX_GCS_ORIGIN) return 'gcloud'
  if (getSecret(GCS_SA_KEY)) return 'service-account'
  const r = await run('gcloud', ['--version'], undefined, 5000)
  if (!r.ok) return 'none'
  return (await gcloudToken()) ? 'gcloud' : 'none'
}

export class CloudError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

/** Turn a Google error payload into something a user can act on. */
async function fail(res: Response): Promise<never> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch { /* non-JSON error body */ }

  const message = res.status === 401 || res.status === 403
    ? 'Google Cloud rejected the credentials. Re-authenticate, or check the bucket permissions.'
    : res.status === 404
      ? 'Not found. Check the project and bucket names.'
      : detail || `Google Cloud returned HTTP ${res.status}.`
  throw new CloudError(message, res.status)
}

async function authed(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await token()
  if (!t) {
    throw new CloudError(
      'Not connected to Google Cloud. Run `gcloud auth application-default login`, or add a service-account key in Settings.',
    )
  }
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${t.value}` },
  })
  if (!res.ok) await fail(res)
  return res
}

export async function listBuckets(project: string): Promise<CloudBucket[]> {
  const res = await authed(`${API}/b?project=${encodeURIComponent(project)}&maxResults=200`)
  const body = (await res.json()) as { items?: Array<{ name: string; location?: string; storageClass?: string }> }
  return (body.items ?? []).map((b) => ({
    name: b.name,
    location: b.location ?? null,
    storageClass: b.storageClass ?? null,
  }))
}

/**
 * One "directory" level: `prefixes` are sub-folders, `objects` are files.
 * Pagination is explicit so a huge bucket never arrives in one response.
 */
export async function listObjects(
  bucket: string, prefix: string, pageToken?: string,
): Promise<{ prefixes: string[]; objects: CloudObject[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({
    delimiter: '/',
    maxResults: '200',
    ...(prefix ? { prefix } : {}),
    ...(pageToken ? { pageToken } : {}),
  })
  const res = await authed(`${API}/b/${encodeURIComponent(bucket)}/o?${params}`)
  const body = (await res.json()) as {
    prefixes?: string[]
    items?: Array<{ name: string; size?: string; updated?: string; contentType?: string }>
    nextPageToken?: string
  }
  return {
    prefixes: body.prefixes ?? [],
    objects: (body.items ?? [])
      // The placeholder object for a folder itself is noise in a file list.
      .filter((o) => o.name !== prefix)
      .map((o) => ({
        name: o.name,
        size: Number(o.size ?? 0),
        updated: o.updated ? Date.parse(o.updated) : 0,
        contentType: o.contentType ?? null,
      })),
    nextPageToken: body.nextPageToken ?? null,
  }
}

/** Server-side name search within a prefix. GCS has no substring query, so a
 *  bounded scan is done here rather than pretending the API supports it. */
export async function searchObjects(
  bucket: string, prefix: string, query: string, limit = 100,
): Promise<CloudObject[]> {
  const q = query.toLowerCase()
  const found: CloudObject[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    const params = new URLSearchParams({
      maxResults: '1000',
      ...(prefix ? { prefix } : {}),
      ...(pageToken ? { pageToken } : {}),
    })
    const res = await authed(`${API}/b/${encodeURIComponent(bucket)}/o?${params}`)
    const body = (await res.json()) as {
      items?: Array<{ name: string; size?: string; updated?: string; contentType?: string }>
      nextPageToken?: string
    }
    for (const o of body.items ?? []) {
      if (!o.name.toLowerCase().includes(q)) continue
      found.push({
        name: o.name,
        size: Number(o.size ?? 0),
        updated: o.updated ? Date.parse(o.updated) : 0,
        contentType: o.contentType ?? null,
      })
      if (found.length >= limit) return found
    }
    pageToken = body.nextPageToken
  } while (pageToken && ++pages < 10)
  return found
}

export interface TransferHandle {
  onProgress: (sent: number, total: number) => void
  signal: AbortSignal
}

export async function upload(
  bucket: string, objectName: string, localPath: string, handle: TransferHandle,
): Promise<CloudObject> {
  const total = statSync(localPath).size
  let sent = 0

  const source = createReadStream(localPath)
  source.on('data', (chunk: string | Buffer) => {
    sent += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    handle.onProgress(sent, total)
  })

  const url = `${UPLOAD}/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`
  const t = await token()
  if (!t) throw new CloudError('Not connected to Google Cloud.')

  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${t.value}`, 'content-type': 'application/octet-stream' },
    body: Readable.toWeb(source) as ReadableStream,
    duplex: 'half',
    signal: handle.signal,
  } as RequestInit)
  if (!res.ok) await fail(res)

  const body = (await res.json()) as { name: string; size?: string; updated?: string; contentType?: string }
  return {
    name: body.name,
    size: Number(body.size ?? total),
    updated: body.updated ? Date.parse(body.updated) : Date.now(),
    contentType: body.contentType ?? null,
  }
}

export async function download(
  bucket: string, objectName: string, localPath: string, handle: TransferHandle,
): Promise<void> {
  const url = `${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`
  const res = await authed(url, { signal: handle.signal })
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0

  await mkdir(dirname(localPath), { recursive: true })
  const out = createWriteStream(localPath)
  const counter = new Writable({
    write(chunk: Buffer, _enc, cb) {
      received += chunk.length
      handle.onProgress(received, total)
      out.write(chunk, cb)
    },
    final(cb) { out.end(cb) },
  })
  await pipeline(Readable.fromWeb(res.body as never), counter)
}

export async function remove(bucket: string, objectName: string): Promise<void> {
  await authed(
    `${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`,
    { method: 'DELETE' },
  )
}

/** GCS has no rename: copy then delete, which is what `gsutil mv` does too. */
export async function move(bucket: string, from: string, to: string): Promise<void> {
  await authed(
    `${API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(from)}`
    + `/copyTo/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(to)}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  )
  await remove(bucket, from)
}

/** A prefix is not a real object; an empty placeholder is how GCS shows folders. */
export async function createFolder(bucket: string, prefix: string): Promise<void> {
  const name = prefix.endsWith('/') ? prefix : `${prefix}/`
  const url = `${UPLOAD}/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`
  await authed(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' })
}
