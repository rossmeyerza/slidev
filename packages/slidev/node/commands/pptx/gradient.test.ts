import type { RawStyle, SlideIr } from './ir'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { describe, expect, it } from 'vitest'
import { buildPptx } from './build'
import { drawingStops, parseGradients, parseLinearGradient } from './gradient'

function parse(backgroundImage: string, extra: Partial<RawStyle> = {}) {
  // The browser serializes named colors to rgb() before normalization.
  backgroundImage = backgroundImage.replace(/red/g, 'rgb(255, 0, 0)').replace(/green/g, 'rgb(0, 128, 0)').replace(/blue/g, 'rgb(0, 0, 255)')
  return parseLinearGradient({ backgroundImage, ...extra } as RawStyle)
}

describe('native linear gradients', () => {
  it('maps CSS angles and interpolates missing stops', () => {
    const gradient = parse('linear-gradient(90deg, red, green, blue)')!
    expect(gradient.angle).toBe(0)
    expect(gradient.stops.map(stop => stop.offset)).toEqual([0, 0.5, 1])
    expect(parse('linear-gradient(to top, red, blue)')!.angle).toBe(270)
  })

  it('keeps alpha and hard transitions', () => {
    const gradient = parse('linear-gradient(rgba(0, 0, 0, 0), red 50%, blue 50%)')!
    expect(gradient.stops[0].color.a).toBe(0)
    expect(gradient.stops.map(stop => stop.offset)).toEqual([0, 0.5, 0.5])
  })

  it('leaves unsupported paint to the explicit fallback policy', () => {
    for (const css of ['radial-gradient(red, blue)', 'linear-gradient(red, blue), linear-gradient(red, blue)', 'linear-gradient(red -10%, blue)', 'linear-gradient(in oklab, red, blue)'])
      expect(parse(css)).toBeUndefined()
    expect(parse('linear-gradient(red, blue)', { backgroundSize: '50% 50%' })).toBeUndefined()
  })

  it('writes a native DrawingML fill without picture objects', async () => {
    const ir: SlideIr = {
      no: 1,
      clickIndex: 0,
      containerId: '001-01',
      size: { w: 980, h: 552 },
      nodes: [{ kind: 'box', sourceId: 1, rect: { x: 0, y: 0, w: 200, h: 100 }, gradient: parse('linear-gradient(90deg, rgba(0, 0, 0, 0), blue)') }],
    }
    const zip = await JSZip.loadAsync(await buildPptx(PptxGenJS, [ir], { width: 980, height: 552 }))
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain('<a:gradFill')
    expect(xml).toContain('<a:alpha val="0"/>')
    expect(xml).toContain('<a:lin ang="0" scaled="0"/>')
    expect(xml).not.toContain('<p:pic>')
    expect(Object.keys(zip.files).filter(path => path.startsWith('ppt/media/') && !zip.files[path].dir)).toEqual([])
  })
})

describe('radial and layered gradients', () => {
  const box = { w: 400, h: 200 }
  function layers(backgroundImage: string) {
    return parseGradients({ backgroundImage } as RawStyle, box)
  }
  it('resolves circle centres, corner radii, and two-position stops', () => {
    const gradient = layers('radial-gradient(circle at 25% 50%, rgb(255, 0, 0) 0% 4%, transparent 21%)')![0]
    expect(gradient.radial).toEqual({ cx: 100, cy: 100, rx: Math.hypot(300, 100), ry: Math.hypot(300, 100) })
    expect(gradient.stops.map(stop => stop.offset)).toEqual([0, 0.04, 0.21])
  })
  it('supports pixel stops and keeps elliptical fills as explicit fallbacks', () => {
    expect(layers('radial-gradient(ellipse 100px 50px at center, rgb(255, 0, 0), transparent)')).toBeUndefined()
    const gradient = layers('radial-gradient(circle 100px at center, rgb(255, 0, 0) 20px, transparent 100px)')![0]
    expect(gradient.radial).toEqual({ cx: 200, cy: 100, rx: 100, ry: 100 })
    expect(gradient.stops[0].offset).toBe(0.2)
  })
  it('keeps the CSS layer order and rejects a partial conversion', () => {
    expect(layers('radial-gradient(circle, rgb(255, 0, 0), transparent), linear-gradient(90deg, rgb(0, 0, 0), rgb(255, 255, 255))')).toHaveLength(2)
    expect(layers('linear-gradient(rgb(0, 0, 0), transparent), url(image.png)')).toBeUndefined()
    expect(layers('radial-gradient(circle at -10% 50%, rgb(0, 0, 0), transparent)')).toBeUndefined()
  })
  it('preserves visible color while alpha fades', () => {
    const stops = drawingStops(layers('radial-gradient(circle, rgb(255, 0, 0), transparent)')![0].stops)
    expect(stops.length).toBeGreaterThan(3)
    expect(stops.every(stop => stop.color.r === 255)).toBe(true)
  })
})
