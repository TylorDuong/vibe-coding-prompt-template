import type { OutputAspectRatio, PipelineConfig } from '../hooks/useProcessPipeline'
import { parsePipelinePresetJson, serializePipelinePreset } from '../lib/pipelineConfigPreset'

type OpenPresetResult =
  | { canceled: true }
  | { canceled: false; filePath: string; content: string }
  | { canceled: false; error: string }

type SavePresetResult =
  | { canceled: true }
  | { canceled: false; filePath: string }
  | { canceled: false; error: string }

function captionPreviewShadow(outlinePx: number, outlineColor: string): string | undefined {
  if (outlinePx <= 0) return undefined
  const c = outlineColor
  return `${outlinePx}px 0 0 ${c}, -${outlinePx}px 0 0 ${c}, 0 ${outlinePx}px 0 ${c}, 0 -${outlinePx}px 0 ${c}`
}

function CaptionStylePreview({ config }: { config: PipelineConfig }): React.JSX.Element {
  const outline = Math.max(0, config.captionBorderWidth)
  const fs = Math.min(Math.max(10, config.captionFontSize * 0.32), 26)
  const isCenter = config.captionPosition === 'center'
  const shadow = captionPreviewShadow(outline, config.captionOutlineColor)

  const frame = (bgClass: string, bgStyle: React.CSSProperties | undefined, label: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[9px] text-zinc-500">{label}</span>
      <div
        className={`relative aspect-video w-full overflow-hidden rounded-md border border-zinc-700 ${bgClass}`}
        style={bgStyle}
      >
        <div
          className={`absolute inset-x-0 flex justify-center px-1 ${
            isCenter ? 'top-1/2 -translate-y-1/2' : 'bottom-2'
          }`}
        >
          <span
            className="inline-block text-center leading-tight"
            style={{
              fontSize: fs,
              color: config.captionFontColor,
              fontWeight: config.captionBold ? 700 : 400,
              textShadow: shadow,
              backgroundColor: config.captionBox ? 'rgba(0,0,0,0.55)' : undefined,
              padding: config.captionBox ? '3px 8px' : undefined,
              borderRadius: config.captionBox ? 6 : undefined,
            }}
          >
            Sample caption text
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[10px] text-zinc-600">
        Caption preview (approximate; export uses FFmpeg)
      </p>
      <div className="flex flex-wrap gap-2">
        {frame('bg-white', undefined, 'White')}
        {frame('', { backgroundColor: '#a1a1aa' }, 'Grey')}
        {frame('bg-black', undefined, 'Black')}
      </div>
    </div>
  )
}

type ConfigPanelProps = {
  config: PipelineConfig
  onChange: (config: PipelineConfig) => void
  /** Defaults used when merging imported JSON (missing keys). */
  defaultConfig: PipelineConfig
  disabled: boolean
  onPresetSuccess?: (message: string) => void
  onPresetError?: (message: string) => void
}

type ParamDef = {
  key: keyof PipelineConfig
  label: string
  tooltip: string
  min: number
  max: number
  step: number
  unit: string
}

const SILENCE_PARAMS: ParamDef[] = [
  {
    key: 'silenceThresholdDb',
    label: 'Silence dB',
    tooltip:
      'Audio level (in decibels) below which sound is considered silence. Lower values (e.g. -50) are less aggressive and preserve softer speech. Higher values (e.g. -25) cut more aggressively.',
    min: -60,
    max: -10,
    step: 5,
    unit: 'dB',
  },
  {
    key: 'minSilenceDurationMs',
    label: 'Min silence',
    tooltip:
      'Minimum duration of a quiet gap before it counts as a "silence" to cut. Higher values only cut longer pauses, preserving natural rhythm. Lower values cut shorter pauses for faster pacing.',
    min: 200,
    max: 3000,
    step: 100,
    unit: 'ms',
  },
  {
    key: 'paddingMs',
    label: 'Padding',
    tooltip:
      'Extra time added to the start and end of each kept segment. Prevents clipping the beginning/end of words. Increase if words sound cut off.',
    min: 0,
    max: 500,
    step: 25,
    unit: 'ms',
  },
  {
    key: 'mergeGapMs',
    label: 'Merge gap',
    tooltip:
      'If two speech segments are closer than this gap, they are merged into one continuous block. Prevents choppy rapid cuts between nearby words.',
    min: 0,
    max: 1000,
    step: 50,
    unit: 'ms',
  },
  {
    key: 'minKeepMs',
    label: 'Min keep',
    tooltip:
      "Segments shorter than this duration are discarded. Filters out noise blips and partial sounds that aren't meaningful speech.",
    min: 0,
    max: 500,
    step: 25,
    unit: 'ms',
  },
]

