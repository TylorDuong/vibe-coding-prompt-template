import { useState, useCallback, useRef, useEffect } from 'react'
import type { PipelineConfig, PipelineResult } from '../hooks/useProcessPipeline'
import type { SfxExportAssignment, SfxPool } from './SfxPoolPanel'

type ExportVideoButtonProps = {
  videoPath: string
  config: PipelineConfig
  pipelineResult: PipelineResult
  /** Final graphic matches (manual word triggers merged in the UI) */
  exportMatches: Record<string, unknown>[]
  sfxPool: SfxPool
  sfxAssignments: SfxExportAssignment[]
  disabled: boolean
}

type DialogResult = {
  canceled: boolean
  filePath?: string
}

type ExportResult = {
  ok: boolean
  data?: {
    output_path: string
    captions_rendered: number
    graphics_rendered: number
    sfx_rendered: number
    original_duration?: number
    new_duration?: number
    silences_removed?: number
    face_zoom_windows?: number
  }
  error?: string
}

export default function ExportVideoButton({
  videoPath,
  config,
  pipelineResult,
  exportMatches,
  sfxPool,
  sfxAssignments,
  disabled,
}: ExportVideoButtonProps): React.JSX.Element {
  const [isExporting, setIsExporting] = useState(false)
  const [exportPercent, setExportPercent] = useState(0)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const unsubProgressRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      unsubProgressRef.current?.()
      unsubProgressRef.current = null
    }
  }, [])

  const handleExport = useCallback(async () => {
    setError(null)
    setResult(null)

    try {
      const dialogResult = (await window.electron.invoke(
        'dialog:saveVideo'
      )) as DialogResult

      if (dialogResult.canceled || !dialogResult.filePath) return

      setIsExporting(true)
      setExportPercent(0)
      unsubProgressRef.current?.()
      unsubProgressRef.current = window.electron.onExportProgress((p) => {
        setExportPercent((prev) => Math.max(prev, p.percent))
      })

      const exportResult = (await window.electron.invoke('engine:exportFull', {
        videoPath,
        outputPath: dialogResult.filePath,
        segments: pipelineResult.segments,
        matches: exportMatches,
        sfxPool,
        sfxAssignments,
        maxWords: config.maxWords,
        silenceThresholdDb: config.silenceThresholdDb,
        minSilenceDurationMs: config.minSilenceDurationMs,
        paddingMs: config.paddingMs,
        mergeGapMs: config.mergeGapMs,
        minKeepMs: config.minKeepMs,
        attentionLengthMs: config.attentionLengthMs,
        graphicDisplaySec: config.graphicDisplaySec,
        graphicWidthPercent: config.graphicWidthPercent,
        captionFontSize: config.captionFontSize,
        captionFontColor: config.captionFontColor,
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
      })) as ExportResult

      if (exportResult.ok && exportResult.data) {
        setResult(exportResult)
      } else {
        setError(exportResult.error ?? 'Export failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      unsubProgressRef.current?.()
      unsubProgressRef.current = null
      setIsExporting(false)
    }
  }, [videoPath, config, pipelineResult, exportMatches, sfxPool, sfxAssignments])

  return (
    <div className="mx-4 mt-3 space-y-2">
      <button
        onClick={handleExport}
        disabled={disabled || isExporting}
        className={`
          w-full rounded-lg px-6 py-2.5 text-sm font-medium transition-colors
          ${
            disabled || isExporting
              ? 'cursor-not-allowed bg-zinc-800 text-zinc-600'
              : 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700'
          }
        `}
      >
        {isExporting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
            Exporting… {exportPercent}%
          </span>
        ) : (
          'Export Video'
        )}
      </button>

      {isExporting && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-200 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, exportPercent))}%` }}
          />
        </div>
      )}

      {result?.data && (
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 space-y-1">
          <p className="text-xs text-emerald-400 font-medium">Export complete</p>
          <p className="text-xs text-zinc-400">
            Saved to: <span className="text-zinc-300">{result.data.output_path}</span>
          </p>
          {typeof result.data.original_duration === 'number' &&
            typeof result.data.new_duration === 'number' && (
              <p className="text-xs text-zinc-500">
                {result.data.original_duration.toFixed(1)}s → {result.data.new_duration.toFixed(1)}s
                {typeof result.data.silences_removed === 'number' &&
                  ` (${result.data.silences_removed} silences removed)`}
              </p>
            )}
          <p className="text-xs text-zinc-500">
            {result.data.captions_rendered} caption beats, {result.data.graphics_rendered} graphics,{' '}
            {result.data.sfx_rendered} SFX mixed
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
