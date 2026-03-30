import { useEffect, useState, useCallback, useMemo } from 'react'
import UploadZone, { type FileMetadata } from './components/UploadZone'
import FileCard from './components/FileCard'
import ProcessButton from './components/ProcessButton'
import ProgressBar from './components/ProgressBar'
import ConfigPanel from './components/ConfigPanel'
import SfxPoolPanel, {
  buildSfxAssignments,
  buildSfxPool,
  DEFAULT_SFX_SLOTS,
  type SfxSlot,
} from './components/SfxPoolPanel'
import TimelinePreview, { type TimelineData } from './components/TimelinePreview'
import GraphicsSidebar, { type GraphicItem } from './components/GraphicsSidebar'
import ExportVideoButton from './components/ExportVideoButton'
import { useProcessPipeline, type PipelineConfig } from './hooks/useProcessPipeline'
import { DEFAULT_PIPELINE_CONFIG } from './lib/pipelineConfigPreset'
import {
  buildExportMatches,
  mergeTimelineWithMatches,
  type WordTrigger,
  type TimelineDataLike,
} from './lib/graphicPlacements'

type EngineStatus = 'checking' | 'connected' | 'error'

type LoadedFile = {
  filePath: string
  meta: FileMetadata
}

const DEFAULT_CONFIG: PipelineConfig = DEFAULT_PIPELINE_CONFIG

function App(): React.JSX.Element {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('checking')
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null)
  const [graphics, setGraphics] = useState<GraphicItem[]>([])
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG)
  const [presetNotice, setPresetNotice] = useState<string | null>(null)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [sfxSlots, setSfxSlots] = useState<SfxSlot[]>(DEFAULT_SFX_SLOTS)
  const [selectedGraphicId, setSelectedGraphicId] = useState<string | null>(null)
  const [wordTriggers, setWordTriggers] = useState<Record<string, WordTrigger>>({})
  const pipeline = useProcessPipeline()

  const exportMatches = useMemo(() => {
    if (!pipeline.result) return []
    return buildExportMatches(
      graphics,
      pipeline.result.matches,
      wordTriggers,
      config.graphicDisplaySec,
    )
  }, [pipeline.result, graphics, wordTriggers, config.graphicDisplaySec])

  const displayTimeline = useMemo((): TimelineData | null => {
    if (!pipeline.result) return null
    const base = pipeline.result as unknown as TimelineData
    const t = mergeTimelineWithMatches(
      {
        video: base.video,
        segments: base.segments,
        matches: base.matches,
        silences: base.silences,
        silenceThresholdMs: base.silenceThresholdMs,
        events: base.events,
        eventCounts: base.eventCounts,
      } satisfies TimelineDataLike,
      exportMatches,
      config.attentionLengthMs,
    )
    return {
      ...base,
      matches: t.matches as TimelineData['matches'],
      events: t.events as TimelineData['events'],
      eventCounts: t.eventCounts,
    }
  }, [pipeline.result, exportMatches, config.attentionLengthMs])

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

  useEffect(() => {
    if (!presetNotice && !presetError) {
      return
    }
    const t = window.setTimeout(() => {
      setPresetNotice(null)
      setPresetError(null)
    }, 6000)
    return () => window.clearTimeout(t)
  }, [presetNotice, presetError])

  const handleFileAccepted = useCallback((filePath: string, meta: FileMetadata) => {
    setLoadedFile({ filePath, meta })
    setWordTriggers({})
    setSelectedGraphicId(null)
    pipeline.reset()
  }, [pipeline])

  const handleClear = useCallback(() => {
    setLoadedFile(null)
    setWordTriggers({})
    setSelectedGraphicId(null)
    pipeline.reset()
  }, [pipeline])

  const handleAddGraphic = useCallback((graphic: GraphicItem) => {
    setGraphics((prev) => [...prev, graphic])
  }, [])

  const handleRemoveGraphic = useCallback((id: string) => {
    setGraphics((prev) => prev.filter((g) => g.id !== id))
    setWordTriggers((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setSelectedGraphicId((cur) => (cur === id ? null : cur))
  }, [])

  const handleTagChange = useCallback((id: string, tag: string) => {
    setGraphics((prev) =>
      prev.map((g) => (g.id === id ? { ...g, tag } : g))
    )
  }, [])

  const handleSfxSlotUpdate = useCallback((id: string, updates: Partial<SfxSlot>) => {
    setSfxSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    )
  }, [])

  const handleClearWordPlacement = useCallback((id: string) => {
    setWordTriggers((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const handleWordAssign = useCallback(
    (payload: { start: number; end: number; word: string }) => {
      if (!selectedGraphicId) return
      setWordTriggers((prev) => ({
        ...prev,
        [selectedGraphicId]: {
          start: payload.start,
          end: payload.end,
          word: payload.word,
        },
      }))
    },
    [selectedGraphicId],
  )

  const handleProcess = useCallback(async () => {
    if (!loadedFile) return
    setWordTriggers({})
    setSelectedGraphicId(null)
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
        <span className="text-xs text-zinc-600">v0.2.0</span>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Workspace area */}
        <section className="flex flex-1 flex-col overflow-auto pb-4">
          {loadedFile ? (
            <>
              <FileCard
                filePath={loadedFile.filePath}
                meta={loadedFile.meta}
                onClear={handleClear}
              />

              {(presetNotice ?? presetError) && (
                <div className="mx-4 mt-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2">
                  {presetError && <p className="text-xs text-red-400">{presetError}</p>}
                  {presetNotice && <p className="text-xs text-emerald-400">{presetNotice}</p>}
                </div>
              )}

              <ConfigPanel
                config={config}
                onChange={setConfig}
                defaultConfig={DEFAULT_CONFIG}
                disabled={isProcessing}
                onPresetSuccess={(msg) => {
                  setPresetError(null)
                  setPresetNotice(msg)
                }}
                onPresetError={(msg) => {
                  setPresetNotice(null)
                  setPresetError(msg)
                }}
              />

              <SfxPoolPanel
                slots={sfxSlots}
                onUpdate={handleSfxSlotUpdate}
              />

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

              {pipeline.result && displayTimeline && (
                <>
                  <ExportVideoButton
                    videoPath={loadedFile.filePath}
                    config={config}
                    pipelineResult={pipeline.result}
                    exportMatches={exportMatches}
                    sfxPool={buildSfxPool(sfxSlots)}
                    sfxAssignments={buildSfxAssignments(sfxSlots)}
                    disabled={isProcessing}
                  />
                  <TimelinePreview
                    timeline={displayTimeline}
                    keepSegments={pipeline.result.keepSegments ?? []}
                    attentionLengthMs={config.attentionLengthMs}
                    selectedGraphicId={selectedGraphicId}
                    wordTriggers={wordTriggers}
                    onWordAssign={handleWordAssign}
                  />
                </>
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
          selectedId={selectedGraphicId}
          onSelect={setSelectedGraphicId}
          wordTriggers={wordTriggers}
          onClearPlacement={handleClearWordPlacement}
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