const CAPTION_NUM_PARAMS: ParamDef[] = [
  {
    key: 'maxWords',
    label: 'Max words per caption',
    tooltip:
      'Maximum number of caption words shown on screen at once. Lower values (2-3) create faster-paced TikTok-style captions. Higher values (5-8) show more context per frame.',
    min: 1,
    max: 12,
    step: 1,
    unit: '',
  },
  {
    key: 'attentionLengthMs',
    label: 'Attention length',
    tooltip:
      'Maximum time before a visual or audio stimulus (SFX) is inserted to maintain viewer engagement. Based on short-form content retention research.',
    min: 1000,
    max: 10000,
    step: 500,
    unit: 'ms',
  },
  {
    key: 'captionFontSize',
    label: 'Caption size',
    tooltip: 'Drawtext font size in the exported video.',
    min: 16,
    max: 96,
    step: 2,
    unit: 'px',
  },
  {
    key: 'captionBorderWidth',
    label: 'Caption outline',
    tooltip: 'Outline thickness around caption text (0 = no outline).',
    min: 0,
    max: 8,
    step: 1,
    unit: '',
  },
  {
    key: 'captionFadeInSec',
    label: 'Cap. fade in',
    tooltip: 'Seconds to fade each caption line in (0 = instant).',
    min: 0,
    max: 2,
    step: 0.05,
    unit: 's',
  },
  {
    key: 'captionFadeOutSec',
    label: 'Cap. fade out',
    tooltip: 'Seconds to fade each caption line out before the next.',
    min: 0,
    max: 2,
    step: 0.05,
    unit: 's',
  },
  {
    key: 'sfxCaptionEveryN',
    label: 'SFX / caption',
    tooltip: 'Play caption-triggered SFX on every Nth caption line (1 = every line).',
    min: 1,
    max: 10,
    step: 1,
    unit: '',
  },
  {
    key: 'sfxGraphicEveryN',
    label: 'SFX / graphic',
    tooltip: 'Play graphic-triggered SFX on every Nth graphic (1 = every graphic).',
    min: 1,
    max: 10,
    step: 1,
    unit: '',
  },
  {
    key: 'faceZoomIntervalSec',
    label: 'Face zoom int.',
    tooltip: 'Seconds between face-zoom pulses on the export timeline (when enabled).',
    min: 0.5,
    max: 15,
    step: 0.5,
    unit: 's',
  },
  {
    key: 'faceZoomPulseSec',
    label: 'Face zoom dur.',
    tooltip: 'How long each zoom pulse lasts.',
    min: 0.05,
    max: 2,
    step: 0.05,
    unit: 's',
  },
  {
    key: 'faceZoomStrength',
    label: 'Face zoom amt.',
    tooltip: 'Extra zoom amount (0.12 ≈ 12% crop). Higher = tighter face frame.',
    min: 0,
    max: 0.45,
    step: 0.02,
    unit: '',
  },
]

