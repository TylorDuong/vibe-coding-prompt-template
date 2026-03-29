import { useEffect, useState, useCallback } from 'react'
import UploadZone, { type FileMetadata } from './components/UploadZone'
import FileCard from './components/FileCard'
import ProcessButton from './components/ProcessButton'
import ProgressBar from './components/ProgressBar'
import TimelinePreview, { type TimelineData } from './components/TimelinePreview'
import GraphicsSidebar, { type GraphicItem } from './components/GraphicsSidebar'
import { useProcessPipeline, type PipelineConfig } from './hooks/useProcessPipeline'

type EngineStatus = 'checking' | 'connected' | 'error'

type LoadedFile = {
  filePath: string
  meta: FileMetadata
}

const DEFAULT_CONFIG: PipelineConfig = {
  silenceThresholdMs: 500,
  attentionLengthMs: 3000,
}

function App(): React.JSX.Element {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('checking')
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null)
  const [graphics, setGraphics] = useState<GraphicItem[]>([])
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG)
  const pipeline = useProcessPipeline()

  const checkEngine = useCallback(() => {
    setEngineStatus('checking')
    window.electron
      .invoke('engine:health')
      .then((result) => {
        const r = result as { ok: boolean }
        setEngineStatus(r.ok ? 'connected' : 'error')
      })
      .catch(() => setEngineStatus('error'))
  }, [])

  const handleReconnect = useCallback(() => {
    setEngineStatus('checking')
    window.electron
      .invoke('engine:reconnect')
      .then((result) => {
        const r = result as { ok: boolean }
        setEngineStatus(r.ok ? 'connected' : 'error')
      })
      .catch(() => setEngineStatus('error'))
  }, [])

  useEffect(() => {
    checkEngine()
  }, [checkEngine])

  const handleFileAccepted = useCallback((filePath: string, meta: FileMetadata) => {
    setLoadedFile({ filePath, meta })
    pipeline.reset()
  }, [pipeline])

  const handleClear = useCallback(() => {
    setLoadedFile(null)
    pipeline.reset()
  }, [pipeline])

  const handleAddGraphic = useCallback((graphic: GraphicItem) => {
    setGraphics((prev) => [...prev, graphic])
  }, [])

  const handleRemoveGraphic = useCallback((id: string) => {
    setGraphics((prev) => prev.filter((g) => g.id !== id))
  }, [])

  const handleTagChange = useCallback((id: string, tag: string) => {
    setGraphics((prev) =>
      prev.map((g) => (g.id === id ? { ...g, tag } : g))
    )
  }, [])

  const handleProcess = useCallback(async () => {
    if (!loadedFile) return
    pipeline.run(loadedFile.filePath, graphics, config)
  }, [loadedFile, graphics, config, pipeline])

  const isProcessing =
    pipeline.progress.stage !== 'idle' &&
    pipeline.progress.stage !== 'done' &&
    pipeline.progress.stage !== 'error'

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

              {/* Config controls */}
              <div className="mx-4 mt-3 flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  Silence threshold
                  <input
                    type="number"
                    min={100}
                    max={2000}
                    step={100}
                    value={config.silenceThresholdMs}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        silenceThresholdMs: Number(e.target.value),
                      }))
                    }
                    disabled={isProcessing}
                    className="w-20 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                               focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50"
                  />
                  <span className="text-zinc-600">ms</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  Attention length
                  <input
                    type="number"
                    min={1000}
                    max={10000}
                    step={500}
                    value={config.attentionLengthMs}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        attentionLengthMs: Number(e.target.value),
                      }))
                    }
                    disabled={isProcessing}
                    className="w-20 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                               focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50"
                  />
                  <span className="text-zinc-600">ms</span>
                </label>
              </div>

              <div className="mx-4 mt-3">
                <ProcessButton
                  onClick={handleProcess}
                  isProcessing={isProcessing}
                  disabled={engineStatus !== 'connected'}
                />
              </div>

              {pipeline.progress.stage !== 'idle' && (
                <ProgressBar progress={pipeline.progress} />
              )}

              {pipeline.error && (
                <div className="mx-4 mt-3 rounded-lg border border-red-900/50 bg-red-950/20 p-3">
                  <p className="text-xs text-red-400">{pipeline.error}</p>
                  <button
                    onClick={handleProcess}
                    className="mt-2 rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              )}

              {pipeline.result && (
                <TimelinePreview timeline={pipeline.result as unknown as TimelineData} />
              )}
            </>
          ) : (
            <UploadZone onFileAccepted={handleFileAccepted} />
          )}
        </section>

        {/* Graphics sidebar */}
        <GraphicsSidebar
          graphics={graphics}
          onAdd={handleAddGraphic}
          onRemove={handleRemoveGraphic}
          onTagChange={handleTagChange}
        />
      </main>

      {/* Status bar */}
      <footer className="flex items-center justify-between border-t border-zinc-800 px-4 py-1.5 text-xs text-zinc-600">
        <span className="flex items-center gap-2">
          <span className={statusColor[engineStatus]}>
            {statusLabel[engineStatus]}
          </span>
          {engineStatus === 'error' && (
            <button
              onClick={handleReconnect}
              className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              Reconnect
            </button>
          )}
        </span>
        <span>Local processing</span>
      </footer>
    </div>
  )
}

export default App
