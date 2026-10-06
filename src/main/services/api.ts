import { randomUUID } from 'node:crypto'
import { JsonStore } from './store.js'
import type { ApiHistoryEntry, ApiRequest, ApiResponse, HttpMethod } from '../../shared/types.js'

/**
 * The API playground issues requests from the main process, so it is not bound
 * by the renderer's CSP or CORS — which is the point of a request tool, and why
 * it must validate what it is asked to call.
 */

export const requestStore = new JsonStore<{ items: ApiRequest[] }>('api-requests.json', { items: [] })
export const historyStore = new JsonStore<{ items: ApiHistoryEntry[] }>('api-history.json', { items: [] })

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const MAX_BODY = 2_000_000

export interface SendOptions {
  method: string
  url: string
  headers: Array<{ key: string; value: string }>
  params: Array<{ key: string; value: string }>
  body: string
  timeoutMs?: number
}

export async function send(opts: SendOptions): Promise<ApiResponse> {
  const method = (String(opts.method).toUpperCase() as HttpMethod)
  if (!METHODS.includes(method)) throw new Error(`Unsupported method: ${opts.method}`)

  let url: URL
  try { url = new URL(opts.url) } catch { throw new Error('That is not a valid URL.') }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https requests are supported.')
  }

  for (const p of opts.params) {
    if (p.key.trim()) url.searchParams.set(p.key.trim(), p.value)
  }

  const headers = new Headers()
  for (const h of opts.headers) {
    if (!h.key.trim()) continue
    try { headers.set(h.key.trim(), h.value) } catch { /* an invalid header name */ }
  }

  const hasBody = method !== 'GET' && opts.body.trim().length > 0
  if (hasBody && !headers.has('content-type')) {
    // Guess only between the two cases worth guessing; otherwise leave it alone.
    const t = opts.body.trim()
    headers.set('content-type', t.startsWith('{') || t.startsWith('[') ? 'application/json' : 'text/plain')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs ?? 30_000, 120_000))
  const started = Date.now()

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? opts.body : undefined,
      signal: ctrl.signal,
      redirect: 'follow',
    })

    const raw = await res.arrayBuffer()
    const size = raw.byteLength
    const text = size > MAX_BODY
      ? `${new TextDecoder().decode(raw.slice(0, MAX_BODY))}\n\n… [response truncated at ${MAX_BODY} bytes of ${size}]`
      : new TextDecoder().decode(raw)

    const response: ApiResponse = {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: pretty(text, res.headers.get('content-type')),
      durationMs: Date.now() - started,
      size,
    }

    record({ method, url: url.toString(), status: res.status, durationMs: response.durationMs })
    return response
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('The request timed out.')
    // A DNS or connection failure should read as a connection problem, not a stack trace.
    const message = e instanceof Error ? e.message : 'Request failed'
    throw new Error(/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(message)
      ? `Could not reach ${url.host}. Check the address, and whether the server is running.`
      : message)
  } finally {
    clearTimeout(timer)
  }
}

/** Pretty-print JSON responses; leave everything else exactly as received. */
function pretty(text: string, contentType: string | null): string {
  if (!contentType?.includes('json')) return text
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

function record(entry: Omit<ApiHistoryEntry, 'id' | 'at'>) {
  const { items } = historyStore.read()
  historyStore.write({
    items: [{ ...entry, id: randomUUID(), at: Date.now() }, ...items].slice(0, 200),
  })
}

export function saveRequest(input: Partial<ApiRequest>): ApiRequest[] {
  const { items } = requestStore.read()
  const id = input.id && items.some((r) => r.id === input.id) ? input.id : randomUUID()
  const entry: ApiRequest = {
    id,
    name: (input.name ?? 'Untitled request').slice(0, 120),
    method: (METHODS.includes(input.method as HttpMethod) ? input.method : 'GET') as HttpMethod,
    url: (input.url ?? '').slice(0, 2000),
    headers: (input.headers ?? []).slice(0, 50),
    params: (input.params ?? []).slice(0, 50),
    body: (input.body ?? '').slice(0, 200_000),
    projectId: input.projectId ?? null,
    savedAt: Date.now(),
  }
  const next = items.some((r) => r.id === id)
    ? items.map((r) => (r.id === id ? entry : r))
    : [entry, ...items]
  return requestStore.write({ items: next.slice(0, 200) }).items
}

export const removeRequest = (id: string) =>
  requestStore.write({ items: requestStore.read().items.filter((r) => r.id !== id) }).items

export const clearHistory = () => historyStore.write({ items: [] }).items
