import type { IrPath, PathCommand, RawNode } from './ir'
import { parseColor, withOpacity } from './color'

/** Parse path geometry without sampling curves into pixels. Unsupported arcs fail explicitly. */
export function parseSvgPath(data: string): PathCommand[] | undefined {
  const tokens = data.match(/[a-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? []
  if (data.replace(/[a-z\s,]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi, ''))
    return undefined
  const result: PathCommand[] = []
  let i = 0
  let command = ''
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let previous: PathCommand | undefined
  try {
    const number = () => {
      const n = Number(tokens[i++])
      if (!Number.isFinite(n))
        throw new Error('Invalid SVG coordinate')
      return n
    }
    while (i < tokens.length) {
      if (/^[a-z]$/i.test(tokens[i]))
        command = tokens[i++]
      const op = command.toUpperCase()
      const relative = command !== op
      const px = () => number() + (relative ? x : 0)
      const py = () => number() + (relative ? y : 0)
      let next: PathCommand
      switch (op) {
        case 'M':
        case 'L':
          next = { op, x: px(), y: py() }
          break
        case 'H':
          next = { op: 'L', x: px(), y }
          break
        case 'V':
          next = { op: 'L', x, y: py() }
          break
        case 'C':
          next = { op: 'C', x1: px(), y1: py(), x2: px(), y2: py(), x: px(), y: py() }
          break
        case 'S':
          next = { op: 'C', x1: previous?.op === 'C' ? 2 * x - previous.x2 : x, y1: previous?.op === 'C' ? 2 * y - previous.y2 : y, x2: px(), y2: py(), x: px(), y: py() }
          break
        case 'Q':
          next = { op: 'Q', x1: px(), y1: py(), x: px(), y: py() }
          break
        case 'T':
          next = { op: 'Q', x1: previous?.op === 'Q' ? 2 * x - previous.x1 : x, y1: previous?.op === 'Q' ? 2 * y - previous.y1 : y, x: px(), y: py() }
          break
        case 'Z':
          next = { op: 'Z' }
          x = startX
          y = startY
          command = ''
          break
        default: return undefined
      }
      if (!result.length && op !== 'M')
        return undefined
      if (next.op !== 'Z') {
        x = next.x
        y = next.y
      }
      if (op === 'M') {
        startX = x
        startY = y
        command = relative ? 'l' : 'L'
      }
      previous = next
      result.push(next)
    }
    return result.length ? result : undefined
  }
  catch {
    return undefined
  }
}

/** Convert an entire SVG or none of it. Never combine partial native art with its screenshot. */
export function nativeSvg(node: RawNode): IrPath[] | undefined {
  if (!node.svg)
    return undefined
  const paths: IrPath[] = []
  for (const shape of node.svg) {
    const attr = shape.attributes
    const n = (key: string) => Number(attr[key] ?? 0)
    let data = attr.d ?? ''
    if (shape.tag === 'LINE')
      data = `M${n('x1')} ${n('y1')} L${n('x2')} ${n('y2')}`
    if (shape.tag === 'RECT') {
      if (n('rx') || n('ry'))
        return undefined
      data = `M${n('x')} ${n('y')} h${n('width')} v${n('height')} h${-n('width')} Z`
    }
    if (shape.tag === 'POLYLINE' || shape.tag === 'POLYGON')
      data = `M${attr.points ?? ''}${shape.tag === 'POLYGON' ? 'Z' : ''}`
    if (shape.tag === 'CIRCLE' || shape.tag === 'ELLIPSE') {
      const rx = shape.tag === 'CIRCLE' ? n('r') : n('rx')
      const ry = shape.tag === 'CIRCLE' ? n('r') : n('ry')
      const x = n('cx')
      const y = n('cy')
      const k = 0.5522847498307936
      data = `M${x + rx} ${y} C${x + rx} ${y + k * ry} ${x + k * rx} ${y + ry} ${x} ${y + ry} C${x - k * rx} ${y + ry} ${x - rx} ${y + k * ry} ${x - rx} ${y} C${x - rx} ${y - k * ry} ${x - k * rx} ${y - ry} ${x} ${y - ry} C${x + k * rx} ${y - ry} ${x + rx} ${y - k * ry} ${x + rx} ${y} Z`
    }
    const commands = parseSvgPath(data)
    if (!commands)
      return undefined
    const fill = shape.fill === 'none' ? undefined : parseColor(shape.fill)
    const stroke = shape.stroke === 'none' ? undefined : parseColor(shape.stroke)
    if ((shape.fill !== 'none' && !fill) || (shape.stroke !== 'none' && !stroke))
      return undefined
    const [a, b, c, d, e, f] = shape.matrix
    if (!shape.matrix.every(Number.isFinite))
      return undefined
    const sx = Math.hypot(a, b)
    const sy = Math.hypot(c, d)
    // A nonuniform transform produces a nonuniform stroke; DrawingML cannot represent it.
    if (stroke && (Math.abs(sx - sy) > 0.001 || Math.abs(a * c + b * d) > 0.001))
      return undefined
    const point = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f })
    const positions: { x: number, y: number }[] = []
    const transformed = commands.map((command): PathCommand => {
      if (command.op === 'Z')
        return command
      const p = point(command.x, command.y)
      positions.push(p)
      if (command.op === 'C' || command.op === 'Q') {
        const p1 = point(command.x1, command.y1)
        positions.push(p1)
        if (command.op === 'C') {
          const p2 = point(command.x2, command.y2)
          positions.push(p2)
          return { op: 'C', ...p, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
        }
        return { op: 'Q', ...p, x1: p1.x, y1: p1.y }
      }
      return { op: command.op, ...p }
    })
    const x = Math.min(...positions.map(p => p.x))
    const y = Math.min(...positions.map(p => p.y))
    const w = Math.max(...positions.map(p => p.x)) - x
    const h = Math.max(...positions.map(p => p.y)) - y
    for (const command of transformed) {
      if (command.op === 'Z')
        continue
      command.x -= x
      command.y -= y
      if (command.op === 'C' || command.op === 'Q') {
        command.x1 -= x
        command.y1 -= y
      }
      if (command.op === 'C') {
        command.x2 -= x
        command.y2 -= y
      }
    }
    paths.push({
      kind: 'path',
      sourceId: node.id,
      rect: { x, y, w: Math.max(w, 0.001), h: Math.max(h, 0.001) },
      commands: transformed,
      fill: withOpacity(fill, shape.opacity * shape.fillOpacity),
      stroke: stroke ? { color: withOpacity(stroke, shape.opacity * shape.strokeOpacity)!, width: shape.strokeWidth * sx } : undefined,
    })
  }
  return paths
}
