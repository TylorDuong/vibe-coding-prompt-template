import { ipcMain } from 'electron'
import { sendToEngine } from './pythonBridge'

export function registerIpcHandlers(): void {
  ipcMain.handle('engine:health', async () => {
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
