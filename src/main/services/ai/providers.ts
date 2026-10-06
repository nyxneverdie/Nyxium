import type { AIBackend, AIBackendId, AIConfig, AIModel, CustomProviderConfig } from '../../../shared/types.js'

/* All inference is local. No provider here ever reaches a hosted API, and none
   of them accepts an API key — that is the point of Nyxium's AI identity. */

export interface ChatMessage { role: string; content: string }

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature: number
  maxTokens: number
  contextSize: number
  tools?: Array<{ name: string; description: string; parameters: unknown }>
  signal: AbortSignal
  /** Set only for the custom provider: auth and routing headers, resolved in main. */
  headers?: Record<string, string>
  /** Models the user declared, when the endpoint has no /models route. */
  declaredModels?: string[]
}

export interface ChatChunk {
  text?: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
  done?: boolean
}

export interface LocalAIProvider {
  readonly id: AIBackendId
  readonly label: string
  /** `headers` is supplied only for the custom provider. */
  detect(endpoint: string, headers?: Record<string, string>): Promise<AIBackend>
  listModels(endpoint: string, headers?: Record<string, string>, declared?: string[]): Promise<AIModel[]>
  chat(endpoint: string, req: ChatRequest): AsyncGenerator<ChatChunk>
  /** Only Ollama exposes model management; others report unsupported. */
  pull?(endpoint: string, model: string, onProgress: (pct: number, status: string) => void): Promise<void>
  remove?(endpoint: string, model: string): Promise<void>
}

const TIMEOUT_MS = 2500

/** A short-timeout probe. A missing local server must never stall the UI. */
async function probe(url: string, init?: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** Read an SSE / NDJSON body line by line without buffering the whole response. */
async function* lines(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) yield line
      }
    }
    if (buf.trim()) yield buf.trim()
  } finally {
    void reader.cancel().catch(() => {})
  }
}

const base = (endpoint: string) => endpoint.replace(/\/+$/, '')

/* ── Ollama ──────────────────────────────────────────────────────────── */

export const ollama: LocalAIProvider = {
  id: 'ollama',
  label: 'Ollama',

  async detect(endpoint) {
    const res = await probe(`${base(endpoint)}/api/tags`)
    return {
      id: 'ollama',
      label: 'Ollama',
      endpoint,
      available: !!res?.ok,
      detail: res?.ok ? null : 'No Ollama server responded at this endpoint.',
    }
  },

  async listModels(endpoint) {
    const res = await probe(`${base(endpoint)}/api/tags`)
    if (!res?.ok) return []
    const json = (await res.json()) as {
      models?: Array<{ name: string; size?: number; details?: { family?: string; parameter_size?: string } }>
    }
    const running = await probe(`${base(endpoint)}/api/ps`)
    const loaded = new Set<string>()
    if (running?.ok) {
      const ps = (await running.json()) as { models?: Array<{ name: string }> }
      for (const m of ps.models ?? []) loaded.add(m.name)
    }
    return (json.models ?? []).map((m) => ({
      name: m.name,
      size: m.size ?? null,
      context: null, // Ollama reports it only via /api/show, fetched on demand.
      provider: 'ollama' as const,
      loaded: loaded.has(m.name),
      family: m.details?.family ?? null,
    }))
  },

  async *chat(endpoint, req) {
    const res = await fetch(`${base(endpoint)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        options: {
          temperature: req.temperature,
          num_ctx: req.contextSize,
          num_predict: req.maxTokens,
        },
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      }),
    })
    if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`)

    for await (const line of lines(res, req.signal)) {
      let json: {
        message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> }
        done?: boolean
        error?: string
      }
      try { json = JSON.parse(line) } catch { continue }
      if (json.error) throw new Error(json.error)
      const calls = json.message?.tool_calls
      if (calls?.length) {
        yield {
          toolCalls: calls
            .filter((c) => c.function?.name)
            .map((c) => ({
              name: c.function!.name!,
              args: typeof c.function!.arguments === 'string'
                ? safeJson(c.function!.arguments as string)
                : ((c.function!.arguments as Record<string, unknown>) ?? {}),
            })),
        }
      }
      if (json.message?.content) yield { text: json.message.content }
      if (json.done) { yield { done: true }; return }
    }
  },

  async pull(endpoint, model, onProgress) {
    const res = await fetch(`${base(endpoint)}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    })
    if (!res.ok) throw new Error(`Ollama refused the pull: ${res.status}`)
    const ctrl = new AbortController()
    for await (const line of lines(res, ctrl.signal)) {
      try {
        const j = JSON.parse(line) as { total?: number; completed?: number; status?: string; error?: string }
        if (j.error) throw new Error(j.error)
        const pct = j.total ? ((j.completed ?? 0) / j.total) * 100 : 0
        onProgress(pct, j.status ?? '')
      } catch (e) {
        if (e instanceof Error && e.message && !(e instanceof SyntaxError)) throw e
      }
    }
  },

  async remove(endpoint, model) {
    const res = await fetch(`${base(endpoint)}/api/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    if (!res.ok) throw new Error(`Ollama could not delete ${model}: ${res.status}`)
  },
}

/* ── OpenAI-compatible (llama.cpp server, vLLM, LM Studio, …) ─────────── */

/** llama.cpp's server and every other local OpenAI-compatible endpoint share
 *  one wire format; only detection and labelling differ. */
