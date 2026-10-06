/**
 * Self-check for the Phase 5 guards: the destructive-SQL classifier and the
 * API playground's request validation. Run via `npm run check`.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { isDestructive } from './database.ts'
import { send } from './api.ts'

/* ── Destructive statement detection ─────────────────────────────────── */

for (const sql of [
  'DROP TABLE users',
  'delete from users where id = 1',
  'TRUNCATE users',
  'ALTER TABLE users ADD COLUMN x INT',
  'UPDATE users SET active = 0',
  'INSERT INTO users VALUES (1)',
  'CREATE TABLE t (id INT)',
  'GRANT ALL ON db TO bob',
  'FLUSHALL',
  '  \n  DROP TABLE users',                    // leading whitespace
  '-- just a comment\nDROP TABLE users',       // comment-prefixed
  '/* block */ DELETE FROM users',             // block-comment-prefixed
  '--x\n/*y*/\n  truncate users',              // both, mixed
]) {
  assert.ok(isDestructive(sql), `must be flagged destructive: ${JSON.stringify(sql)}`)
}

for (const sql of [
  'SELECT * FROM users',
  'select id from users where name = \'drop table\'',  // the word only in a literal
  'EXPLAIN SELECT * FROM users',
  'SHOW TABLES',
  'PRAGMA table_info(users)',
  'WITH x AS (SELECT 1) SELECT * FROM x',
  'GET mykey',
  'KEYS *',
]) {
  assert.ok(!isDestructive(sql), `must NOT be flagged destructive: ${JSON.stringify(sql)}`)
}

/* ── API playground validation ───────────────────────────────────────── */

await assert.rejects(
  () => send({ method: 'GET', url: 'not a url', headers: [], params: [], body: '' }),
  /not a valid URL/,
  'a malformed URL is rejected',
)

await assert.rejects(
  () => send({ method: 'GET', url: 'file:///etc/passwd', headers: [], params: [], body: '' }),
  /http and https/,
  'file:// is refused — the playground is not a file reader',
)

await assert.rejects(
  () => send({ method: 'TRACE', url: 'http://127.0.0.1/', headers: [], params: [], body: '' }),
  /Unsupported method/,
  'an unsupported method is rejected',
)

/* ── A real round trip ───────────────────────────────────────────────── */

const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    seen.push({
      url: req.url ?? '',
      method: req.method ?? '',
      headers: req.headers as Record<string, string>,
      body,
    })
    if ((req.url ?? '').startsWith('/json')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"a":1,"b":[2,3]}')
      return
    }
    res.writeHead(201, { 'content-type': 'text/plain' })
    res.end('created')
  })
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as AddressInfo).port

try {
  const json = await send({
    method: 'GET',
    url: `http://127.0.0.1:${port}/json`,
    headers: [{ key: 'x-test', value: 'yes' }, { key: '', value: 'ignored' }],
    params: [{ key: 'q', value: 'hello world' }],
    body: '',
  })
  assert.equal(json.status, 200)
  assert.ok(json.body.includes('\n  "a": 1'), 'JSON responses are pretty-printed')
  assert.equal(json.headers['content-type'], 'application/json', 'response headers are returned')
  assert.ok(json.durationMs >= 0, 'a duration is measured')

  const req = seen.at(-1)!
  assert.ok(req.url.includes('q=hello+world') || req.url.includes('q=hello%20world'), 'params are URL-encoded')
  assert.equal(req.headers['x-test'], 'yes', 'custom headers are sent')

  const posted = await send({
    method: 'POST',
    url: `http://127.0.0.1:${port}/thing`,
    headers: [],
    params: [],
    body: '{"name":"nyx"}',
  })
  assert.equal(posted.status, 201)
  const postReq = seen.at(-1)!
  assert.equal(postReq.method, 'POST')
  assert.equal(postReq.body, '{"name":"nyx"}', 'the body is sent verbatim')
  assert.match(
    postReq.headers['content-type'], /application\/json/,
    'a JSON-looking body gets a JSON content-type when none was given',
  )

  // GET must never carry a body, even when the editor holds leftover text.
  await send({
    method: 'GET', url: `http://127.0.0.1:${port}/nobody`,
    headers: [], params: [], body: '{"ignored":true}',
  })
  assert.equal(seen.at(-1)!.body, '', 'a GET is sent without a body')

  await assert.rejects(
    () => send({ method: 'GET', url: 'http://127.0.0.1:1/', headers: [], params: [], body: '' }),
    /Could not reach/,
    'a connection failure reads as a connection problem, not a stack trace',
  )

  console.log('infra.check: all assertions passed')
} finally {
  server.close()
}
