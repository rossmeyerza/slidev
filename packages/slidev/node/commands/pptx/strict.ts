import type { SlideIr } from './ir'

/** Check before capture. Original bitmap assets are allowed; screenshots are not. */
export function assertNativeExport(slides: SlideIr[], unparsedColors: string[] = [], unplaceablePseudos: string[] = []): void {
  const issues: string[] = []
  for (const slide of slides) {
    const location = `slide ${slide.no}, click ${slide.clickIndex}`
    if (slide.fallbackReason)
      issues.push(`${location}: ${slide.fallbackReason}`)
    for (const node of slide.nodes) {
      if (node.kind === 'raster')
        issues.push(`${location}, element ${node.sourceId}: ${node.reason}`)
    }
  }
  for (const color of unparsedColors)
    issues.push(`unsupported color: ${color}`)
  for (const pseudo of unplaceablePseudos)
    issues.push(`unplaced CSS decoration: ${pseudo}`)
  if (issues.length)
    throw new Error(`[slidev] Strict PPTX export stopped. No file was written.\n${issues.join('\n')}`)
}
