/**
 * Self-check for embedded-service popup routing: an interactive login must stay
 * inside Nyxium (so the callback lands in the service's own session), while an
 * ordinary outbound link must leave for the real browser. Run via `npm run check`.
 */
import assert from 'node:assert/strict'
import { popupDecision } from './webviews.ts'

/* ── Scripted window.open is always a login popup ─────────────────────── */

for (const url of [
  'https://some-internal-tool.example.com/connect/start',
  'https://id.example.co.jp/begin',
  'about:blank',
  '',
]) {
  assert.equal(popupDecision(url, 'new-window'), 'popup', `scripted open must stay inside: ${url}`)
}

/* ── Known auth endpoints stay inside even from a plain target=_blank ── */

for (const url of [
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
  'https://github.com/login/oauth/authorize',
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  'https://example.auth0.com/authorize',
  'https://example.okta.com/app/x/sso/saml',
  'https://app.example.com/saml/sso',
  'https://app.example.com/signin',
  'https://auth.example.com/',
  'https://sso.example.org/authenticate',
]) {
  assert.equal(popupDecision(url, 'foreground-tab'), 'popup', `auth URL must stay inside: ${url}`)
}

/* ── Ordinary links go out to the real browser ────────────────────────── */

for (const url of [
  'https://example.com/docs/getting-started',
  'https://news.example.com/article/42',
  'http://example.com/',
]) {
  assert.equal(popupDecision(url, 'foreground-tab'), 'external', `ordinary link must open externally: ${url}`)
}

/* ── Anything that is not http(s) is refused outright ─────────────────── */

for (const url of [
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,<script>1</script>',
  'not a url',
]) {
  assert.equal(popupDecision(url, 'new-window'), 'deny', `must be denied: ${url}`)
  assert.equal(popupDecision(url, 'foreground-tab'), 'deny', `must be denied: ${url}`)
}

// A blank URL from a non-scripted disposition has nothing to show.
assert.equal(popupDecision('about:blank', 'foreground-tab'), 'deny')

console.log('webviews popup routing: ok')
