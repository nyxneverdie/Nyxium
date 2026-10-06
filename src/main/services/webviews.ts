import { BrowserWindow, WebContentsView, session, shell } from 'electron'
import { join } from 'node:path'
import { paths } from './store.js'

/**
 * Embedded developer services, each in its own WebContentsView.
 *
 * Three rules hold for every embedded site:
 *   - it gets a persistent partition, so logins and OAuth survive restarts;
 *   - it gets NO preload and no node integration, so it can never see Nyxium's
 *     IPC bridge or the local filesystem;
 *   - it is suspended when hidden, so a dozen services do not cost a dozen
 *     live renderers on an 8 GB machine.
 */

interface View {
  view: WebContentsView
  serviceId: string
  windowId: number
  visible: boolean
}

const views = new Map<string, View>()

export interface Bounds { x: number; y: number; width: number; height: number }

/** A stable per-service partition: cookies and storage persist across runs. */
const partitionFor = (serviceId: string) => `persist:service-${serviceId}`

function emit(win: BrowserWindow, serviceId: string, payload: Record<string, unknown>) {
  if (!win.isDestroyed()) win.webContents.send('webview:state', { serviceId, ...payload })
}

/**
 * Hosts and paths that mean "this is a sign-in page", as they appear across
 * providers: accounts.google.com, login.microsoftonline.com, auth0, Okta,
 * /oauth2/authorize, /saml/sso, and so on.
 */
const AUTH_URL = /(^|[.\/])(accounts|auth|login|signin|sso|oauth|idp|okta)[.\/]|\/(oauth2?|openid|saml2?|sso|signin|login|authorize|authenticate)(\/|\?|$)/i

export type PopupAction = 'popup' | 'external' | 'deny'

/**
 * Where a window an embedded service tried to open should go.
 *
 * A real `window.open` is how nearly every provider does interactive login, so
 * it must stay in Nyxium on the service's own partition — sent to the system
 * browser, the callback lands in a session the service cannot read and the
 * login silently never completes. A plain target=_blank link is an ordinary
 * outbound link and goes to the real browser, unless it points at a sign-in
 * endpoint, which some services use in place of window.open.
 *
 * `window.open('', 'name')` followed by a scripted navigation is also common,
 * so a blank URL from a scripted open is a popup, not a denial.
 */
export function popupDecision(url: string, disposition: string): PopupAction {
  const scripted = disposition === 'new-window'
  if (!url || url === 'about:blank') return scripted ? 'popup' : 'deny'
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'deny'
  }
  if (!['http:', 'https:'].includes(u.protocol)) return 'deny'
  if (scripted || AUTH_URL.test(u.host + u.pathname)) return 'popup'
  return 'external'
}

