import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { BrowserWindow } from 'electron'
import { JsonStore } from '../store.js'
import { pushNotification } from '../projects.js'
import type {
  BackupPreview, CloudConfig, CloudStatus, Project, TransferProgress,
} from '../../../shared/types.js'
import { DEFAULT_CLOUD_CONFIG } from '../../../shared/types.js'
import * as gcs from './gcs.js'
import * as backup from './backup.js'

export const cloudStore = new JsonStore<CloudConfig>('cloud.json', DEFAULT_CLOUD_CONFIG)

/** Live transfers, so the UI can show progress and the user can cancel. */
const transfers = new Map<string, { ctrl: AbortController; progress: TransferProgress }>()

function emit(win: BrowserWindow, progress: TransferProgress) {
  if (!win.isDestroyed()) win.webContents.send('cloud:progress', progress)
}

function track(win: BrowserWindow, kind: TransferProgress['kind'], label: string) {
  const id = randomUUID()
  const ctrl = new AbortController()
  const progress: TransferProgress = { id, kind, label, sent: 0, total: 0, status: 'running' }
  transfers.set(id, { ctrl, progress })
  emit(win, progress)

  let lastEmit = 0
  return {
    id,
    ctrl,
    /** Throttled: a fast local upload would otherwise flood the IPC channel. */
    report(sent: number, total: number) {
      progress.sent = sent
      progress.total = total
      const now = Date.now()
      if (now - lastEmit > 120) { lastEmit = now; emit(win, { ...progress }) }
    },
    finish(status: TransferProgress['status'], error?: string) {
      progress.status = status
      progress.error = error
      transfers.delete(id)
      emit(win, { ...progress })
    },
  }
}

export function cancelTransfer(id: string) {
  transfers.get(id)?.ctrl.abort()
}

export const listTransfers = () => [...transfers.values()].map((t) => t.progress)

export async function status(): Promise<CloudStatus> {
  const cfg = cloudStore.read()
  const credential = await gcs.credentialKind()
  if (credential === 'none') {
    return {
      connected: false, credential, project: cfg.project, bucket: cfg.bucket,
      detail: 'No Google Cloud credentials found. Run `gcloud auth application-default login`, or add a service-account key.',
    }
  }
  if (!cfg.project) {
    return { connected: false, credential, project: '', bucket: cfg.bucket, detail: 'Set a Google Cloud project ID.' }
  }
  // A credential that cannot list buckets is not a working connection.
  try {
    await gcs.listBuckets(cfg.project)
    return { connected: true, credential, project: cfg.project, bucket: cfg.bucket, detail: null }
  } catch (e) {
    return {
      connected: false, credential, project: cfg.project, bucket: cfg.bucket,
      detail: e instanceof Error ? e.message : 'Could not reach Google Cloud Storage.',
    }
  }
}

/** The bucket prefix a project maps to, e.g. projects/nyxium/. */
export function prefixFor(project: Project): string {
  const cfg = cloudStore.read()
  const custom = cfg.prefixes[project.id]
  const raw = custom || `projects/${project.name}/`
  return raw.endsWith('/') ? raw : `${raw}/`
}

export async function previewBackup(project: Project): Promise<BackupPreview> {
  const r = await backup.scan(project.path)
  return {
    fileCount: r.files.length,
    totalBytes: r.totalBytes,
    excludedSecrets: r.excludedSecrets,
    truncated: r.truncated,
  }
}

/**
 * Backup pipeline: scan → exclusions → archive → upload → verify → notify.
 * The archive is built once and uploaded as a single object, never file by file.
 */
