import type { PipelineConfig } from '../hooks/useProcessPipeline'

type DynamicCroppingPanelProps = {
  config: PipelineConfig
  onChange: (config: PipelineConfig) => void
  disabled: boolean
}

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

export default function DynamicCroppingPanel({
  config,
  onChange,
  disabled,
}: DynamicCroppingPanelProps): React.JSX.Element {
  const update = (key: keyof PipelineConfig, value: number | boolean) => {
    onChange({ ...config, [key]: value })
  }

  return (
    <div className="mx-4 mt-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1">
        Dynamic cropping
      </h3>
      <p className="text-[10px] text-zinc-600 mb-3 leading-relaxed">
        Face-centered zoom pulses on the export timeline (OpenCV sample during process). Does not change
        silence cuts; preview and timeline show planned zoom windows when enabled.
      </p>

      <label className="mb-4 flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
        <input
          type="checkbox"
          checked={config.faceZoomEnabled}
          onChange={(e) => update('faceZoomEnabled', e.target.checked)}
          disabled={disabled}
          className="rounded border-zinc-600"
        />
        Enable face zoom pulses
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="relative group">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400 cursor-help flex items-center gap-1">
              Interval (s)
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
                min={0.5}
                max={15}
                step={0.5}
                value={config.faceZoomIntervalSec}
                onChange={(e) => update('faceZoomIntervalSec', Number(e.target.value))}
                disabled={disabled}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                             focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50"
              />
              <span className="text-[10px] text-zinc-600 shrink-0 w-6">s</span>
            </div>
          </label>
          <Tooltip text="Seconds between face-zoom pulses on the export timeline (when enabled)." />
        </div>

        <div className="relative group">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400 cursor-help flex items-center gap-1">
              Pulse duration
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
                min={0.05}
                max={2}
                step={0.05}
                value={config.faceZoomPulseSec}
                onChange={(e) => update('faceZoomPulseSec', Number(e.target.value))}
                disabled={disabled}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                             focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50"
              />
              <span className="text-[10px] text-zinc-600 shrink-0 w-6">s</span>
            </div>
          </label>
          <Tooltip text="How long each zoom pulse lasts." />
        </div>

        <div className="relative group">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400 cursor-help flex items-center gap-1">
              Zoom amount
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
                min={0}
                max={0.45}
                step={0.02}
                value={config.faceZoomStrength}
                onChange={(e) => update('faceZoomStrength', Number(e.target.value))}
                disabled={disabled}
                className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none
                             focus:ring-1 focus:ring-blue-500/50 disabled:opacity-50"
              />
              <span className="text-[10px] text-zinc-600 shrink-0 w-6"> </span>
            </div>
          </label>
          <Tooltip text="Extra zoom (0.12 ≈ 12% tighter crop). Higher = tighter face frame." />
        </div>
      </div>
    </div>
  )
}
