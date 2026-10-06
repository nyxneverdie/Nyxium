/**
 * Self-check for the custom provider: header construction and the rule that
 * decides reachable-vs-unauthorised-vs-offline. Run via `npm run check`.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { custom, customHeaders } from './providers.ts'
import type { CustomProviderConfig } from '../../../shared/types.ts'

const cfg: CustomProviderConfig = {
  label: 'Lab', url: '', models: ['declared-a', 'declared-b'],
  authHeader: 'Authorization', authScheme: 'Bearer', headers: { 'x-route': 'fast' }, hasKey: true,
}

/* ── Header construction ─────────────────────────────────────────────── */

const withKey = customHeaders(cfg, 'k123')
assert.equal(withKey.Authorization, 'Bearer k123', 'scheme and key are joined')
assert.equal(withKey['x-route'], 'fast', 'extra headers are preserved')

const noKey = customHeaders(cfg, null)
assert.equal('Authorization' in noKey, false, 'no auth header when there is no key')
assert.equal(noKey['x-route'], 'fast', 'extra headers still sent without a key')

const raw = customHeaders({ ...cfg, authScheme: '' }, 'k123')
assert.equal(raw.Authorization, 'k123', 'an empty scheme sends the bare key')

const customHeader = customHeaders({ ...cfg, authHeader: 'x-api-key', authScheme: '' }, 'k123')
assert.equal(customHeader['x-api-key'], 'k123', 'a non-standard auth header is honoured')

/* ── Detection semantics ─────────────────────────────────────────────── */

const server = createServer((req, res) => {
  const url = req.url ?? ''
  if (url.startsWith('/unauth')) { res.writeHead(401).end(); return }
  if (url.startsWith('/nomodels')) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ data: [{ id: 'served-model' }] }))
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as AddressInfo).port

try {
  const ok = await custom.detect(`http://127.0.0.1:${port}`)
  assert.equal(ok.available, true, 'a serving endpoint is available')
  assert.equal(ok.detail, null, 'no caveat when /models works')

  const unauth = await custom.detect(`http://127.0.0.1:${port}/unauth`)
  assert.equal(unauth.available, false, '401 is not usable')
  assert.match(unauth.detail!, /API key/, 'the message points at the credential')

  // A server that answers 404 is running — it just has no model listing. It
  // must stay usable, because declared models cover exactly this case.
  const nomodels = await custom.detect(`http://127.0.0.1:${port}/nomodels`)
  assert.equal(nomodels.available, true, '404 means reachable without a model route')
  assert.match(nomodels.detail!, /no model listing/, 'the caveat explains why models are empty')

  const dead = await custom.detect('http://127.0.0.1:1')
  assert.equal(dead.available, false, 'nothing listening is offline')
  assert.match(dead.detail!, /responded/, 'offline says nothing answered')

  const blank = await custom.detect('')
  assert.equal(blank.available, false, 'an unconfigured endpoint is not an error')
  assert.match(blank.detail!, /No endpoint URL/, 'blank URL is reported as unconfigured')

  /* ── Model listing ─────────────────────────────────────────────────── */

  const served = await custom.listModels(`http://127.0.0.1:${port}`, undefined, cfg.models)
  assert.deepEqual(served.map((m) => m.name), ['served-model'], 'the endpoint wins when it lists models')

  const declared = await custom.listModels(`http://127.0.0.1:${port}/nomodels`, undefined, cfg.models)
  assert.deepEqual(
    declared.map((m) => m.name), ['declared-a', 'declared-b'],
    'declared models are the fallback when /models is absent',
  )
  assert.equal(declared[0].provider, 'custom', 'fallback models carry the right provider')

  const none = await custom.listModels('', undefined, cfg.models)
  assert.deepEqual(none, [], 'no URL means no models')

  console.log('custom.check: all assertions passed')
} finally {
  server.close()
}
