import type { PipelineConfig } from '../hooks/useProcessPipeline'

type ConfigPanelProps = {
  config: PipelineConfig
  onChange: (config: PipelineConfig) => void
  disabled: boolean
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

const PARAMS: ParamDef[] = [
  {
    key: 'silenceThresholdDb',
    label: 'Silence dB',
    tooltip: 'Audio level (in decibels) below which sound is considered silence. Lower values (e.g. -50) are less aggressive and preserve softer speech. Higher values (e.g. -25) cut more aggressively.',
    min: -60,
    max: -10,
    step: 5,
    unit: 'dB',
  },
  {
    key: 'minSilenceDurationMs',
    label: 'Min silence',
    tooltip: 'Minimum duration of a quiet gap before it counts as a "silence" to cut. Higher values only cut longer pauses, preserving natural rhythm. Lower values cut shorter pauses for faster pacing.',
    min: 200,
    max: 3000,
    step: 100,
    unit: 'ms',
  },
  {
    key: 'paddingMs',
    label: 'Padding',
    tooltip: 'Extra time added to the start and end of each kept segment. Prevents clipping the beginning/end of words. Increase if words sound cut off.',
    min: 0,
    max: 500,
    step: 25,
    unit: 'ms',
  },
  {
    key: 'mergeGapMs',
    label: 'Merge gap',
    tooltip: 'If two speech segments are closer than this gap, they are merged into one continuous block. Prevents choppy rapid cuts between nearby words.',
    min: 0,
    max: 1000,
    step: 50,
    unit: 'ms',
  },
  {
    key: 'minKeepMs',
    label: 'Min keep',
    tooltip: 'Segments shorter than this duration are discarded. Filters out noise blips and partial sounds that aren\'t meaningful speech.',
    min: 0,
    max: 500,
    step: 25,
    unit: 'ms',
  },
  {
    key: 'maxWords',
    label: 'Max words',
    tooltip: 'Maximum number of caption words shown on screen at once. Lower values (2-3) create faster-paced TikTok-style captions. Higher values (5-8) show more context per frame.',
    min: 1,
    max: 12,
    step: 1,
    unit: '',
  },
  {
    key: 'attentionLengthMs',
    label: 'Attention length',
    tooltip: 'Maximum time before a visual or audio stimulus (SFX) is inserted to maintain viewer engagement. Based on short-form content retention research.',
    min: 1000,
    max: 10000,
    step: 500,
    unit: 'ms',
  },
  {
    key: 'graphicDisplaySec',
    label: 'Graphic length',
    tooltip: 'Maximum time each matched graphic stays on screen in the full export. Shorter values keep overlays punchy; longer values hold the image through more of the matched speech.',
    min: 0.5,
    max: 30,
    step: 0.5,
    unit: 's',
  },
]

function Tooltip({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56
                    rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-zinc-300
                    opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
    </div>
  )
}

export default function ConfigPanel({ config, onChange, disabled }: ConfigPanelProps): React.JSX.Element {
  const update = (key: keyof PipelineConfig, value: number) => {
    onChange({ ...config, [key]: value })
  }

  return (
    <div className="mx-4 mt-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-3">
        Processing Parameters
      </h3>
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        {PARAMS.map((param) => (
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
                  value={config[param.key]}
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
  )
}
