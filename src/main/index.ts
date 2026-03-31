import { app, BrowserWindow, protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname, join } from 'path'
import { Readable } from 'node:stream'
import { startPythonEngine, stopPythonEngine } from './pythonBridge'
import { registerIpcHandlers } from './ipcHandlers'

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

function mimeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    case '.mkv':
      return 'video/x-matroska'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

/** Parse first `bytes=` range; used so `<video>` gets 206 + Content-Range (required for many encodes). */
function parseBytesRange(
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null
  const first = rangeHeader.slice('bytes='.length).split(',')[0]?.trim()
  if (!first) return null

  if (first.startsWith('-')) {
    const suffix = parseInt(first.slice(1), 10)
    if (Number.isNaN(suffix) || suffix <= 0) return null
    if (suffix >= size) {
      return { start: 0, end: size - 1 }
    }
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const dash = first.indexOf('-')
  if (dash < 0) return null
  const startStr = first.slice(0, dash)
  const endStr = first.slice(dash + 1)
  const start = startStr === '' ? 0 : parseInt(startStr, 10)
  let end = endStr === '' ? size - 1 : parseInt(endStr, 10)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  if (start >= size) return 'unsatisfiable'
  if (end >= size) end = size - 1
  if (start > end) return 'unsatisfiable'
  return { start, end }
}

function localFileResponse(request: Request): Response {
  const filePath = localFileRequestToFsPath(request.url)
  if (!existsSync(filePath)) {
    return new Response(null, { status: 404 })
  }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(filePath)
  } catch {
    return new Response(null, { status: 404 })
  }
  if (!st.isFile()) {
    return new Response(null, { status: 404 })
  }

  const size = st.size
  const mime = mimeForPath(filePath)
  const baseHeaders: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
  }

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(size),
      },
    })
  }

  if (request.method !== 'GET') {
    return new Response(null, { status: 405 })
  }

  const parsed = parseBytesRange(request.headers.get('range'), size)

  if (parsed === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${size}`,
      },
    })
  }

  if (parsed != null) {
    const { start, end } = parsed
    const stream = createReadStream(filePath, { start, end })
    const body = Readable.toWeb(stream)
    return new Response(body, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
      },
    })
  }

  const stream = createReadStream(filePath)
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
  return new Response(body, {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(size),
    },
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
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
      stream: true,
    },
  },
])

app.whenReady().then(() => {
  protocol.handle('local-file', (request) => localFileResponse(request))

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

app.on('will-quit', () => {
  stopPythonEngine()
})
