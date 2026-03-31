/** Reference export width (px) used to map captionFontSize to container-query width units. */
export const CAPTION_PREVIEW_REF_WIDTH_PX = 720

export function captionFontSizeCqw(
  captionFontSize: number,
  refWidthPx: number = CAPTION_PREVIEW_REF_WIDTH_PX,
): number {
  return (captionFontSize / refWidthPx) * 100
}

export function captionOutlineShadowCqw(
  borderWidth: number,
  outlineColor: string,
  refWidthPx: number = CAPTION_PREVIEW_REF_WIDTH_PX,
): string | undefined {
  if (borderWidth <= 0) return undefined
  const u = (borderWidth / refWidthPx) * 100
  return `${u}cqw 0 0 ${outlineColor}, -${u}cqw 0 0 ${outlineColor}, 0 ${u}cqw 0 ${outlineColor}, 0 -${u}cqw 0 ${outlineColor}`
}

/** fontSize CSS value aligned with export drawtext fontsize vs frame width. */
export function captionPreviewFontSizeCss(
  captionFontSize: number,
  refWidthPx: number = CAPTION_PREVIEW_REF_WIDTH_PX,
): string {
  const cqw = captionFontSizeCqw(captionFontSize, refWidthPx)
  return `clamp(0.5rem, ${cqw}cqw, 2.75rem)`
}
