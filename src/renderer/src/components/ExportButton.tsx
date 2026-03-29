import { useState, useCallback } from 'react'

type ExportButtonProps = {
  videoPath: string
  silenceThresholdMs: number
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
    original_duration: number
    new_duration: number
    silences_removed: number
  }
  error?: string
}

export default function ExportButton({
  videoPath,
  silenceThresholdMs,
  disabled,
}: ExportButtonProps): React.JSX.Element {
  const [isExporting, setIsExporting] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleExport = useCallback(async () => {
    setError(null)
    setResult(null)

    try {
      const dialogResult = (await window.electron.invoke(
        'dialog:saveVideo'
      )) as DialogResult

      if (dialogResult.canceled || !dialogResult.filePath) return

      setIsExporting(true)

      const exportResult = (await window.electron.invoke('engine:export', {
        videoPath,
        outputPath: dialogResult.filePath,
        silenceThresholdMs,
      })) as ExportResult

      if (exportResult.ok && exportResult.data) {
        setResult(exportResult)
      } else {
        setError(exportResult.error ?? 'Export failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }, [videoPath, silenceThresholdMs])

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
            Exporting...
          </span>
        ) : (
          'Export Video (Silence Cut)'
        )}
      </button>

      {result?.data && (
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3 space-y-1">
          <p className="text-xs text-emerald-400 font-medium">Export complete!</p>
          <p className="text-xs text-zinc-400">
            Saved to: <span className="text-zinc-300">{result.data.output_path}</span>
          </p>
          <p className="text-xs text-zinc-500">
            {result.data.original_duration.toFixed(1)}s → {result.data.new_duration.toFixed(1)}s
            ({result.data.silences_removed} silences removed)
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}
