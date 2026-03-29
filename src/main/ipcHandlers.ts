import { ipcMain, dialog, BrowserWindow } from 'electron'
import { sendToEngine, startPythonEngine, isEngineRunning } from './pythonBridge'
import { existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'

function validateFilePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  const resolved = isAbsolute(raw) ? resolve(raw) : null
  if (!resolved) return null
  if (!existsSync(resolved)) return null
  return resolved
}

function validateOutputPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  return isAbsolute(raw) ? resolve(raw) : null
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : fallback
  return Math.max(min, Math.min(max, n))
}

function ipcError(message: string) {
  return { ok: false, error: message }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:openVideo', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select a video file',
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  ipcMain.handle('dialog:openSfx', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select a sound effect file',
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'aac', 'm4a'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  ipcMain.handle('dialog:openImages', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select graphic images',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
      ],
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, filePaths: [] }
    }
    return { canceled: false, filePaths: result.filePaths }
  })

  ipcMain.handle('dialog:saveVideo', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export edited video',
      defaultPath: 'output.mp4',
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
      ],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('engine:health', async () => {
    return sendToEngine({ command: 'health' })
  })

  ipcMain.handle('engine:reconnect', async () => {
    if (!isEngineRunning()) {
      startPythonEngine()
      await new Promise((r) => setTimeout(r, 1000))
    }
    return sendToEngine({ command: 'health' })
  })

  ipcMain.handle('engine:thumbnail', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    const videoPath = validateFilePath(p.videoPath)
    if (!videoPath) return ipcError('Invalid or missing video file path.')
    return sendToEngine({ command: 'thumbnail', videoPath })
  })

  ipcMain.handle('engine:ingest', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    const videoPath = validateFilePath(p.videoPath)
    if (!videoPath) return ipcError('Invalid or missing video file path.')
    return sendToEngine({ command: 'ingest', videoPath })
  })

  ipcMain.handle('engine:processVideo', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    const videoPath = validateFilePath(p.videoPath)
    if (!videoPath) return ipcError('Invalid or missing video file path.')

    return sendToEngine({
      command: 'process',
      videoPath,
      graphics: Array.isArray(p.graphics) ? p.graphics : [],
      silenceThresholdDb: clampNumber(p.silenceThresholdDb, -60, 0, -40),
      minSilenceDurationMs: clampNumber(p.minSilenceDurationMs, 100, 5000, 800),
      paddingMs: clampNumber(p.paddingMs, 0, 1000, 200),
      mergeGapMs: clampNumber(p.mergeGapMs, 0, 2000, 300),
      minKeepMs: clampNumber(p.minKeepMs, 0, 1000, 150),
    })
  })

  ipcMain.handle('engine:detectSilence', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    const videoPath = validateFilePath(p.videoPath)
    if (!videoPath) return ipcError('Invalid or missing video file path.')

    return sendToEngine({
      command: 'detectSilence',
      videoPath,
      silenceThresholdDb: clampNumber(p.silenceThresholdDb, -60, 0, -40),
      minSilenceDurationMs: clampNumber(p.minSilenceDurationMs, 100, 5000, 800),
    })
  })

  ipcMain.handle('engine:cutSilences', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    const videoPath = validateFilePath(p.videoPath)
    if (!videoPath) return ipcError('Invalid or missing video file path.')

    return sendToEngine({
      command: 'cutSilences',
      videoPath,
      outputPath: validateOutputPath(p.outputPath),
      silenceThresholdDb: clampNumber(p.silenceThresholdDb, -60, 0, -40),
      minSilenceDurationMs: clampNumber(p.minSilenceDurationMs, 100, 5000, 800),
      paddingMs: clampNumber(p.paddingMs, 0, 1000, 200),
    })
  })

  ipcMain.handle('engine:exportFull', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    const videoPath = validateFilePath(p.videoPath)
    if (!videoPath) return ipcError('Invalid or missing video file path.')
    const outputPath = validateOutputPath(p.outputPath)
    if (!outputPath) return ipcError('Invalid or missing output file path.')

    return sendToEngine({
      command: 'exportFull',
      videoPath,
      outputPath,
      segments: p.segments ?? [],
      matches: p.matches ?? [],
      sfxPool: p.sfxPool ?? {},
      maxWords: clampNumber(p.maxWords, 1, 20, 3),
      silenceThresholdDb: clampNumber(p.silenceThresholdDb, -60, 0, -40),
      minSilenceDurationMs: clampNumber(p.minSilenceDurationMs, 100, 5000, 800),
      paddingMs: clampNumber(p.paddingMs, 0, 1000, 200),
      mergeGapMs: clampNumber(p.mergeGapMs, 0, 2000, 300),
      minKeepMs: clampNumber(p.minKeepMs, 0, 1000, 150),
      attentionLengthMs: clampNumber(p.attentionLengthMs, 500, 60000, 3000),
      graphicDisplaySec: clampNumber(p.graphicDisplaySec, 0.5, 30, 2),
    })
  })
}
