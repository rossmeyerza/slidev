import type { RawNode, RawSvgShape, SlideIr } from './ir'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { describe, expect, it } from 'vitest'
import { buildPptx } from './build'
import { nativeSvg, parseSvgPath } from './svg'

function svg(overrides: Partial<RawSvgShape> = {}): RawNode {
  return {
    id: 1,
    parent: -1,
    tag: 'SVG',
    style: 0,
    rect: { x: 0, y: 0, w: 100, h: 100 },
    svg: [{ tag: 'PATH', attributes: { d: 'M0 0 C10 0 20 30 40 40 Z' }, matrix: [2, 0, 0, 2, 10, 20], fill: 'rgb(255, 0, 0)', stroke: 'none', strokeWidth: 1, opacity: 0.5, fillOpacity: 1, strokeOpacity: 1, ...overrides }],
  }
}

describe('native SVG paths', () => {
  it('handles relative segments, subpaths, and reflected controls', () => {
    expect(parseSvgPath('M10 20 h20 v10 z m5 5 l2 3')).toEqual([
      { op: 'M', x: 10, y: 20 },
      { op: 'L', x: 30, y: 20 },
      { op: 'L', x: 30, y: 30 },
      { op: 'Z' },
      { op: 'M', x: 15, y: 25 },
      { op: 'L', x: 17, y: 28 },
    ])
    expect(parseSvgPath('M0 0 Q10 20 30 40 T50 60')?.at(-1)).toEqual({ op: 'Q', x1: 50, y1: 60, x: 50, y: 60 })
  })

  it('rejects incomplete paths and unsupported arcs instead of dropping segments', () => {
    for (const path of ['M0', 'L0 0', 'M0 0 A10 10 0 0 0 20 20', 'M0 0 ! L1 1', 'M0 0 C1 2'])
      expect(parseSvgPath(path)).toBeUndefined()
  })

  it('preserves transforms and alpha', () => {
    const path = nativeSvg(svg())![0]
    expect(path.rect).toEqual({ x: 10, y: 20, w: 80, h: 80 })
    expect(path.fill?.a).toBe(0.5)
    expect(path.commands[1]).toEqual({ op: 'C', x1: 20, y1: 0, x2: 40, y2: 60, x: 80, y: 80 })
  })

  it('rejects unresolved paint and nonuniform strokes', () => {
    expect(nativeSvg(svg({ fill: 'url(#paint)' }))).toBeUndefined()
    expect(nativeSvg(svg({ stroke: 'rgb(0, 0, 0)', matrix: [2, 0, 0, 1, 0, 0] }))).toBeUndefined()
  })

  it('writes editable geometry, not an embedded SVG or bitmap', async () => {
    const ir: SlideIr = { no: 1, clickIndex: 0, containerId: '001-01', size: { w: 980, h: 552 }, nodes: nativeSvg(svg())! }
    const zip = await JSZip.loadAsync(await buildPptx(PptxGenJS, [ir], { width: 980, height: 552 }))
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain('<a:custGeom>')
    expect(xml).toContain('<a:cubicBezTo>')
    expect(xml).toContain('<a:alpha val="50000"/>')
    expect(xml).not.toContain('<p:pic>')
    expect(Object.keys(zip.files).filter(path => path.startsWith('ppt/media/') && !zip.files[path].dir)).toEqual([])
  })
})
