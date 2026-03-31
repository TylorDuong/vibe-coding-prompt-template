import { describe, expect, it } from 'vitest'
import { absPathToLocalFileUrl } from './localFileUrl'

describe('absPathToLocalFileUrl', () => {
  it('encodes Windows path as pathname segments', () => {
    expect(absPathToLocalFileUrl('C:\\Users\\me\\preview.mp4')).toBe(
      'local-file:///C%3A/Users/me/preview.mp4',
    )
  })

  it('encodes spaces per segment', () => {
    expect(absPathToLocalFileUrl('C:\\Temp\\my file.mp4')).toBe(
      'local-file:///C%3A/Temp/my%20file.mp4',
    )
  })

  it('handles unix-style paths', () => {
    expect(absPathToLocalFileUrl('/home/user/clips/a.mp4')).toBe(
      'local-file:///home/user/clips/a.mp4',
    )
  })
})
