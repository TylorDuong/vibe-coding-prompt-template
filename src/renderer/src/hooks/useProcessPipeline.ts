import { useState, useCallback, useRef } from 'react'
import type { GraphicItem } from '../lib/graphicsTypes'
import type { KeepSegment } from '../lib/timelineRemap'

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

export type CaptionPosition = 'bottom' | 'center'

export type GraphicPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'top_right'
  | 'top_left'
  | 'bottom_right'
  | 'bottom_left'

export type GraphicMotion =
  | 'none'
  | 'slide_in'
  | 'slide_right'
  | 'slide_left'
  | 'slide_up'
  | 'slide_down'
  | 'scale_in'

/** Export-only: center-crop to this aspect; original keeps source dimensions. */
export type OutputAspectRatio = 'original' | '16:9' | '9:16' | '1:1' | '4:5'

export type PipelineConfig = {
  silenceThresholdDb: number
  minSilenceDurationMs: number
  paddingMs: number
  mergeGapMs: number
  minKeepMs: number
  attentionLengthMs: number
  maxWords: number
  /** Max graphic width as % of video width (centered) */
  graphicWidthPercent: number
  captionFontSize: number
  /** #RRGGBB */
  captionFontColor: string
  /** #RRGGBB — drawtext border (outline) in export */
  captionOutlineColor: string
  captionPosition: CaptionPosition
  captionBold: boolean
  captionBox: boolean
  captionBorderWidth: number
  captionFadeInSec: number
  captionFadeOutSec: number
  graphicPosition: GraphicPosition
  graphicMotion: GraphicMotion
  graphicAnimInSec: number
  sfxCaptionEveryN: number
  sfxGraphicEveryN: number
  /** Alpha fade-in at graphic start on export timeline (seconds). */
  graphicFadeInSec: number
  /** Alpha fade-out before graphic end on export timeline (seconds). */
  graphicFadeOutSec: number
  faceZoomEnabled: boolean
  faceZoomIntervalSec: number
  faceZoomPulseSec: number
  faceZoomStrength: number
  /** Export: center crop to this aspect ratio */
  outputAspectRatio: OutputAspectRatio
  /** Export: playback speed multiplier (1 = normal) */
  videoSpeed: number
}

export type PipelinePreviewMeta = {
  outputDurationSec: number
  captionChunks: Array<{ text: string; start: number; end: number }>
  graphicIntervalsOutput: Array<{ start: number; end: number }>
  faceCenter: { x: number; y: number } | null
  faceZoomWindows: Array<{ start: number; end: number }>
  faceZoomStrengthPreview: number
}

export type PipelineResult = {
  video: Record<string, unknown> | null
  segments: Record<string, unknown>[]
  matches: Record<string, unknown>[]
  silences: Record<string, unknown>[]
  events: Record<string, unknown>[]
  eventCounts: Record<string, number>
  silenceThresholdMs: number
  /** Kept spans on the source timeline (for mapping to export time) */
  keepSegments?: KeepSegment[]
  preview?: PipelinePreviewMeta
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

        const videoDuration =
          typeof ingestResult.data?.duration === 'number' ? ingestResult.data.duration : 0

        // Stage 2: Silence detection (full FFmpeg pass — do not repeat inside process)
        updateStage('detecting_silence')
        const silenceResult = (await window.electron.invoke('engine:detectSilence', {
          videoPath,
          silenceThresholdDb: config.silenceThresholdDb,
          minSilenceDurationMs: config.minSilenceDurationMs,
        })) as StageResult
        if (!silenceResult.ok) {
          throw new Error(silenceResult.error ?? 'Silence detection failed')
        }
        const silences = (silenceResult.data?.silences as Record<string, unknown>[]) ?? []
        if (cancelledRef.current) return

        // Stage 3: Transcribe + match + polish (engine skips duplicate silence detect when silences are sent)
        updateStage('transcribing')
        const transcribeResult = (await window.electron.invoke('engine:processVideo', {
          videoPath,
          graphics: graphics.map((g) => ({
            filePath: g.filePath,
            tag: g.tag,
            kind: g.kind ?? 'image',
          })),
          silenceThresholdDb: config.silenceThresholdDb,
          minSilenceDurationMs: config.minSilenceDurationMs,
          paddingMs: config.paddingMs,
          mergeGapMs: config.mergeGapMs,
          minKeepMs: config.minKeepMs,
          attentionLengthMs: config.attentionLengthMs,
          maxWords: config.maxWords,
          captionFontSize: config.captionFontSize,
          captionBold: config.captionBold,
          outputAspectRatio: config.outputAspectRatio,
          faceZoomEnabled: config.faceZoomEnabled,
          faceZoomIntervalSec: config.faceZoomIntervalSec,
          faceZoomPulseSec: config.faceZoomPulseSec,
          faceZoomStrength: config.faceZoomStrength,
          silences,
          totalDuration: videoDuration,
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
