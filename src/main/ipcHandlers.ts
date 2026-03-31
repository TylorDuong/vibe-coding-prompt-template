import { ipcMain, dialog, BrowserWindow } from 'electron'
import { sendToEngine, startPythonEngine, isEngineRunning, LONG_ENGINE_TIMEOUT_MS } from './pythonBridge'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { join, relative, resolve, isAbsolute } from 'path'
import { tmpdir } from 'os'

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

function validatePreviewDir(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  const r = isAbsolute(raw) ? resolve(raw) : null
  if (!r) return null
  const rel = relative(resolve(tmpdir()), r)
  if (rel.startsWith('..') || rel === '') return null
  return r
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  let n: number
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    n = raw
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    n = Number(raw)
  } else {
    n = NaN
  }
  if (!Number.isFinite(n)) {
    return Math.max(min, Math.min(max, fallback))
  }
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
        maxWords: clampNumber(p.maxWords, 1, 20, 3),
        graphicDisplaySec: clampNumber(p.graphicDisplaySec, 0.5, 30, 2),
        faceZoomEnabled: Boolean(p.faceZoomEnabled),
        faceZoomIntervalSec: clampNumber(p.faceZoomIntervalSec, 0.5, 30, 3),
        faceZoomPulseSec: clampNumber(p.faceZoomPulseSec, 0.05, 2, 0.35),
        faceZoomStrength: clampNumber(p.faceZoomStrength, 0, 0.45, 0.12),
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

  ipcMain.handle('engine:exportFull', async (event, payload: unknown) => {
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
        captionOutlineColor:
          typeof p.captionOutlineColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(p.captionOutlineColor)
            ? p.captionOutlineColor.slice(1).toUpperCase()
            : '000000',
        captionPosition: capPos,
        captionBold: Boolean(p.captionBold),
        captionBox: Boolean(p.captionBox),
        captionBorderWidth: clampNumber(p.captionBorderWidth, 0, 8, 2),
        captionFadeInSec: clampNumber(p.captionFadeInSec, 0, 2, 0),
        captionFadeOutSec: clampNumber(p.captionFadeOutSec, 0, 2, 0),
        graphicPosition: gpos,
        graphicMotion: gmot,
        graphicAnimInSec: clampNumber(p.graphicAnimInSec, 0, 3, 0.25),
        graphicFadeInSec: clampNumber(p.graphicFadeInSec, 0, 5, 0),
        graphicFadeOutSec: clampNumber(p.graphicFadeOutSec, 0, 5, 0),
        sfxCaptionEveryN: clampNumber(p.sfxCaptionEveryN, 0, 20, 1),
        sfxGraphicEveryN: clampNumber(p.sfxGraphicEveryN, 0, 20, 1),
        faceZoomEnabled: Boolean(p.faceZoomEnabled),
        faceZoomIntervalSec: clampNumber(p.faceZoomIntervalSec, 0.5, 30, 3),
        faceZoomPulseSec: clampNumber(p.faceZoomPulseSec, 0.05, 2, 0.35),
        faceZoomStrength: clampNumber(p.faceZoomStrength, 0, 0.45, 0.12),
        outputAspectRatio: ['original', '16:9', '9:16', '1:1', '4:5'].includes(
          String(p.outputAspectRatio),
        )
          ? String(p.outputAspectRatio)
          : 'original',
        videoSpeed: clampNumber(p.videoSpeed, 0.25, 4, 1),
      },
      {
        timeoutMs: LONG_ENGINE_TIMEOUT_MS,
        onExportProgress: (prog) => {
          event.sender.send('engine:exportProgress', prog)
        },
      },
    )
  })

  ipcMain.handle('engine:encodePreview', async (event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    const videoPath = validateFilePath(p.videoPath)
    if (!videoPath) return ipcError('Invalid or missing video file path.')

    const tmpDir = await mkdtemp(join(tmpdir(), 'splitty-preview-'))
    const outputPath = join(tmpDir, 'preview.mp4')

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

    try {
      const result = (await sendToEngine(
        {
          command: 'encodePreview',
          videoPath,
          outputPath,
          segments: p.segments ?? [],
          matches: p.matches ?? [],
          keepSegments: p.keepSegments ?? [],
          events: p.events ?? [],
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
          captionOutlineColor:
            typeof p.captionOutlineColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(p.captionOutlineColor)
              ? p.captionOutlineColor.slice(1).toUpperCase()
              : '000000',
          captionPosition: capPos,
          captionBold: Boolean(p.captionBold),
          captionBox: Boolean(p.captionBox),
          captionBorderWidth: clampNumber(p.captionBorderWidth, 0, 8, 2),
          captionFadeInSec: clampNumber(p.captionFadeInSec, 0, 2, 0),
          captionFadeOutSec: clampNumber(p.captionFadeOutSec, 0, 2, 0),
          graphicPosition: gpos,
          graphicMotion: gmot,
          graphicAnimInSec: clampNumber(p.graphicAnimInSec, 0, 3, 0.25),
          graphicFadeInSec: clampNumber(p.graphicFadeInSec, 0, 5, 0),
          graphicFadeOutSec: clampNumber(p.graphicFadeOutSec, 0, 5, 0),
          sfxCaptionEveryN: clampNumber(p.sfxCaptionEveryN, 0, 20, 1),
          sfxGraphicEveryN: clampNumber(p.sfxGraphicEveryN, 0, 20, 1),
          faceZoomEnabled: Boolean(p.faceZoomEnabled),
          faceZoomIntervalSec: clampNumber(p.faceZoomIntervalSec, 0.5, 30, 3),
          faceZoomPulseSec: clampNumber(p.faceZoomPulseSec, 0.05, 2, 0.35),
          faceZoomStrength: clampNumber(p.faceZoomStrength, 0, 0.45, 0.12),
          outputAspectRatio: ['original', '16:9', '9:16', '1:1', '4:5'].includes(
            String(p.outputAspectRatio),
          )
            ? String(p.outputAspectRatio)
            : 'original',
          videoSpeed: clampNumber(p.videoSpeed, 0.25, 4, 1),
          previewMaxWidth: clampNumber(p.previewMaxWidth, 240, 960, 480),
          previewCrf: clampNumber(p.previewCrf, 18, 35, 28),
          previewMaxFps: clampNumber(p.previewMaxFps, 6, 30, 12),
        },
        {
          timeoutMs: LONG_ENGINE_TIMEOUT_MS,
          onPreviewProgress: (prog) => {
            event.sender.send('engine:previewProgress', prog)
          },
        },
      )) as { ok?: boolean; error?: string; data?: Record<string, unknown> }

      if (result.ok && result.data) {
        return {
          ok: true,
          data: {
            ...result.data,
            previewPath: outputPath,
            previewDir: tmpDir,
          },
        }
      }
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, error: result.error ?? 'Preview encode failed' }
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
      const message = err instanceof Error ? err.message : 'Preview encode failed'
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('preview:discard', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    const dir = validatePreviewDir(p.previewDir)
    if (!dir) return { ok: false, error: 'Invalid preview directory' }
    try {
      await rm(dir, { recursive: true, force: true })
      return { ok: true }
    } catch {
      return { ok: false, error: 'Could not remove preview files' }
    }
  })
}
