import { app, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'

/** Resolve renderer `local-file://…` requests to a filesystem path (Windows-safe). */
function localFileRequestToFsPath(requestUrl: string): string {
  try {
    const u = new URL(requestUrl)
    let raw = u.pathname
    if (u.hostname && !raw.startsWith('/')) {
      raw = `${u.hostname}${u.pathname}`
    } else if (!raw && u.hostname) {
      raw = u.hostname
    }
    let decoded = decodeURIComponent(raw.replace(/\+/g, ' '))
    if (process.platform === 'win32') {
      if (decoded.startsWith('/') && /^\/[A-Za-z]:/.test(decoded)) {
        decoded = decoded.slice(1)
      }
      decoded = decoded.replace(/\//g, '\\')
    }
    if (decoded.length > 0) {
      return decoded
    }
  } catch {
    /* fall through */
  }
  return decodeURIComponent(requestUrl.replace(/^local-file:\/\/?/i, ''))
}
import { startPythonEngine, stopPythonEngine } from './pythonBridge'
import { registerIpcHandlers } from './ipcHandlers'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
    },
  },
])

app.whenReady().then(() => {
  protocol.handle('local-file', (request) => {
    const filePath = localFileRequestToFsPath(request.url)
    return net.fetch(pathToFileURL(filePath).href)
  })

  startPythonEngine()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopPythonEngine()
})
