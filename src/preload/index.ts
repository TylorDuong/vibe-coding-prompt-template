import { contextBridge, ipcRenderer } from 'electron'

export type ExportProgressPayload = {
  percent: number
}

export type ElectronAPI = {
  invoke: (channel: string, data?: unknown) => Promise<unknown>
  /** Subscribe to FFmpeg export percent (0–100). Returns an unsubscribe function. */
  onExportProgress: (callback: (payload: ExportProgressPayload) => void) => () => void
  /** Low-res preview encode progress (0–100). */
  onPreviewProgress: (callback: (payload: ExportProgressPayload) => void) => () => void
}

const ALLOWED_CHANNELS = [
  'engine:health',
  'engine:thumbnail',
  'engine:reconnect',
  'engine:ingest',
  'engine:processVideo',
  'engine:detectSilence',
  'engine:cutSilences',
  'dialog:openVideo',
  'dialog:openImages',
  'dialog:saveVideo',
  'engine:exportFull',
  'engine:encodePreview',
  'preview:discard',
  'dialog:openSfx',
  'dialog:openConfigPreset',
  'dialog:saveConfigPreset',
]

const electronAPI: ElectronAPI = {
  invoke: (channel: string, data?: unknown): Promise<unknown> => {
    if (!ALLOWED_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, data)
  },
  onExportProgress: (callback: (payload: ExportProgressPayload) => void) => {
    const channel = 'engine:exportProgress'
    const handler = (_evt: unknown, payload: ExportProgressPayload) => {
      if (payload && typeof payload.percent === 'number') {
        callback({ percent: payload.percent })
      }
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  onPreviewProgress: (callback: (payload: ExportProgressPayload) => void) => {
    const channel = 'engine:previewProgress'
    const handler = (_evt: unknown, payload: ExportProgressPayload) => {
      if (payload && typeof payload.percent === 'number') {
        callback({ percent: payload.percent })
      }
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
}

contextBridge.exposeInMainWorld('electron', electronAPI)