const ASPECT_OPTIONS: { value: OutputAspectRatio; label: string }[] = [
  { value: 'original', label: 'Original (no crop)' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
]

function Tooltip({ text }: { text: string }): React.JSX.Element {
  return (
    <div
      className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56
                    rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-zinc-300
                    opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg"
    >
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
    </div>
  )
}

function ParamGrid({
  params,
  config,
  disabled,
  update,
}: {
  params: ParamDef[]
  config: PipelineConfig
  disabled: boolean
  update: (key: keyof PipelineConfig, value: number | string | boolean) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-3">
      {params.map((param) => (
        <div key={param.key} className="relative group">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400 cursor-help flex items-center gap-1">
              {param.label}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-zinc-600"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={param.min}
                max={param.max}
                step={param.step}
                value={config[param.key] as number}
                onChange={(e) => update(param.key, Number(e.target.value))}
                disabled={disabled}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                             focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50"
              />
              <span className="text-[10px] text-zinc-600 shrink-0 w-6">{param.unit}</span>
            </div>
          </label>
          <Tooltip text={param.tooltip} />
        </div>
      ))}
    </div>
  )
}

export default function ConfigPanel({
  config,
  onChange,
  defaultConfig,
  disabled,
  onPresetSuccess,
  onPresetError,
}: ConfigPanelProps): React.JSX.Element {
  const update = (key: keyof PipelineConfig, value: number | string | boolean) => {
    onChange({ ...config, [key]: value })
  }

  const handleImportPreset = async (): Promise<void> => {
    try {
      const raw = (await window.electron.invoke(
        'dialog:openConfigPreset',
      )) as OpenPresetResult
      if (raw.canceled) {
        return
      }
      if ('error' in raw && raw.error) {
        onPresetError?.(raw.error)
        return
      }
      if (!('content' in raw) || typeof raw.content !== 'string') {
        onPresetError?.('Could not read preset file.')
        return
      }
      const parsed = parsePipelinePresetJson(raw.content, defaultConfig)
      if (!parsed.ok) {
        onPresetError?.(parsed.error)
        return
      }
      onChange(parsed.config)
      onPresetSuccess?.('Imported settings from JSON.')
    } catch (err) {
      onPresetError?.(err instanceof Error ? err.message : 'Import failed.')
    }
  }

  const handleExportPreset = async (): Promise<void> => {
    try {
      const body = serializePipelinePreset(config, 'splitty-ai v0.2.0')
      const raw = (await window.electron.invoke('dialog:saveConfigPreset', {
        content: body,
      })) as SavePresetResult
      if (raw.canceled) {
        return
      }
      if ('error' in raw && raw.error) {
        onPresetError?.(raw.error)
        return
      }
      if ('filePath' in raw) {
        onPresetSuccess?.(`Saved settings to ${raw.filePath}`)
      }
    } catch (err) {
      onPresetError?.(err instanceof Error ? err.message : 'Export failed.')
    }
  }

  return (
    <div className="mx-4 mt-3 space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-zinc-800">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Settings preset
          </span>
          <button
            type="button"
            onClick={() => void handleImportPreset()}
            disabled={disabled}
            className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700
                       disabled:opacity-40 disabled:pointer-events-none"
          >
            Import JSON…
          </button>
          <button
            type="button"
            onClick={() => void handleExportPreset()}
            disabled={disabled}
            className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700
                       disabled:opacity-40 disabled:pointer-events-none"
          >
            Export JSON…
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 leading-relaxed mb-3">
          Preset files use <span className="text-zinc-500">splittyPresetVersion: 1</span> and a{' '}
          <span className="text-zinc-500">pipelineConfig</span> object. When you add or rename any
          processing or export field, update{' '}
          <span className="text-zinc-500 font-mono">src/renderer/src/lib/pipelineConfigPreset.ts</span>,{' '}
          <span className="text-zinc-500 font-mono">engine/main.py</span> (exportFull),{' '}
          <span className="text-zinc-500 font-mono">src/main/ipcHandlers.ts</span>, and the maintenance
          section in <span className="text-zinc-500 font-mono">OVERLAY-TEST-CHECKLIST.md</span>.
        </p>

        <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
          Silence removal
        </h3>
        <ParamGrid params={SILENCE_PARAMS} config={config} disabled={disabled} update={update} />

        <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3 mt-5">
          Processing parameters
        </h3>
        <p className="text-[10px] text-zinc-600 mb-3">
          Video ratio and speed apply on <span className="text-zinc-500">Export Video</span> (center crop
          and tempo).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Video ratio (export)
            <select
              value={config.outputAspectRatio}
              onChange={(e) =>
                update('outputAspectRatio', e.target.value as OutputAspectRatio)
              }
              disabled={disabled}
              className="rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none disabled:opacity-50"
            >
              {ASPECT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="relative group">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400 cursor-help flex items-center gap-1">
                Video speed (×)
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-zinc-600"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0.25}
                  max={4}
                  step={0.05}
                  value={config.videoSpeed}
                  onChange={(e) => update('videoSpeed', Number(e.target.value))}
                  disabled={disabled}
                  className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                           focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50"
                />
                <span className="text-[10px] text-zinc-600 shrink-0">×</span>
              </div>
            </label>
            <Tooltip text="Playback speed multiplier for the exported file (1 = normal; 2 = double speed; 0.5 = half)." />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
          Caption and export
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Caption color
            <input
              type="color"
              value={config.captionFontColor}
              onChange={(e) => update('captionFontColor', e.target.value)}
              disabled={disabled}
              className="h-8 w-full rounded border border-zinc-700 bg-zinc-800 disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Outline color
            <input
              type="color"
              value={config.captionOutlineColor}
              onChange={(e) => update('captionOutlineColor', e.target.value)}
              disabled={disabled}
              className="h-8 w-full rounded border border-zinc-700 bg-zinc-800 disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-400">
            Caption position
            <select
              value={config.captionPosition}
              onChange={(e) =>
                update('captionPosition', e.target.value as PipelineConfig['captionPosition'])
              }
              disabled={disabled}
              className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none disabled:opacity-50"
            >
              <option value="bottom">Bottom</option>
              <option value="center">Center</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-4 mb-3 text-xs">
          <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={config.captionBold}
              onChange={(e) => update('captionBold', e.target.checked)}
              disabled={disabled}
              className="rounded border-zinc-600"
            />
            Bold captions
          </label>
          <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={config.captionBox}
              onChange={(e) => update('captionBox', e.target.checked)}
              disabled={disabled}
              className="rounded border-zinc-600"
            />
            Caption background
          </label>
          <label className="flex items-center gap-2 text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={config.faceZoomEnabled}
              onChange={(e) => update('faceZoomEnabled', e.target.checked)}
              disabled={disabled}
              className="rounded border-zinc-600"
            />
            Face zoom pulses
          </label>
        </div>

        <CaptionStylePreview config={config} />

        <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3">
          {CAPTION_NUM_PARAMS.map((param) => (
            <div key={param.key} className="relative group">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400 cursor-help flex items-center gap-1">
                  {param.label}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-zinc-600"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={config[param.key] as number}
                    onChange={(e) => update(param.key, Number(e.target.value))}
                    disabled={disabled}
                    className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                             focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50"
                  />
                  <span className="text-[10px] text-zinc-600 shrink-0 w-6">{param.unit}</span>
                </div>
              </label>
              <Tooltip text={param.tooltip} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