function openAICompatible(id: AIBackendId, label: string, healthPath: string): LocalAIProvider {
  return {
    id,
    label,

    async detect(endpoint, headers) {
      if (!endpoint) {
        return { id, label, endpoint: '', available: false, detail: 'No endpoint URL configured.' }
      }
      const root = base(endpoint)
      const init = headers ? { headers } : undefined
      const res = (await probe(`${root}${healthPath}`, init))
        ?? (await probe(`${root}/models`, init))
        ?? (await probe(`${root}/v1/models`, init))

      // No response at all means nothing is listening. Any HTTP status means a
      // server answered — including 404, which simply says this endpoint has no
      // /models route. Only an auth status is a real failure to report.
      if (!res) {
        return { id, label, endpoint, available: false, detail: `No ${label} server responded at this endpoint.` }
      }
      if (res.status === 401 || res.status === 403) {
        return {
          id, label, endpoint, available: false,
          detail: 'The endpoint rejected the credentials. Check the API key.',
        }
      }
      if (res.ok) return { id, label, endpoint, available: true, detail: null }
      return {
        id, label, endpoint, available: true,
        detail: `Reachable, but it has no model listing (HTTP ${res.status}). Declare the models you want to use.`,
      }
    },

    async listModels(endpoint, headers, declared) {
      if (!endpoint) return []
      const root = base(endpoint)
      const init = headers ? { headers } : undefined
      const res = (await probe(`${root}/models`, init)) ?? (await probe(`${root}/v1/models`, init))
      // Many self-hosted and gateway endpoints omit /models; the user's declared
      // list is the fallback so the feature still works there.
      if (!res?.ok) {
        return (declared ?? []).map((name) => ({
          name, size: null, context: null, provider: id, loaded: true, family: null,
        }))
      }
      const json = (await res.json()) as { data?: Array<{ id: string; meta?: { n_ctx?: number } }> }
      return (json.data ?? []).map((m) => ({
        name: m.id,
        size: null,
        context: m.meta?.n_ctx ?? null,
        provider: id,
        loaded: true, // These servers hold exactly the model they were started with.
        family: null,
      }))
    },

    async *chat(endpoint, req) {
      const root = base(endpoint)
      const url = root.endsWith('/v1') ? `${root}/chat/completions` : `${root}/v1/chat/completions`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(req.headers ?? {}) },
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          ...(req.tools?.length
            ? {
                tools: req.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
              }
            : {}),
        }),
      })
      if (!res.ok) throw new Error(`${label} returned ${res.status}: ${(await res.text()).slice(0, 200)}`)

      // Tool-call arguments arrive as fragments across chunks; assemble per index.
      const pending = new Map<number, { name: string; args: string }>()

      for await (const line of lines(res, req.signal)) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') break
        let json: {
          choices?: Array<{
            delta?: {
              content?: string
              tool_calls?: Array<{ index?: number; function?: { name?: string; arguments?: string } }>
            }
            finish_reason?: string | null
          }>
          error?: { message?: string }
        }
        try { json = JSON.parse(payload) } catch { continue }
        if (json.error) throw new Error(json.error.message ?? 'Inference error')

        const choice = json.choices?.[0]
        for (const call of choice?.delta?.tool_calls ?? []) {
          const i = call.index ?? 0
          const slot = pending.get(i) ?? { name: '', args: '' }
          if (call.function?.name) slot.name = call.function.name
          if (call.function?.arguments) slot.args += call.function.arguments
          pending.set(i, slot)
        }
        if (choice?.delta?.content) yield { text: choice.delta.content }
        if (choice?.finish_reason) {
          if (pending.size) {
            yield {
              toolCalls: [...pending.values()]
                .filter((p) => p.name)
                .map((p) => ({ name: p.name, args: safeJson(p.args) })),
            }
            pending.clear()
          }
          yield { done: true }
          return
        }
      }
      yield { done: true }
    },
  }
}

export const llamacpp = openAICompatible('llamacpp', 'llama.cpp', '/health')
export const openaiCompatible = openAICompatible('openai-compatible', 'OpenAI-compatible', '/models')

/** A user-supplied OpenAI-compatible URL: self-hosted box, LAN server or gateway. */
export const custom = openAICompatible('custom', 'Custom endpoint', '/models')

export const PROVIDERS: Record<AIBackendId, LocalAIProvider> = {
  ollama,
  llamacpp,
  'openai-compatible': openaiCompatible,
  custom,
}

/**
 * Request headers for the custom provider. The key is read from the OS keyring
 * at call time and never stored in the config or sent to the renderer.
 */
export function customHeaders(cfg: CustomProviderConfig, apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...cfg.headers }
  if (apiKey) {
    const scheme = cfg.authScheme.trim()
    headers[cfg.authHeader || 'Authorization'] = scheme ? `${scheme} ${apiKey}` : apiKey
  }
  return headers
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Probe every configured backend in parallel. Absent servers report cleanly. */
export function detectAll(cfg: AIConfig, customKey: string | null): Promise<AIBackend[]> {
  return Promise.all(
    (Object.keys(PROVIDERS) as AIBackendId[]).map((id) => {
      if (id === 'custom') {
        return custom.detect(cfg.custom.url, customHeaders(cfg.custom, customKey))
          .then((b) => ({ ...b, label: cfg.custom.label || 'Custom endpoint' }))
      }
      return PROVIDERS[id].detect(cfg.endpoints[id])
    }),
  )
}

/** Resource mode caps what a request may ask of the machine. Nyxium targets 8 GB. */
export function applyResourceMode(cfg: AIConfig): { contextSize: number; maxTokens: number; concurrency: number } {
  switch (cfg.resourceMode) {
    case 'low-ram':
      return { contextSize: Math.min(cfg.contextSize, 4096), maxTokens: Math.min(cfg.maxTokens, 1024), concurrency: 1 }
    case 'performance':
      return { contextSize: cfg.contextSize, maxTokens: cfg.maxTokens, concurrency: 3 }
    default:
      return { contextSize: Math.min(cfg.contextSize, 8192), maxTokens: Math.min(cfg.maxTokens, 2048), concurrency: 1 }
  }
}
