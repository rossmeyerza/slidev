import type { IrBox, RawStyle } from './ir'
import { parseColor } from './color'

/** Conservative CSS subset. Return undefined rather than approximate unsupported paint. */
export function parseLinearGradient(style: RawStyle): IrBox['gradient'] {
  // CSS positions backgrounds inside borders by default. Until that offset is
  // represented separately, do not stretch the gradient across the border box.
  if ([style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(width => Number.parseFloat(width) > 0))
    return undefined
  if (style.backgroundSize && style.backgroundSize !== 'auto')
    return undefined
  if (style.backgroundPosition && style.backgroundPosition !== '0% 0%')
    return undefined
  if (style.backgroundClip && style.backgroundClip !== 'border-box')
    return undefined
  const match = /^linear-gradient\((.*)\)$/.exec(style.backgroundImage)
  if (!match)
    return undefined
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < match[1].length; i++) {
    const c = match[1][i]
    if (c === '(')
      depth++
    if (c === ')')
      depth--
    if (depth < 0)
      return undefined
    if (c === ',' && depth === 0) {
      parts.push(match[1].slice(start, i).trim())
      start = i + 1
    }
  }
  if (depth !== 0)
    return undefined
  parts.push(match[1].slice(start).trim())
  let angle = 90 // DrawingML: clockwise from right; CSS default points down.
  const directions: Record<string, number> = { 'to right': 0, 'to bottom': 90, 'to left': 180, 'to top': 270 }
  const degrees = /^(-?(?:\d*\.)?\d+)deg$/.exec(parts[0])
  if (degrees)
    angle = ((Number(degrees[1]) - 90) % 360 + 360) % 360
  else if (parts[0] in directions)
    angle = directions[parts[0]]
  if (degrees || parts[0] in directions)
    parts.shift()
  const stops: { offset?: number, color: NonNullable<IrBox['fill']> }[] = []
  for (const part of parts) {
    const stop = /\s(-?(?:\d*\.)?\d+)%$/.exec(part)
    const color = parseColor(stop ? part.slice(0, stop.index).trim() : part)
    if (!color)
      return undefined
    const offset = stop ? Number(stop[1]) / 100 : undefined
    if (offset !== undefined && (offset < 0 || offset > 1))
      return undefined
    stops.push({ offset, color })
  }
  if (stops.length < 2)
    return undefined
  stops[0].offset ??= 0
  stops[stops.length - 1].offset ??= 1
  let previous = 0
  for (const stop of stops) {
    if (stop.offset !== undefined) {
      stop.offset = Math.max(previous, stop.offset)
      previous = stop.offset
    }
  }
  for (let i = 0; i < stops.length - 1;) {
    let end = i + 1
    while (stops[end].offset === undefined)
      end++
    for (let j = i + 1; j < end; j++)
      stops[j].offset = stops[i].offset! + (stops[end].offset! - stops[i].offset!) * (j - i) / (end - i)
    i = end
  }
  return { angle, stops: stops as NonNullable<IrBox['gradient']>['stops'] }
}
