import { describe, it, expect } from 'vitest'
import { buildExportMatches, injectAttentionSfx } from './graphicPlacements'
import type { GraphicItem } from '../components/GraphicsSidebar'

describe('buildExportMatches', () => {
  const graphics: GraphicItem[] = [
    { id: 'g1', filePath: '/a.png', fileName: 'a.png', tag: 'cat' },
    { id: 'g2', filePath: '/b.png', fileName: 'b.png', tag: 'dog' },
  ]

  it('uses manual word trigger over engine match', () => {
    const pipeline = [
      { graphic: '/a.png', tag: 'cat', matched_segment_start: 0, matched_segment_end: 1, matched_text: '', similarity: 0.9 },
      { graphic: '/b.png', tag: 'dog', matched_segment_start: 10, matched_segment_end: 11, matched_text: '', similarity: 0.9 },
    ]
    const manual = {
      g1: { start: 3.5, end: 3.8, word: 'hello' },
    }
    const out = buildExportMatches(graphics, pipeline, manual, 2)
    expect(out[0]).toMatchObject({
      graphic: '/a.png',
      matched_segment_start: 3.5,
      matched_segment_end: 5.5,
      matched_text: 'hello',
      similarity: 1,
    })
    expect(out[1]).toMatchObject({ graphic: '/b.png', matched_segment_start: 10 })
  })
})

describe('injectAttentionSfx', () => {
  it('inserts attention_fill in a long gap', () => {
    const events = [
      { type: 'caption', start: 0, end: 1, text: 'a' },
      { type: 'caption', start: 10, end: 11, text: 'b' },
    ]
    const out = injectAttentionSfx(events, 20, 3000)
    const fills = out.filter((e) => e.type === 'sfx' && e.trigger === 'attention_fill')
    expect(fills.length).toBe(1)
    expect(fills[0]?.start).toBeCloseTo(3, 5)
  })
})
