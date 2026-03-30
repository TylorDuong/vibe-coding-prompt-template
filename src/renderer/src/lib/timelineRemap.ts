/** Map source (uncut) timestamps to the silence-cut output timeline. Mirrors `engine.render.source_time_to_output`. */

export type KeepSegment = { start: number; end: number }

export function parseKeepSegments(raw: unknown): KeepSegment[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: KeepSegment[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const o = item as Record<string, unknown>
    const s = Number(o.start)
    const e = Number(o.end)
    if (Number.isFinite(s) && Number.isFinite(e)) {
      out.push({ start: s, end: e })
    }
  }
  return out
}

export function sourceTimeToOutput(t: number, keepSegments: KeepSegment[]): number {
  let out = 0
  const ordered = [...keepSegments].sort((a, b) => a.start - b.start)
  for (const seg of ordered) {
    const ks = seg.start
    const ke = seg.end
    if (t <= ks) {
      return out
    }
    if (t < ke) {
      return out + (t - ks)
    }
    out += ke - ks
  }
  return out
}
