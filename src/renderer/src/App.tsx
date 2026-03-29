import { useEffect, useState, useCallback } from 'react'
import UploadZone, { type FileMetadata } from './components/UploadZone'
import FileCard from './components/FileCard'
import ProcessButton from './components/ProcessButton'
import TimelinePreview, { type TimelineData } from './components/TimelinePreview'

type EngineStatus = 'checking' | 'connected' | 'error'

type LoadedFile = {
  filePath: string
  meta: FileMetadata
}

type ProcessResult = {
  ok: boolean
  data?: { timeline: TimelineData }
  error?: string
}

function App(): React.JSX.Element {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('checking')
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [timeline, setTimeline] = useState<TimelineData | null>(null)
  const [processError, setProcessError] = useState<string | null>(null)

  useEffect(() => {
    window.electron
      .invoke('engine:health')
      .then((result) => {
        const r = result as { ok: boolean }
        setEngineStatus(r.ok ? 'connected' : 'error')
      })
      .catch(() => setEngineStatus('error'))
  }, [])

  const handleFileAccepted = useCallback((filePath: string, meta: FileMetadata) => {
    setLoadedFile({ filePath, meta })
    setTimeline(null)
    setProcessError(null)
  }, [])

  const handleClear = useCallback(() => {
    setLoadedFile(null)
    setTimeline(null)
    setProcessError(null)
  }, [])

  const handleProcess = useCallback(async () => {
    if (!loadedFile) return
    setIsProcessing(true)
    setProcessError(null)
    setTimeline(null)

    try {
      const result = (await window.electron.invoke('engine:processVideo', {
        videoPath: loadedFile.filePath,
        graphics: [],
        silenceThresholdMs: 500,
      })) as ProcessResult

      if (result.ok && result.data) {
        setTimeline(result.data.timeline)
      } else {
        setProcessError(result.error ?? 'Processing failed')
      }
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : 'IPC call failed')
    } finally {
      setIsProcessing(false)
    }
  }, [loadedFile])

  const statusColor: Record<EngineStatus, string> = {
    checking: 'text-yellow-500',
    connected: 'text-emerald-500',
    error: 'text-red-500',
  }

  const statusLabel: Record<EngineStatus, string> = {
    checking: 'Connecting to engine...',
    connected: 'Engine connected',
    error: 'Engine offline',
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-base font-semibold tracking-tight text-zinc-50">
          Splitty AI
        </h1>
        <span className="text-xs text-zinc-600">v0.1.0</span>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Workspace area */}
        <section className="flex flex-1 flex-col overflow-auto">
          {loadedFile ? (
            <>
              <FileCard
                filePath={loadedFile.filePath}
                meta={loadedFile.meta}
                onClear={handleClear}
              />

              <ProcessButton
                onClick={handleProcess}
                isProcessing={isProcessing}
                disabled={engineStatus !== 'connected'}
              />

              {processError && (
                <p className="mx-4 mt-3 text-xs text-red-400">{processError}</p>
              )}

              {timeline && <TimelinePreview timeline={timeline} />}
            </>
          ) : (
            <UploadZone onFileAccepted={handleFileAccepted} />
          )}
        </section>

        {/* Sidebar */}
        <aside className="flex w-72 flex-col border-l border-zinc-800 bg-zinc-950">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Graphics
            </h2>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <p className="text-center text-xs text-zinc-600">
              Drag images here and tag them with keywords
            </p>
          </div>
        </aside>
      </main>

      {/* Status bar */}
      <footer className="flex items-center justify-between border-t border-zinc-800 px-4 py-1.5 text-xs text-zinc-600">
        <span className={statusColor[engineStatus]}>
          {statusLabel[engineStatus]}
        </span>
        <span>Local processing</span>
      </footer>
    </div>
  )
}

export default App
