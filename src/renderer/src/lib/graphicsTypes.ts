export type GraphicKind = 'image' | 'video'

export type GraphicItem = {
  id: string
  filePath: string
  fileName: string
  tag: string
  kind: GraphicKind
}
