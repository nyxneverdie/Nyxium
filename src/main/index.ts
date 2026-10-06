import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { registerIpc, startPaletteWatcher, configStore } from './ipc.js'
import { killForWindow } from './services/terminal.js'
import { destroyForWindow, probeView } from './services/webviews.js'
import { pushNotification } from './services/projects.js'

const isDev = !app.isPackaged

/** Nyxium mark: a rotated square with a hollow centre, rendered once at startup. */
function brandIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" rx="112" fill="#0d0f14"/>
    <path d="M256 96 416 256 256 416 96 256Z" fill="none" stroke="#7aa2f7" stroke-width="34"/>
    <path d="M256 186 326 256 256 326 186 256Z" fill="#7aa2f7"/>
  </svg>`
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function createWindow() {
  const size = process.env.NYX_WINDOW_SIZE?.split('x').map(Number)
  const win = new BrowserWindow({
    width: size?.[0] || 1440,
    height: size?.[1] || 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0d0f14',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    icon: brandIcon(),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // A closing window must take its PTYs with it; orphaned shells leak memory.
  win.on('closed', () => {
    killForWindow(win.id)
    destroyForWindow(win.id)
  })

  // NYX_SMOKE=<png path>: paint once, capture, exit. Used to verify each phase renders.
  // NYX_DRIVE=<js>: run a snippet in the page first; NYX_SMOKE_DELAY tunes the wait.
  if (process.env.NYX_SMOKE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.NYX_DRIVE) {
          try {
            console.log('[nyx-drive]', await win.webContents.executeJavaScript(process.env.NYX_DRIVE))
          } catch (e) {
            console.log('[nyx-drive] failed:', e instanceof Error ? e.message : e)
          }
          await new Promise((r) => setTimeout(r, Number(process.env.NYX_DRIVE_WAIT ?? 2000)))
        }
        // NYX_PROBE_WEBVIEW: run a snippet INSIDE an embedded service's page,
        // to verify what that page can and cannot see.
        if (process.env.NYX_PROBE_WEBVIEW) {
          console.log('[nyx-probe]', await probeView(process.env.NYX_PROBE_SERVICE ?? '', process.env.NYX_PROBE_WEBVIEW))
        }
        // Wait for the compositor to paint, so the capture is not a stale or
        // mid-animation frame. requestAnimationFrame never fires in a window the
        // compositor has parked, so the wait is bounded by a timeout.
        await win.webContents.executeJavaScript(`new Promise(r => {
          const done = () => r(0)
          setTimeout(done, 800)
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 100)))
        })`)
        const img = await win.webContents.capturePage()
        writeFileSync(process.env.NYX_SMOKE!, img.toPNG())
        app.exit(0)
      }, Number(process.env.NYX_SMOKE_DELAY ?? 2500))
    })
  }

  // Renderer must never navigate itself or spawn windows; links go to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // NYX_VIEW opens straight into one view — used by the smoke capture above.
  const hash = process.env.NYX_VIEW ? { hash: process.env.NYX_VIEW } : undefined
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash.hash}` : ''))
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), hash)
  }
  return win
}

app.whenReady().then(() => {
  app.setName('Nyxium')
  registerIpc()
  startPaletteWatcher()
  createWindow()

  const p = configStore.read().palette
  pushNotification({
    source: 'system',
    title: 'Nyxium ready',
    body: p.enabled ? `Dynamic colors: ${p.source}` : 'Dynamic colors disabled',
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