export async function backupProject(win: BrowserWindow, project: Project): Promise<string> {
  const cfg = cloudStore.read()
  if (!cfg.bucket) throw new Error('No bucket is configured for cloud backups.')

  const t = track(win, 'backup', `Backing up ${project.name}`)
  let archive: backup.Archive | null = null
  try {
    const scanned = await backup.scan(project.path)
    if (!scanned.files.length) throw new Error('Every file was excluded — nothing to back up.')

    archive = await backup.buildArchive(project.path, project.name, scanned.files)
    const objectName = `${prefixFor(project)}backups/${basename(archive.path)}`

    const uploaded = await gcs.upload(cfg.bucket, objectName, archive.path, {
      onProgress: t.report,
      signal: t.ctrl.signal,
    })

    // Verify: the object the bucket reports must match what we sent.
    if (uploaded.size !== archive.bytes) {
      throw new Error(`Upload verification failed: sent ${archive.bytes} bytes, bucket reports ${uploaded.size}.`)
    }

    cloudStore.patch({ lastBackupAt: { ...cfg.lastBackupAt, [project.id]: Date.now() } })
    t.finish('done')
    pushNotification({
      source: 'cloud',
      title: 'Backup completed',
      body: `${project.name} → gs://${cfg.bucket}/${objectName}`
        + (scanned.excludedSecrets.length ? ` (${scanned.excludedSecrets.length} credential file(s) excluded)` : ''),
    })
    return objectName
  } catch (e) {
    const message = t.ctrl.signal.aborted
      ? 'Backup cancelled.'
      : e instanceof Error ? e.message : 'Backup failed'
    t.finish(t.ctrl.signal.aborted ? 'cancelled' : 'error', message)
    throw new Error(message)
  } finally {
    if (archive) await backup.cleanupArchive(archive).catch(() => {})
  }
}

export async function restoreProject(
  win: BrowserWindow, objectName: string, destination: string,
): Promise<void> {
  const cfg = cloudStore.read()
  if (!cfg.bucket) throw new Error('No bucket is configured.')

  const t = track(win, 'restore', `Restoring ${basename(objectName)}`)
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const tmp = await mkdtemp(join(tmpdir(), 'nyxium-restore-'))
  const local = join(tmp, basename(objectName))
  try {
    await gcs.download(cfg.bucket, objectName, local, { onProgress: t.report, signal: t.ctrl.signal })
    await backup.extractArchive(local, destination)
    t.finish('done')
    pushNotification({ source: 'cloud', title: 'Restore completed', body: `${basename(objectName)} → ${destination}` })
  } catch (e) {
    const message = t.ctrl.signal.aborted ? 'Restore cancelled' : e instanceof Error ? e.message : 'Restore failed'
    t.finish(t.ctrl.signal.aborted ? 'cancelled' : 'error', message)
    throw new Error(message)
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

export async function uploadFile(win: BrowserWindow, localPath: string, objectName: string) {
  const cfg = cloudStore.read()
  if (!cfg.bucket) throw new Error('No bucket is configured.')
  const t = track(win, 'upload', basename(localPath))
  try {
    const o = await gcs.upload(cfg.bucket, objectName, localPath, {
      onProgress: t.report, signal: t.ctrl.signal,
    })
    t.finish('done')
    return o
  } catch (e) {
    const message = t.ctrl.signal.aborted ? 'Upload cancelled' : e instanceof Error ? e.message : 'Upload failed'
    t.finish(t.ctrl.signal.aborted ? 'cancelled' : 'error', message)
    throw new Error(message)
  }
}

export async function downloadFile(win: BrowserWindow, objectName: string, localPath: string) {
  const cfg = cloudStore.read()
  if (!cfg.bucket) throw new Error('No bucket is configured.')
  const t = track(win, 'download', basename(objectName))
  try {
    await gcs.download(cfg.bucket, objectName, localPath, { onProgress: t.report, signal: t.ctrl.signal })
    t.finish('done')
  } catch (e) {
    const message = t.ctrl.signal.aborted ? 'Download cancelled' : e instanceof Error ? e.message : 'Download failed'
    t.finish(t.ctrl.signal.aborted ? 'cancelled' : 'error', message)
    throw new Error(message)
  }
}

export { gcs, backup }
