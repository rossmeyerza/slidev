import type PptxGenJS from 'pptxgenjs'
import type { IrBox } from './ir'
import { EMU_PER_PX, INCHES_PER_PX, PT_PER_PX } from './ir'

function metrics(node: IrBox) {
  const radial = node.gradient!.radial!
  if (Math.abs(radial.rx - radial.ry) > 0.000001)
    throw new Error('Elliptical radial gradients are not supported')
  const radius = Math.max(radial.rx, radial.ry)
  const sx = radial.rx / radius
  const sy = radial.ry / radius
  const side = Math.SQRT2 * radius
  return { sx, sy, side, x: radial.cx / sx - side / 2, y: radial.cy / sy - side / 2 }
}

/**
 * DrawingML's radial fill circumscribes its anchor square. Give it an anchor
 * with the required radius and clip it with custom geometry, not tileRect.
 * An outer group places that geometry without moving the focus.
 * https://learn.microsoft.com/en-us/answers/questions/2248059/non-preset-a-tilerect-behaves-strange-in-case-of-g
 */
export function radialShape(node: IrBox, objectName: string): PptxGenJS.ShapeProps {
  const { sx, sy, side, x, y } = metrics(node)
  const p = (px: number, py: number) => ({ x: (px / sx - x) * INCHES_PER_PX, y: (py / sy - y) * INCHES_PER_PX })
  const r = Math.min(node.radius ?? 0, node.rect.w / 2, node.rect.h / 2)
  const w = node.rect.w
  const h = node.rect.h
  const k = 0.5522847498307936
  const curve = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const c1 = p(x1, y1)
    const c2 = p(x2, y2)
    return { ...p(px, py), curve: { type: 'cubic' as const, x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y } }
  }
  return {
    objectName,
    x: x * INCHES_PER_PX,
    y: y * INCHES_PER_PX,
    w: side * INCHES_PER_PX,
    h: side * INCHES_PER_PX,
    points: [
      p(r, 0),
      p(w - r, 0),
      curve(w, r, w - r + k * r, 0, w, r - k * r),
      p(w, h - r),
      curve(w - r, h, w, h - r + k * r, w - r + k * r, h),
      p(r, h),
      curve(0, h - r, r - k * r, h, 0, h - r + k * r),
      p(0, r),
      curve(r, 0, 0, r - k * r, r - k * r, 0),
      { close: true },
    ],
    shadow: node.shadow
      ? {
          type: 'outer',
          blur: node.shadow.blur * PT_PER_PX,
          offset: node.shadow.offset * PT_PER_PX,
          angle: node.shadow.angle,
          color: [node.shadow.color.r, node.shadow.color.g, node.shadow.color.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''),
          opacity: node.shadow.color.a,
        }
      : undefined,
  }
}

export function wrapRadial(shape: string, node: IrBox, id: number): string {
  const { sx, sy } = metrics(node)
  const emu = (n: number) => Math.round(n * EMU_PER_PX)
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Native radial gradient ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${emu(node.rect.x)}" y="${emu(node.rect.y)}"/><a:ext cx="${emu(node.rect.w)}" cy="${emu(node.rect.h)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(node.rect.w / sx)}" cy="${emu(node.rect.h / sy)}"/></a:xfrm></p:grpSpPr>${shape}</p:grpSp>`
}