/** Popup window options: the size the page asked for, the service's session. */
function popupOptions(serviceId: string, features: string, parent: BrowserWindow) {
  const asked = new URLSearchParams((features || '').replace(/,/g, '&'))
  const dim = (key: string, fallback: number) => {
    const n = Number(asked.get(key))
    return Number.isFinite(n) && n >= 320 ? Math.min(Math.floor(n), 1600) : fallback
  }
  return {
    parent,
    width: dim('width', 520),
    height: dim('height', 700),
    autoHideMenuBar: true,
    backgroundColor: '#0d0f14',
    webPreferences: {
      partition: partitionFor(serviceId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

/** Apply the same routing rule inside a popup, for nested consent screens. */
function wirePopup(child: BrowserWindow, serviceId: string) {
  const cwc = child.webContents
  cwc.setWindowOpenHandler(({ url: target, disposition, features }) => {
    const action = popupDecision(target, disposition)
    if (action === 'popup') {
      return { action: 'allow', overrideBrowserWindowOptions: popupOptions(serviceId, features, child) }
    }
    if (action === 'external') void shell.openExternal(target)
    return { action: 'deny' }
  })
  cwc.on('did-create-window', (grandchild) => wirePopup(grandchild, serviceId))
}

export function createView(
  win: BrowserWindow, serviceId: string, url: string, bounds: Bounds,
): { serviceId: string } {
  const existing = views.get(serviceId)
  if (existing) {
    show(serviceId, bounds)
    return { serviceId }
  }

  const ses = session.fromPartition(partitionFor(serviceId))

  // Embedded sites must never be granted a capability by default. The user is
  // not prompted either: a site that wants the camera simply does not get it.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(serviceId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // No preload: the service has no path to Nyxium's bridge.
      webSecurity: true,
      spellcheck: false,
    },
  })

  const wc = view.webContents

  // Login windows stay inside Nyxium, in the service's own partition; ordinary
  // outbound links go to the real browser. See popupDecision below.
  wc.setWindowOpenHandler(({ url: target, disposition, features }) => {
    const action = popupDecision(target, disposition)
    if (action === 'popup') {
      return { action: 'allow', overrideBrowserWindowOptions: popupOptions(serviceId, features, win) }
    }
    if (action === 'external') void shell.openExternal(target)
    return { action: 'deny' }
  })

  // A provider may open a second popup from the first (consent after login).
  wc.on('did-create-window', (child) => wirePopup(child, serviceId))

  const report = () => emit(win, serviceId, {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
  })

  wc.on('did-start-loading', report)
  wc.on('did-stop-loading', report)
  wc.on('did-navigate', report)
  wc.on('did-navigate-in-page', report)
  wc.on('page-title-updated', report)
  wc.on('did-fail-load', (_e, code, description, failedUrl) => {
    // -3 is an aborted load, which happens on every ordinary redirect.
    if (code === -3) return
    emit(win, serviceId, { error: `${description} (${failedUrl})`, loading: false })
  })

  win.contentView.addChildView(view)
  view.setBounds(bounds)
  void wc.loadURL(url)

  views.set(serviceId, { view, serviceId, windowId: win.id, visible: true })
  return { serviceId }
}

export function setBounds(serviceId: string, bounds: Bounds) {
  views.get(serviceId)?.view.setBounds(bounds)
}

/**
 * Hiding moves the view off-screen rather than destroying it, so a tab switch
 * keeps the session and scroll position. The renderer is told to stop painting.
 */
export function hide(serviceId: string) {
  const entry = views.get(serviceId)
  if (!entry || !entry.visible) return
  entry.visible = false
  entry.view.setVisible(false)
}

export function show(serviceId: string, bounds: Bounds) {
  const entry = views.get(serviceId)
  if (!entry) return
  entry.visible = true
  entry.view.setVisible(true)
  entry.view.setBounds(bounds)
}

/** Hide every view except one — called whenever the active tab changes. */
export function showOnly(serviceId: string | null, bounds?: Bounds) {
  for (const [id] of views) {
    if (id === serviceId) continue
    hide(id)
  }
  if (serviceId && bounds) show(serviceId, bounds)
}

export function destroy(serviceId: string) {
  const entry = views.get(serviceId)
  if (!entry) return
  const win = BrowserWindow.fromId(entry.windowId)
  if (win && !win.isDestroyed()) win.contentView.removeChildView(entry.view)
  entry.view.webContents.close()
  views.delete(serviceId)
}

export function destroyForWindow(windowId: number) {
  for (const [id, v] of views) if (v.windowId === windowId) destroy(id)
}

const wcOf = (serviceId: string) => views.get(serviceId)?.view.webContents ?? null

export function goBack(serviceId: string) {
  const wc = wcOf(serviceId)
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
}

export function goForward(serviceId: string) {
  const wc = wcOf(serviceId)
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
}

export const reload = (serviceId: string) => wcOf(serviceId)?.reload()
export const currentUrl = (serviceId: string) => wcOf(serviceId)?.getURL() ?? null

/** Sign out of one service by clearing only that service's partition. */
export async function clearSession(serviceId: string) {
  destroy(serviceId)
  await session.fromPartition(partitionFor(serviceId)).clearStorageData()
}

export const downloadsDir = () => join(paths.dataDir, 'downloads')

/** Evaluate an expression inside an embedded page. Verification only. */
export async function probeView(serviceId: string, expression: string): Promise<string> {
  const wc = wcOf(serviceId)
  if (!wc) return 'no such view'
  try {
    return String(await wc.executeJavaScript(expression))
  } catch (e) {
    return `probe failed: ${e instanceof Error ? e.message : e}`
  }
}
