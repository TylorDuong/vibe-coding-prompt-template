import { ipcMain, dialog, BrowserWindow } from 'electron'
import { sendToEngine, startPythonEngine, isEngineRunning } from './pythonBridge'

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

  ipcMain.handle('engine:ingest', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    return sendToEngine({ command: 'ingest', videoPath: p.videoPath })
  })

  ipcMain.handle('engine:processVideo', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    return sendToEngine({
      command: 'process',
      videoPath: p.videoPath,
      graphics: p.graphics ?? [],
      silenceThresholdMs: p.silenceThresholdMs ?? 500,
    })
  })

  ipcMain.handle('engine:detectSilence', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    return sendToEngine({
      command: 'detectSilence',
      videoPath: p.videoPath,
      silenceThresholdDb: p.silenceThresholdDb ?? -30,
      minSilenceDurationMs: p.minSilenceDurationMs ?? 500,
    })
  })

  ipcMain.handle('engine:cutSilences', async (_event, payload: unknown) => {
    const p = payload as Record<string, unknown>
    return sendToEngine({
      command: 'cutSilences',
      videoPath: p.videoPath,
      outputPath: p.outputPath,
      silenceThresholdDb: p.silenceThresholdDb ?? -30,
      minSilenceDurationMs: p.minSilenceDurationMs ?? 500,
    })
  })
}
