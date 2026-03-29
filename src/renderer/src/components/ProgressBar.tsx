import type { PipelineProgress } from '../hooks/useProcessPipeline'

type ProgressBarProps = {
  progress: PipelineProgress
}

const STAGE_DOTS = ['Ingest', 'Silence', 'Transcribe', 'Match', 'Polish']

export default function ProgressBar({ progress }: ProgressBarProps): React.JSX.Element {
  const isActive = progress.stage !== 'idle' && progress.stage !== 'done' && progress.stage !== 'error'
  const isDone = progress.stage === 'done'
  const isError = progress.stage === 'error'

  return (
    <div className="mx-4 mt-3 space-y-2">
      {/* Stage dots */}
      <div className="flex items-center gap-1">
        {STAGE_DOTS.map((label, i) => {
          const isCompleted = progress.stageIndex > i || isDone
          const isCurrent = progress.stageIndex === i && isActive
          return (
            <div key={label} className="flex items-center">
              {i > 0 && (
                <div
                  className={`h-px w-4 transition-colors ${
                    isCompleted ? 'bg-emerald-500' : 'bg-zinc-800'
                  }`}
                />
              )}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`h-2 w-2 rounded-full transition-colors ${
                    isCompleted
                      ? 'bg-emerald-500'
                      : isCurrent
                        ? 'bg-blue-500 animate-pulse'
                        : isError && progress.stageIndex === i
                          ? 'bg-red-500'
                          : 'bg-zinc-700'
                  }`}
                />
                <span
                  className={`text-[10px] ${
                    isCurrent ? 'text-blue-400' : isCompleted ? 'text-emerald-500/70' : 'text-zinc-600'
                  }`}
                >
                  {label}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isError ? 'bg-red-500' : isDone ? 'bg-emerald-500' : 'bg-blue-500'
          }`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {/* Message */}
      <p
        className={`text-xs ${
          isError ? 'text-red-400' : isDone ? 'text-emerald-400' : 'text-zinc-400'
        }`}
      >
        {progress.message}
      </p>
    </div>
  )
}
