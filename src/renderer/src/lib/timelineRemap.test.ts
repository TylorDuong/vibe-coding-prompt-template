import { describe, expect, it } from 'vitest'
import { parseKeepSegments, sourceTimeToOutput } from './timelineRemap'

describe('sourceTimeToOutput', () => {
  it('maps through a removed gap', () => {
    const keep = [
      { start: 0, end: 2 },
      { start: 5, end: 8 },
    ]
    expect(sourceTimeToOutput(1, keep)).toBe(1)
    expect(sourceTimeToOutput(5, keep)).toBe(2)
    expect(sourceTimeToOutput(6, keep)).toBe(3)
  })

  it('handles single kept span', () => {
    expect(sourceTimeToOutput(2.5, [{ start: 0, end: 10 }])).toBe(2.5)
  })
})

describe('parseKeepSegments', () => {
  it('parses valid array', () => {
    expect(parseKeepSegments([{ start: 0, end: 1 }])).toEqual([{ start: 0, end: 1 }])
  })

  it('returns empty for invalid input', () => {
    expect(parseKeepSegments(null)).toEqual([])
  })
})
