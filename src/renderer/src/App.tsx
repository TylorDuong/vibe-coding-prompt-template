import { useEffect, useState, useCallback, useMemo } from 'react'
import UploadZone, { type FileMetadata } from './components/UploadZone'
import FileCard from './components/FileCard'
import ProcessButton from './components/ProcessButton'
import ProgressBar from './components/ProgressBar'
import ConfigPanel from './components/ConfigPanel'
import DynamicCroppingPanel from './components/DynamicCroppingPanel'
import SfxPoolPanel, {
  buildSfxAssignments,
  buildSfxPool,
  DEFAULT_SFX_SLOTS,
  type SfxSlot,
} from './components/SfxPoolPanel'
import TimelinePreview, { type TimelineData } from './components/TimelinePreview'
import GraphicsSidebar, { type GraphicItem } from './components/GraphicsSidebar'
import ExportVideoButton from './components/ExportVideoButton'
import {
  useProcessPipeline,
  type PipelineConfig,
  type PipelinePreviewMeta,
} from './hooks/useProcessPipeline'
import { useEncodedPreview } from './hooks/useEncodedPreview'
import { DEFAULT_PIPELINE_CONFIG } from './lib/pipelineConfigPreset'
import {
  buildExportMatches,
  filterTimelineSfxForDisplay,
  mergeTimelineWithMatches,
  countTimelineEventTypes,
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
  const [timelineFloating, setTimelineFloating] = useState(false)
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

  const sfxPoolExport = useMemo(() => buildSfxPool(sfxSlots), [sfxSlots])
  const sfxAssignmentsExport = useMemo(() => buildSfxAssignments(sfxSlots), [sfxSlots])

  const pipelineCompleteForPreview =
    pipeline.progress.stage === 'done' && pipeline.result != null

  const encodedPreview = useEncodedPreview({
    videoPath: loadedFile?.filePath ?? null,
    config,
    pipelineResult: pipeline.result,
    exportMatches,
    sfxPool: sfxPoolExport,
    sfxAssignments: sfxAssignmentsExport,
    enabled: engineStatus === 'connected' && Boolean(pipeline.result),
    processComplete: pipelineCompleteForPreview,
  })

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
    const eventsForUi = filterTimelineSfxForDisplay(
      t.events as TimelineData['events'],
      config.sfxCaptionEveryN,
      config.sfxGraphicEveryN,
    )
    return {
      ...base,
      matches: t.matches as TimelineData['matches'],
      events: eventsForUi,
      eventCounts: countTimelineEventTypes(eventsForUi),
    }
  }, [
    pipeline.result,
    exportMatches,
    config.attentionLengthMs,
    config.sfxCaptionEveryN,
    config.sfxGraphicEveryN,
  ])

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

      <main className="flex flex-1 flex-col overflow-hidden">
        <section
          className={`flex flex-1 flex-col overflow-auto ${
            timelineFloating && pipeline.result ? 'pb-44' : 'pb-4'
          }`}
        >
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
                sfxSlots={sfxSlots}
                onSfxSlotsChange={setSfxSlots}
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

              <DynamicCroppingPanel config={config} onChange={setConfig} disabled={isProcessing} />

              <SfxPoolPanel
                slots={sfxSlots}
                onUpdate={handleSfxSlotUpdate}
                onAddCustom={() => {
                  setSfxSlots((prev) => [
                    ...prev,
                    {
                      id: `custom-${crypto.randomUUID()}`,
                      label: 'Custom SFX',
                      description: 'User-defined sound',
                      trigger: 'none',
                      filePath: null,
                      fileName: null,
                      volumePercent: 100,
                    },
                  ])
                }}
                onRemove={(id) => {
                  setSfxSlots((prev) => prev.filter((s) => s.id !== id))
                }}
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

              <div className="mx-4 mt-3 min-h-[min(280px,42vh)]">
                {pipeline.result && displayTimeline ? (
                  <TimelinePreview
                    videoPath={loadedFile.filePath}
                    timeline={displayTimeline}
                    keepSegments={pipeline.result.keepSegments ?? []}
                    attentionLengthMs={config.attentionLengthMs}
                    selectedGraphicId={selectedGraphicId}
                    wordTriggers={wordTriggers}
                    onWordAssign={handleWordAssign}
                    pipelineConfig={config}
                    onFloatingTimelineChange={setTimelineFloating}
                    encodedPreviewPath={encodedPreview.previewPath}
                    encodedPreviewState={encodedPreview.state}
                    encodedPreviewProgress={encodedPreview.progressPercent}
                    encodedPreviewError={encodedPreview.error}
                    encodedPreviewQueued={encodedPreview.encodeQueued}
                    previewMeta={
                      pipeline.result.preview != null &&
                      typeof pipeline.result.preview === 'object'
                        ? (pipeline.result.preview as PipelinePreviewMeta)
                        : null
                    }
                    graphicsSidebar={
                      <GraphicsSidebar
                        embedded
                        pipelineConfig={config}
                        onPipelineConfigChange={setConfig}
                        configDisabled={isProcessing}
                        graphics={graphics}
                        onAdd={handleAddGraphic}
                        onRemove={handleRemoveGraphic}
                        onTagChange={handleTagChange}
                        selectedId={selectedGraphicId}
                        onSelect={setSelectedGraphicId}
                        wordTriggers={wordTriggers}
                        onClearPlacement={handleClearWordPlacement}
                      />
                    }
                  />
                ) : (
                  <div className="flex min-h-[min(200px,30vh)] items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-10 text-center text-xs text-zinc-500">
                    Run <span className="mx-1 font-medium text-zinc-400">Process video</span> to open the
                    transcript, timeline scrubber, preview, and graphics panel.
                  </div>
                )}
              </div>

              {pipeline.result && displayTimeline && (
                <div className={timelineFloating ? 'mb-6' : ''}>
                  <ExportVideoButton
                    videoPath={loadedFile.filePath}
                    config={config}
                    pipelineResult={pipeline.result}
                    exportMatches={exportMatches}
                    sfxPool={sfxPoolExport}
                    sfxAssignments={sfxAssignmentsExport}
                    disabled={isProcessing}
                  />
                </div>
              )}
            </>
          ) : (
            <UploadZone onFileAccepted={handleFileAccepted} />
          )}
        </section>
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
