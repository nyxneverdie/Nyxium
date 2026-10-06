/**
 * Self-check for the local AI providers, run against a stub server that speaks
 * the real Ollama and OpenAI wire formats. This verifies the streaming parsers
 * and tool-call assembly without needing a model on the machine.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { llamacpp, ollama } from './providers.ts'

/* ── Stub server ───────────────────────────────────────────────────────── */

const server = createServer((req, res) => {
  const url = req.url ?? ''

  if (url === '/api/tags') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      models: [
        { name: 'qwen2.5-coder:7b', size: 4_700_000_000, details: { family: 'qwen2' } },
        { name: 'deepseek-coder:33b', size: 19_000_000_000, details: { family: 'llama' } },
      ],
    }))
    return
  }

  if (url === '/api/ps') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }))
    return
  }

  // Ollama chat: newline-delimited JSON, content split across chunks.
  if (url === '/api/chat') {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(JSON.stringify({ message: { content: 'Looking at ' } }) + '\n')
    res.write(JSON.stringify({ message: { content: 'the auth code.' } }) + '\n')
    res.write(JSON.stringify({
      message: { tool_calls: [{ function: { name: 'read_file', arguments: { path: 'src/auth.ts' } } }] },
    }) + '\n')
    res.write(JSON.stringify({ done: true }) + '\n')
    res.end()
    return
  }

  if (url === '/health' || url === '/models' || url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'local-model', meta: { n_ctx: 8192 } }] }))
    return
  }

  // OpenAI-compatible chat: SSE, with tool-call arguments split mid-JSON.
  if (url.endsWith('/chat/completions')) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const frame = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`)
    frame({ choices: [{ delta: { content: 'Checking' } }] })
    frame({ choices: [{ delta: { content: ' the repo.' } }] })
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'search_code' } }] } }] })
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"que' } }] } }] })
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"auth"}' } }] } }] })
    frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  res.writeHead(404).end()
})

await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as AddressInfo).port
const endpoint = `http://127.0.0.1:${port}`

try {
  /* ── Detection ───────────────────────────────────────────────────────── */

  const up = await ollama.detect(endpoint)
  assert.equal(up.available, true, 'a responding server is detected')
  assert.equal(up.detail, null, 'no error detail when available')

  const down = await ollama.detect('http://127.0.0.1:1')
  assert.equal(down.available, false, 'a dead endpoint is reported unavailable')
  assert.ok(down.detail, 'unavailability comes with a human explanation')
  assert.ok(!/ECONNREFUSED|stack/i.test(down.detail!), 'no raw error text leaks into the UI string')

  /* ── Model listing ───────────────────────────────────────────────────── */

  const models = await ollama.listModels(endpoint)
  assert.equal(models.length, 2, 'both models listed')
  assert.equal(models[0].name, 'qwen2.5-coder:7b')
  assert.equal(models[0].loaded, true, 'a model reported by /api/ps is marked loaded')
  assert.equal(models[1].loaded, false, 'a model not in /api/ps is not marked loaded')
  assert.equal(models[0].family, 'qwen2', 'family carried through')

  /* ── Ollama streaming ────────────────────────────────────────────────── */

  const ctrl = new AbortController()
  let text = ''
  let calls: Array<{ name: string; args: Record<string, unknown> }> = []
  let sawDone = false
  for await (const chunk of ollama.chat(endpoint, {
    model: 'qwen2.5-coder:7b', messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2, maxTokens: 256, contextSize: 4096, signal: ctrl.signal,
  })) {
    if (chunk.text) text += chunk.text
    if (chunk.toolCalls) calls = chunk.toolCalls
    if (chunk.done) sawDone = true
  }
  assert.equal(text, 'Looking at the auth code.', 'NDJSON content chunks reassemble in order')
  assert.equal(sawDone, true, 'the stream terminates with done')
  assert.equal(calls.length, 1, 'one tool call parsed')
  assert.equal(calls[0].name, 'read_file')
  assert.deepEqual(calls[0].args, { path: 'src/auth.ts' }, 'object-form arguments parsed')

  /* ── OpenAI-compatible streaming ─────────────────────────────────────── */

  const ctrl2 = new AbortController()
  let text2 = ''
  let calls2: Array<{ name: string; args: Record<string, unknown> }> = []
  for await (const chunk of llamacpp.chat(endpoint, {
    model: 'local-model', messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2, maxTokens: 256, contextSize: 4096, signal: ctrl2.signal,
  })) {
    if (chunk.text) text2 += chunk.text
    if (chunk.toolCalls) calls2 = chunk.toolCalls
  }
  assert.equal(text2, 'Checking the repo.', 'SSE content chunks reassemble in order')
  assert.equal(calls2.length, 1, 'one tool call assembled from fragments')
  assert.equal(calls2[0].name, 'search_code')
  assert.deepEqual(
    calls2[0].args, { query: 'auth' },
    'arguments split across SSE frames are concatenated before parsing',
  )

  const ctxModels = await llamacpp.listModels(endpoint)
  assert.equal(ctxModels[0].context, 8192, 'context length read from the model metadata')

  console.log('providers.check: all assertions passed')
} finally {
  server.close()
}
