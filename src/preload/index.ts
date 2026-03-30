import { contextBridge, ipcRenderer } from 'electron'

export type ElectronAPI = {
  invoke: (channel: string, data?: unknown) => Promise<unknown>
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
  'dialog:openSfx',
]

const electronAPI: ElectronAPI = {
  invoke: (channel: string, data?: unknown): Promise<unknown> => {
    if (!ALLOWED_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`))
    }
    return ipcRenderer.invoke(channel, data)
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)
