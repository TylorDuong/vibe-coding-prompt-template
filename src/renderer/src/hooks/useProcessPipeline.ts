import { useState, useCallback, useRef } from 'react'
import type { GraphicItem } from '../components/GraphicsSidebar'

export type PipelineStage =
  | 'idle'
  | 'ingesting'
  | 'detecting_silence'
  | 'transcribing'
  | 'matching'
  | 'polishing'
  | 'done'
  | 'error'

export type PipelineProgress = {
  stage: PipelineStage
  stageIndex: number
  totalStages: number
  percent: number
  message: string
}

type StageResult = {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
}

export type PipelineConfig = {
  silenceThresholdMs: number
  attentionLengthMs: number
}

export type PipelineResult = {
  video: Record<string, unknown> | null
  segments: Record<string, unknown>[]
  matches: Record<string, unknown>[]
  silences: Record<string, unknown>[]
  events: Record<string, unknown>[]
  eventCounts: Record<string, number>
  silenceThresholdMs: number
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: 'Ready',
  ingesting: 'Validating video file...',
  detecting_silence: 'Detecting silence...',
  transcribing: 'Transcribing audio (this may take a moment)...',
  matching: 'Matching graphics to transcript...',
  polishing: 'Building timeline events...',
  done: 'Processing complete',
  error: 'Processing failed',
}

const STAGES: PipelineStage[] = [
  'ingesting',
  'detecting_silence',
  'transcribing',
  'matching',
  'polishing',
]

export function useProcessPipeline() {
  const [progress, setProgress] = useState<PipelineProgress>({
    stage: 'idle',
    stageIndex: 0,
    totalStages: STAGES.length,
    percent: 0,
    message: STAGE_LABELS.idle,
  })
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const updateStage = useCallback((stage: PipelineStage) => {
    const idx = STAGES.indexOf(stage)
    const pct = idx >= 0 ? Math.round(((idx + 0.5) / STAGES.length) * 100) : 0
    setProgress({
      stage,
      stageIndex: Math.max(idx, 0),
      totalStages: STAGES.length,
      percent: stage === 'done' ? 100 : pct,
      message: STAGE_LABELS[stage],
    })
  }, [])

  const run = useCallback(
    async (videoPath: string, graphics: GraphicItem[], config: PipelineConfig) => {
      cancelledRef.current = false
      setResult(null)
      setError(null)

      try {
        // Stage 1: Ingest
        updateStage('ingesting')
        const ingestResult = (await window.electron.invoke('engine:ingest', {
          videoPath,
        })) as StageResult
        if (!ingestResult.ok) throw new Error(ingestResult.error ?? 'Ingest failed')
        if (cancelledRef.current) return

        // Stage 2: Silence detection
        updateStage('detecting_silence')
        const silenceResult = (await window.electron.invoke('engine:detectSilence', {
          videoPath,
          minSilenceDurationMs: config.silenceThresholdMs,
        })) as StageResult
        const silences = silenceResult.ok && silenceResult.data
          ? (silenceResult.data.silences as Record<string, unknown>[]) ?? []
          : []
        if (cancelledRef.current) return

        // Stage 3: Transcribe
        updateStage('transcribing')
        const transcribeResult = (await window.electron.invoke('engine:processVideo', {
          videoPath,
          graphics: graphics
            .filter((g) => g.tag.trim())
            .map((g) => ({ filePath: g.filePath, tag: g.tag })),
          silenceThresholdMs: config.silenceThresholdMs,
        })) as StageResult

        if (!transcribeResult.ok) {
          throw new Error(transcribeResult.error ?? 'Processing failed')
        }
        if (cancelledRef.current) return

        const timeline = transcribeResult.data?.timeline as PipelineResult | undefined
        if (!timeline) throw new Error('No timeline data returned')

        // Stages 4+5 are handled inside the engine process command
        updateStage('matching')
        await new Promise((r) => setTimeout(r, 200))
        if (cancelledRef.current) return

        updateStage('polishing')
        await new Promise((r) => setTimeout(r, 200))
        if (cancelledRef.current) return

        updateStage('done')
        setResult(timeline)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        setProgress((prev) => ({
          ...prev,
          stage: 'error',
          message: `Failed: ${message}`,
        }))
      }
    },
    [updateStage]
  )

  const reset = useCallback(() => {
    cancelledRef.current = true
    setProgress({
      stage: 'idle',
      stageIndex: 0,
      totalStages: STAGES.length,
      percent: 0,
      message: STAGE_LABELS.idle,
    })
    setResult(null)
    setError(null)
  }, [])

  return { progress, result, error, run, reset }
}
