import type { RawSnapshot, RawStyle } from './ir'

/** Uniform positive 2D scale and translation. Rotation, skew and perspective need other geometry. */
export function nativeScale(style: RawStyle): number | undefined {
  let scale = 1
  if (style.rotate && !['none', '0deg', '0rad', '0turn'].includes(style.rotate))
    return undefined
  if (style.scale && style.scale !== 'none') {
    const values = style.scale.split(/\s+/).map(value => Number.parseFloat(value) / (value.endsWith('%') ? 100 : 1))
    if (values.length > 2 || (values.length === 2 && values[0] !== values[1]))
      return undefined
    scale *= values[0]
  }
  if (style.zoom && style.zoom !== 'normal')
    scale *= Number.parseFloat(style.zoom) / (style.zoom.endsWith('%') ? 100 : 1)
  if (style.transform && style.transform !== 'none') {
    const match = /^matrix\(([^)]+)\)$/.exec(style.transform)
    if (!match)
      return undefined
    const values = match[1].split(',').map(Number)
    if (values.length !== 6 || !values.every(Number.isFinite))
      return undefined
    const [a, b, c, d] = values
    if (b !== 0 || c !== 0 || a !== d || a <= 0)
      return undefined
    scale *= a
  }
  return Number.isFinite(scale) && scale > 0 ? scale : undefined
}

/** Geometry is already measured in screen pixels. Scale style lengths once, not the rectangles. */
export function scaleSnapshot(snapshot: RawSnapshot): RawSnapshot {
  const styles = [...snapshot.styles]
  const cache = new Map<string, number>()
  const slides = snapshot.slides.map((slide) => {
    const scales = new Map<number, number>()
    const byId = new Map(slide.nodes.map(node => [node.id, node]))
    const nodes = slide.nodes.map((node) => {
      const parentScale = scales.get(node.parent) ?? 1
      const original = snapshot.styles[node.style]
      const scale = parentScale * (original ? nativeScale(original) ?? 1 : 1)
      scales.set(node.id, scale)
      if (!original || scale === 1)
        return node
      const key = `${node.style}:${scale}`
      let index = cache.get(key)
      if (index === undefined) {
        const scaled = { ...original }
        for (const key of [
          'fontSize',
          'lineHeight',
          'letterSpacing',
          'paddingLeft',
          'paddingRight',
          'borderTopWidth',
          'borderRightWidth',
          'borderBottomWidth',
          'borderLeftWidth',
          'borderTopLeftRadius',
          'boxShadow',
          'backgroundImage',
          'width',
          'height',
        ] as const) {
          scaled[key] = original[key]?.replace(/(-?(?:\d*\.)?\d+)px/g, (_, number: string) => `${Number(number) * scale}px`)
        }
        index = styles.length
        styles.push(scaled)
        cache.set(key, index)
      }
      const copy = { ...node, style: index }
      if (node.tag === '::BEFORE' || node.tag === '::AFTER') {
        const parent = byId.get(node.parent)!
        const px = (value: string) => (Number.parseFloat(value) || 0) * scale
        copy.rect = {
          x: parent.rect.x + (original.left === 'auto' ? parent.rect.w - px(original.right) - node.rect.w * scale : px(original.left)),
          y: parent.rect.y + (original.top === 'auto' ? parent.rect.h - px(original.bottom) - node.rect.h * scale : px(original.top)),
          w: node.rect.w * scale,
          h: node.rect.h * scale,
        }
        if (node.pageRect) {
          copy.pageRect = {
            x: node.pageRect.x + copy.rect.x - node.rect.x,
            y: node.pageRect.y + copy.rect.y - node.rect.y,
            w: copy.rect.w,
            h: copy.rect.h,
          }
        }
      }
      return copy
    })
    return { ...slide, nodes }
  })
  return { ...snapshot, slides, styles }
}
