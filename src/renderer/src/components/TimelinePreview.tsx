type TimelineSegment = {
  start: number
  end: number
  text: string
}

type TimelineMatch = {
  graphic: string
  tag: string
  matched_segment_start: number
  similarity: number
}

type TimelineData = {
  video: { filename: string; size_bytes: number; extension: string } | null
  segments: TimelineSegment[]
  matches: TimelineMatch[]
  silenceThresholdMs: number
  events: unknown[]
}

type TimelinePreviewProps = {
  timeline: TimelineData
}

export default function TimelinePreview({ timeline }: TimelinePreviewProps): React.JSX.Element {
  return (
    <div className="m-4 space-y-4 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h3 className="text-sm font-medium text-zinc-300">Pipeline Result (Stub)</h3>

      {/* Segments */}
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Transcript Segments
        </h4>
        {timeline.segments.length === 0 ? (
          <p className="text-xs text-zinc-600">No segments</p>
        ) : (
          <ul className="space-y-1">
            {timeline.segments.map((seg, i) => (
              <li
                key={i}
                className="flex items-baseline gap-2 rounded bg-zinc-800/50 px-3 py-1.5 text-xs"
              >
                <span className="font-mono text-zinc-500">
                  {seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s
                </span>
                <span className="text-zinc-300">{seg.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Matches */}
      {timeline.matches.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Graphic Matches
          </h4>
          <ul className="space-y-1">
            {timeline.matches.map((m, i) => (
              <li
                key={i}
                className="flex items-baseline gap-2 rounded bg-zinc-800/50 px-3 py-1.5 text-xs"
              >
                <span className="font-mono text-zinc-500">@{m.matched_segment_start.toFixed(1)}s</span>
                <span className="text-zinc-300">{m.tag || m.graphic}</span>
                <span className="text-zinc-600">sim={m.similarity.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Config */}
      <div className="flex gap-4 text-xs text-zinc-600">
        <span>Silence threshold: {timeline.silenceThresholdMs}ms</span>
        <span>Events: {timeline.events.length}</span>
      </div>
    </div>
  )
}

export type { TimelineData }
