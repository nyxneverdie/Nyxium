// Stand-in for Electron when a self-check imports a service that pulls in
// electron transitively. The checks exercise logic, not the desktop runtime.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'nyxium-check-'))

export const app = { getPath: () => scratch, isPackaged: false, getName: () => 'Nyxium' }
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(s, 'utf8'),
  decryptString: (b) => Buffer.from(b).toString('utf8'),
}
export const clipboard = { writeText() {} }
export const shell = { openPath: async () => '', openExternal: async () => {} }
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
export const ipcMain = { handle() {}, on() {} }
export const BrowserWindow = class { static getAllWindows() { return [] } }
export const nativeImage = { createFromDataURL: () => ({}) }
export const WebContentsView = class {}
export const session = { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, clearStorageData: async () => {} }) }
export default { app, safeStorage, clipboard, shell, dialog, ipcMain, BrowserWindow, nativeImage, WebContentsView, session }
