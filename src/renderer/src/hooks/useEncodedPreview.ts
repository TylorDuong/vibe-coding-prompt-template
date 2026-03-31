import { useEffect, useRef, useState, useCallback } from 'react'
import type { PipelineConfig, PipelineResult } from './useProcessPipeline'
import type { SfxExportAssignment, SfxPool } from '../components/SfxPoolPanel'

export type EncodedPreviewState = 'idle' | 'encoding' | 'ready' | 'error'

/** Brief pause so the main thread paints “done” before starting a second FFmpeg job. */
const ENCODE_PREVIEW_DEBOUNCE_MS = 400

type EncodePreviewResponse = {
  ok: boolean
  error?: string
  data?: {
    previewPath?: string
    previewDir?: string
  }
}

type UseEncodedPreviewArgs = {
  videoPath: string | null
  config: PipelineConfig
  pipelineResult: PipelineResult | null
  exportMatches: Record<string, unknown>[]
  sfxPool: SfxPool
  sfxAssignments: SfxExportAssignment[]
  /** Master switch (engine connected, etc.). */
  enabled: boolean
  /**
   * When false, no preview encode runs — e.g. while the main pipeline is still running.
   * Defaults to true if omitted (call sites should still pass explicitly when using stages).
   */
  processComplete?: boolean
}

export function useEncodedPreview({
  videoPath,
  config,
  pipelineResult,
  exportMatches,
  sfxPool,
  sfxAssignments,
  enabled,
  processComplete = true,
}: UseEncodedPreviewArgs): {
  state: EncodedPreviewState
  previewPath: string | null
  progressPercent: number
  error: string | null
  /** True while debounce timer is waiting before FFmpeg starts. */
  encodeQueued: boolean
} {
  const [state, setState] = useState<EncodedPreviewState>('idle')
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [progressPercent, setProgressPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [encodeQueued, setEncodeQueued] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)
  const previewDirRef = useRef<string | null>(null)

  const discardPreview = useCallback(async (dir: string | null) => {
    if (!dir) return
    try {
      await window.electron.invoke('preview:discard', { previewDir: dir })
    } catch {
      /* best-effort cleanup */
    }
  }, [])

  useEffect(() => {
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      void discardPreview(previewDirRef.current)
      previewDirRef.current = null
    }
  }, [discardPreview])

  useEffect(() => {
    const allow = Boolean(enabled && processComplete)

    if (!allow || !videoPath || !pipelineResult) {
      void discardPreview(previewDirRef.current)
      previewDirRef.current = null
      setEncodeQueued(false)
      setState('idle')
      setPreviewPath(null)
      setProgressPercent(0)
      setError(null)
      return
    }

    const keep = pipelineResult.keepSegments
    const evs = Array.isArray(pipelineResult.events) ? pipelineResult.events : []

    if (!Array.isArray(keep) || keep.length === 0) {
      void discardPreview(previewDirRef.current)
      previewDirRef.current = null
      setEncodeQueued(false)
      setState('idle')
      setPreviewPath(null)
      setError(null)
      return
    }

    let effectCancelled = false
    setEncodeQueued(true)

    const timer = window.setTimeout(() => {
      if (effectCancelled) return
      setEncodeQueued(false)

      void (async () => {
        if (effectCancelled) return

        setPreviewPath(null)
        setState('encoding')
        setProgressPercent(0)
        setError(null)
        unsubRef.current?.()
        unsubRef.current = window.electron.onPreviewProgress((p) => {
          setProgressPercent((prev) => Math.max(prev, p.percent))
        })

        try {
          const res = (await window.electron.invoke('engine:encodePreview', {
            videoPath,
            segments: pipelineResult.segments,
            matches: exportMatches,
            keepSegments: keep,
            events: evs,
            sfxPool,
            sfxAssignments,
            maxWords: config.maxWords,
            silenceThresholdDb: config.silenceThresholdDb,
            minSilenceDurationMs: config.minSilenceDurationMs,
            paddingMs: config.paddingMs,
            mergeGapMs: config.mergeGapMs,
            minKeepMs: config.minKeepMs,
            attentionLengthMs: config.attentionLengthMs,
            graphicWidthPercent: config.graphicWidthPercent,
            captionFontSize: config.captionFontSize,
            captionFontColor: config.captionFontColor,
            captionOutlineColor: config.captionOutlineColor,
            captionPosition: config.captionPosition,
            captionBold: config.captionBold,
            captionBox: config.captionBox,
            captionBorderWidth: config.captionBorderWidth,
            captionFadeInSec: config.captionFadeInSec,
            captionFadeOutSec: config.captionFadeOutSec,
            graphicPosition: config.graphicPosition,
            graphicMotion: config.graphicMotion,
            graphicAnimInSec: config.graphicAnimInSec,
            graphicFadeInSec: config.graphicFadeInSec,
            graphicFadeOutSec: config.graphicFadeOutSec,
            sfxCaptionEveryN: config.sfxCaptionEveryN,
            sfxGraphicEveryN: config.sfxGraphicEveryN,
            faceZoomEnabled: config.faceZoomEnabled,
            faceZoomIntervalSec: config.faceZoomIntervalSec,
            faceZoomPulseSec: config.faceZoomPulseSec,
            faceZoomStrength: config.faceZoomStrength,
            outputAspectRatio: config.outputAspectRatio,
            videoSpeed: config.videoSpeed,
            previewMaxWidth: 480,
            previewCrf: 28,
            previewMaxFps: 12,
          })) as EncodePreviewResponse

          unsubRef.current?.()
          unsubRef.current = null

          if (effectCancelled) {
            if (res.ok && res.data?.previewDir) {
              await discardPreview(String(res.data.previewDir))
            }
            return
          }

          if (res.ok && res.data?.previewPath && res.data?.previewDir) {
            previewDirRef.current = String(res.data.previewDir)
            setPreviewPath(String(res.data.previewPath))
            setState('ready')
            setProgressPercent(100)
          } else {
            setState('error')
            setError(res.error ?? 'Preview encode failed')
          }
        } catch (e) {
          unsubRef.current?.()
          unsubRef.current = null
          if (!effectCancelled) {
            setState('error')
            setError(e instanceof Error ? e.message : 'Preview encode failed')
          }
        }
      })()
    }, ENCODE_PREVIEW_DEBOUNCE_MS)

    return () => {
      effectCancelled = true
      setEncodeQueued(false)
      window.clearTimeout(timer)
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [
    enabled,
    processComplete,
    videoPath,
    pipelineResult,
    exportMatches,
    sfxPool,
    sfxAssignments,
    config,
    discardPreview,
  ])

  return { state, previewPath, progressPercent, error, encodeQueued }
}
