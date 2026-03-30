import { ipcMain, dialog, BrowserWindow } from 'electron'
import { sendToEngine, startPythonEngine, isEngineRunning, LONG_ENGINE_TIMEOUT_MS } from './pythonBridge'
import { existsSync, readFileSync, writeFileSync } from 'fs'
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

  ipcMain.handle('dialog:openConfigPreset', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import Splitty settings (JSON)',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true as const }
    }
    const filePath = result.filePaths[0]
    try {
      const content = readFileSync(filePath, 'utf-8')
      return { canceled: false as const, filePath, content }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { canceled: false as const, error: message }
    }
  })

  ipcMain.handle('dialog:saveConfigPreset', async (_event, payload: unknown) => {
    const p = payload as { content?: unknown }
    const content = typeof p.content === 'string' ? p.content : ''
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export Splitty settings (JSON)',
      defaultPath: 'splitty-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true as const }
    }
    try {
      writeFileSync(result.filePath, content, 'utf-8')
      return { canceled: false as const, filePath: result.filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { canceled: false as const, error: message }
    }
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

    const silences = Array.isArray(p.silences) ? p.silences : undefined
    const totalDuration = typeof p.totalDuration === 'number' ? p.totalDuration : undefined

    return sendToEngine(
      {
        command: 'process',
        videoPath,
        graphics: Array.isArray(p.graphics) ? p.graphics : [],
        silenceThresholdDb: clampNumber(p.silenceThresholdDb, -60, 0, -40),
        minSilenceDurationMs: clampNumber(p.minSilenceDurationMs, 100, 5000, 800),
        paddingMs: clampNumber(p.paddingMs, 0, 1000, 200),
        mergeGapMs: clampNumber(p.mergeGapMs, 0, 2000, 300),
        minKeepMs: clampNumber(p.minKeepMs, 0, 1000, 150),
        attentionLengthMs: clampNumber(p.attentionLengthMs, 500, 60000, 3000),
        ...(silences !== undefined ? { silences } : {}),
        ...(totalDuration !== undefined && totalDuration > 0 ? { totalDuration } : {}),
      },
      { timeoutMs: LONG_ENGINE_TIMEOUT_MS },
    )
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

    const capPos = p.captionPosition === 'center' ? 'center' : 'bottom'
    const gpos = [
      'center',
      'top',
      'bottom',
      'top_right',
      'top_left',
      'bottom_right',
      'bottom_left',
    ].includes(String(p.graphicPosition))
      ? String(p.graphicPosition)
      : 'center'
    const gmot = p.graphicMotion === 'slide_in' ? 'slide_in' : 'none'

    return sendToEngine(
      {
        command: 'exportFull',
        videoPath,
        outputPath,
        segments: p.segments ?? [],
        matches: p.matches ?? [],
        sfxPool: p.sfxPool ?? {},
        sfxAssignments: Array.isArray(p.sfxAssignments) ? p.sfxAssignments : undefined,
        maxWords: clampNumber(p.maxWords, 1, 20, 3),
        silenceThresholdDb: clampNumber(p.silenceThresholdDb, -60, 0, -40),
        minSilenceDurationMs: clampNumber(p.minSilenceDurationMs, 100, 5000, 800),
        paddingMs: clampNumber(p.paddingMs, 0, 1000, 200),
        mergeGapMs: clampNumber(p.mergeGapMs, 0, 2000, 300),
        minKeepMs: clampNumber(p.minKeepMs, 0, 1000, 150),
        attentionLengthMs: clampNumber(p.attentionLengthMs, 500, 60000, 3000),
        graphicDisplaySec: clampNumber(p.graphicDisplaySec, 0.5, 30, 2),
        graphicWidthPercent: clampNumber(p.graphicWidthPercent, 10, 100, 85),
        captionFontSize: clampNumber(p.captionFontSize, 12, 120, 24),
        captionFontColor:
          typeof p.captionFontColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(p.captionFontColor)
            ? p.captionFontColor.slice(1).toUpperCase()
            : 'FFFFFF',
        captionPosition: capPos,
        captionBold: Boolean(p.captionBold),
        captionBox: Boolean(p.captionBox),
        captionBorderWidth: clampNumber(p.captionBorderWidth, 0, 8, 2),
        captionFadeInSec: clampNumber(p.captionFadeInSec, 0, 2, 0),
        captionFadeOutSec: clampNumber(p.captionFadeOutSec, 0, 2, 0),
        graphicPosition: gpos,
        graphicMotion: gmot,
        graphicAnimInSec: clampNumber(p.graphicAnimInSec, 0, 3, 0.25),
        sfxCaptionEveryN: clampNumber(p.sfxCaptionEveryN, 1, 20, 1),
        sfxGraphicEveryN: clampNumber(p.sfxGraphicEveryN, 1, 20, 1),
        removeFillerWords: Boolean(p.removeFillerWords),
        faceZoomEnabled: Boolean(p.faceZoomEnabled),
        faceZoomIntervalSec: clampNumber(p.faceZoomIntervalSec, 0.5, 30, 3),
        faceZoomPulseSec: clampNumber(p.faceZoomPulseSec, 0.05, 2, 0.35),
        faceZoomStrength: clampNumber(p.faceZoomStrength, 0, 0.45, 0.12),
      },
      { timeoutMs: LONG_ENGINE_TIMEOUT_MS },
    )
  })
}
