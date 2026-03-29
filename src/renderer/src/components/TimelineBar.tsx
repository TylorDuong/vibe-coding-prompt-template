type TimelineEvent = {
  type: string
  start: number
  end?: number
}

type TimelineBarProps = {
  events: TimelineEvent[]
  duration: number
}

const COLOR_MAP: Record<string, string> = {
  caption: 'bg-blue-500',
  graphic: 'bg-emerald-500',
  sfx: 'bg-amber-500',
  silence_cut: 'bg-red-500/60',
}

export default function TimelineBar({ events, duration }: TimelineBarProps): React.JSX.Element {
  if (duration <= 0) return <></>

  return (
    <div className="mx-4 mt-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-zinc-600">0s</span>
        <span className="text-[10px] text-zinc-600">{duration.toFixed(1)}s</span>
      </div>

      <div className="relative h-8 w-full rounded bg-zinc-800 overflow-hidden">
        {/* Silence cut regions shown as background spans */}
        {events
          .filter((e) => e.type === 'silence_cut' && e.end != null)
          .map((e, i) => {
            const left = (e.start / duration) * 100
            const width = (((e.end ?? e.start) - e.start) / duration) * 100
            return (
              <div
                key={`sil-${i}`}
                className="absolute top-0 h-full bg-red-900/30"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`Silence: ${e.start.toFixed(1)}s–${(e.end ?? e.start).toFixed(1)}s`}
              />
            )
          })}

        {/* Point events as markers */}
        {events
          .filter((e) => e.type !== 'silence_cut')
          .map((e, i) => {
            const left = (e.start / duration) * 100
            const color = COLOR_MAP[e.type] ?? 'bg-zinc-500'
            return (
              <div
                key={`evt-${i}`}
                className={`absolute top-1 h-6 w-1 rounded-sm ${color}`}
                style={{ left: `${Math.min(left, 99)}%` }}
                title={`${e.type} @ ${e.start.toFixed(1)}s`}
              />
            )
          })}
      </div>

      {/* Legend */}
      <div className="flex gap-3 mt-1.5">
        {Object.entries(COLOR_MAP).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className={`h-2 w-2 rounded-sm ${color}`} />
            <span className="text-[10px] text-zinc-500">{type.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
