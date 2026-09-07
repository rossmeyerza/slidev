import type { IrBox, RawStyle, Rect, Rgba } from './ir'
import { parseColor } from './color'

type Gradient = NonNullable<IrBox['gradient']>

/** Commas inside color functions do not separate layers or stops. */
export function splitCssList(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(')
      depth++
    if (value[i] === ')')
      depth--
    if (depth < 0)
      return []
    if (value[i] === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  if (depth !== 0)
    return []
  parts.push(value.slice(start).trim())
  return parts
}

function length(value: string, basis: number): number | undefined {
  if (!/^-?(?:\d*\.)?\d+(?:%|px)?$/.test(value))
    return undefined
  const n = Number.parseFloat(value)
  if (value.endsWith('%'))
    return n * basis / 100
  return value.endsWith('px') || n === 0 ? n : undefined
}

function stopsOf(parts: string[], basis: number): Gradient['stops'] | undefined {
  const stops: { offset?: number, color: Rgba }[] = []
  for (const part of parts) {
    const end = part.lastIndexOf(')')
    const colorEnd = end >= 0 ? end + 1 : !part.includes(' ') ? part.length : part.indexOf(' ')
    const color = parseColor(part.slice(0, colorEnd))
    if (!color)
      return undefined
    const positions = part.slice(colorEnd).trim().split(/\s+/).filter(Boolean)
    if (positions.length > 2)
      return undefined
    if (!positions.length)
      stops.push({ color })
    for (const position of positions) {
      const px = length(position, basis)
      if (px === undefined || px < 0 || px > basis)
        return undefined
      stops.push({ color, offset: position.endsWith('%') ? Number.parseFloat(position) / 100 : px / basis })
    }
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
  return stops as Gradient['stops']
}

function linear(parts: string[], box: Pick<Rect, 'w' | 'h'>): Gradient | undefined {
  let angle = 90
  const directions: Record<string, number> = { 'to right': 0, 'to bottom': 90, 'to left': 180, 'to top': 270 }
  const degrees = /^(-?(?:\d*\.)?\d+)deg$/.exec(parts[0])
  if (degrees)
    angle = Number(degrees[1]) - 90
  else if (parts[0] in directions)
    angle = directions[parts[0]]
  else if (/^to (?:top|bottom) (?:left|right)$|^to (?:left|right) (?:top|bottom)$/.test(parts[0]))
    angle = Math.atan2(parts[0].includes('top') ? -box.w : box.w, parts[0].includes('left') ? -box.h : box.h) * 180 / Math.PI
  else if (parts[0].startsWith('to '))
    return undefined
  if (degrees || parts[0].startsWith('to '))
    parts.shift()
  angle = (angle % 360 + 360) % 360
  const radians = angle * Math.PI / 180
  const basis = Math.abs(Math.cos(radians)) * box.w + Math.abs(Math.sin(radians)) * box.h
  const stops = stopsOf(parts, basis)
  return stops ? { angle, stops } : undefined
}

function radial(parts: string[], box: Pick<Rect, 'w' | 'h'>): Gradient | undefined {
  let prefix = ''
  if (!parseColor(`${parts[0].split(')')[0]})`) && !parts[0].startsWith('transparent'))
    prefix = parts.shift()!
  const [sizeText, positionText] = prefix.split(/\s*\bat\b\s*/)
  let position = positionText?.trim().split(/\s+/) ?? ['50%', '50%']
  const keywords: Record<string, string> = { left: '0%', right: '100%', top: '0%', bottom: '100%', center: '50%' }
  if (position.length === 1)
    position = ['top', 'bottom'].includes(position[0]) ? ['center', position[0]] : [position[0], 'center']
  if (['top', 'bottom'].includes(position[0]) || ['left', 'right'].includes(position[1]))
    position.reverse()
  if (position.length !== 2)
    return undefined
  const cx = length(keywords[position[0]] ?? position[0], box.w)
  const cy = length(keywords[position[1]] ?? position[1], box.h)
  if (cx === undefined || cy === undefined || cx < 0 || cy < 0 || cx > box.w || cy > box.h)
    return undefined
  const tokens = sizeText.trim().split(/\s+/).filter(Boolean)
  const circle = tokens.includes('circle') || (!tokens.includes('ellipse') && tokens.length === 1 && tokens[0].endsWith('px'))
  const sizing = tokens.filter(token => token !== 'circle' && token !== 'ellipse')
  let rx: number | undefined
  let ry: number | undefined
  if (!sizing.length || /^(?:closest|farthest)-(?:side|corner)$/.test(sizing[0])) {
    if (sizing.length > 1)
      return undefined
    const mode = sizing[0] ?? 'farthest-corner'
    const choose = mode.startsWith('closest') ? Math.min : Math.max
    const x = choose(cx, box.w - cx)
    const y = choose(cy, box.h - cy)
    if (circle) {
      rx = ry = mode.endsWith('corner') ? Math.hypot(x, y) : choose(x, y)
    }
    else {
      rx = x * (mode.endsWith('corner') ? Math.SQRT2 : 1)
      ry = y * (mode.endsWith('corner') ? Math.SQRT2 : 1)
    }
  }
  else if (circle && sizing.length === 1 && !sizing[0].endsWith('%')) {
    rx = ry = length(sizing[0], box.w)
  }
  else if (!circle && sizing.length === 2) {
    rx = length(sizing[0], box.w)
    ry = length(sizing[1], box.h)
  }
  if (!rx || !ry || rx <= 0 || ry <= 0)
    return undefined
  // Office/LibreOffice do not preserve an elliptical radial fill when its
  // containing group is stretched. Keep this explicit until it is interoperable.
  if (Math.abs(rx - ry) > 0.000001)
    return undefined
  const stops = stopsOf(parts, rx)
  return stops ? { angle: 0, radial: { cx, cy, rx, ry }, stops } : undefined
}

/** Return every layer or none. CSS lists the top layer first. */
export function parseGradients(style: RawStyle, box: Pick<Rect, 'w' | 'h'>): Gradient[] | undefined {
  if (!(box.w > 0 && box.h > 0))
    return undefined
  if ([style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(width => Number.parseFloat(width) > 0))
    return undefined
  for (const [value, allowed] of [
    [style.backgroundSize, ['auto', 'auto auto']],
    [style.backgroundPosition, ['0% 0%']],
    [style.backgroundClip, ['border-box']],
    [style.backgroundBlendMode, ['normal']],
    [style.backgroundAttachment, ['scroll']],
  ] as const) {
    if (value && splitCssList(value).some(part => !allowed.includes(part as never)))
      return undefined
  }
  const layers = splitCssList(style.backgroundImage)
  if (!layers.length || layers.length > 32)
    return undefined
  const gradients: Gradient[] = []
  for (const layer of layers) {
    const match = /^(linear|radial)-gradient\((.*)\)$/.exec(layer)
    if (!match)
      return undefined
    const parts = splitCssList(match[2])
    if (parts.length < 2)
      return undefined
    const gradient = match[1] === 'linear' ? linear(parts, box) : radial(parts, box)
    if (!gradient)
      return undefined
    gradients.push(gradient)
  }
  return gradients
}

/** Compatibility helper for a single linear fill. */
export function parseLinearGradient(style: RawStyle): Gradient | undefined {
  const layers = parseGradients(style, { w: 100, h: 100 })
  return layers?.length === 1 && !layers[0].radial ? layers[0] : undefined
}

/**
 * CSS interpolates premultiplied alpha. Extra native stops approximate that
 * curve and avoid Office's special gamma rule for two- and three-stop fills.
 */
export function drawingStops(stops: Gradient['stops']): Gradient['stops'] {
  const result: Gradient['stops'] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i]
    const end = stops[i + 1]
    const steps = start.offset === end.offset ? 1 : 16
    for (let j = 0; j <= steps; j++) {
      const t = j / steps
      const a = start.color.a * (1 - t) + end.color.a * t
      const channel = (key: 'r' | 'g' | 'b') => a > 0
        ? (start.color[key] * start.color.a * (1 - t) + end.color[key] * end.color.a * t) / a
        : (t === 0 ? end.color[key] : start.color[key])
      result.push({ offset: start.offset + (end.offset - start.offset) * t, color: { r: channel('r'), g: channel('g'), b: channel('b'), a } })
    }
  }
  return result
}
