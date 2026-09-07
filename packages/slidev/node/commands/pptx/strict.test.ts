import type { Page } from 'playwright-chromium'
import type { SlideIr } from './ir'
import { describe, expect, it } from 'vitest'
import { capture } from './capture'
import { assertNativeExport } from './strict'

function slide(nodes: SlideIr['nodes'] = []): SlideIr {
  return { no: 7, clickIndex: 2, containerId: '007-03', size: { w: 980, h: 552 }, nodes }
}

describe('strict PPTX export', () => {
  it('allows editable objects and original bitmap assets', () => {
    expect(() => assertNativeExport([slide([
      { kind: 'box', sourceId: 1, rect: { x: 0, y: 0, w: 100, h: 100 }, fill: { r: 0, g: 0, b: 0, a: 1 } },
      { kind: 'image', sourceId: 2, rect: { x: 0, y: 0, w: 100, h: 100 }, data: '/original.png' },
    ])])).not.toThrow()
  })

  it('reports each unsupported element with its click state', () => {
    expect(() => assertNativeExport([slide([
      { kind: 'raster', sourceId: 42, rect: { x: 0, y: 0, w: 100, h: 100 }, data: '', reason: 'svg', isolate: false, hideDescendants: false },
    ])])).toThrow('slide 7, click 2, element 42: svg')
  })

  it('rejects full-slide fallbacks and omitted content', () => {
    expect(() => assertNativeExport([{ ...slide(), fallbackReason: 'too much raster content' }])).toThrow('slide 7, click 2: too much raster content')
    expect(() => assertNativeExport([], ['invalid-color'])).toThrow('unsupported color: invalid-color')
    expect(() => assertNativeExport([], [], ['div::after'])).toThrow('unplaced CSS decoration: div::after')
  })

  it('rejects capture requests before touching the browser', async () => {
    await expect(capture({} as Page, [slide()], [
      { sourceId: 42, isolate: false, hideDescendants: false },
    ], { strict: true })).rejects.toThrow('does not permit screenshot requests')
  })

  it('does not screenshot an unreadable original image', async () => {
    const page = {
      evaluate: async () => undefined,
      viewportSize: () => null,
      context: () => ({ request: { get: async () => ({ ok: () => false }) } }),
      screenshot: () => { throw new Error('Screenshot must not be called') },
    } as unknown as Page
    await expect(capture(page, [slide([
      { kind: 'image', sourceId: 12, rect: { x: 0, y: 0, w: 100, h: 100 }, data: 'https://example.invalid/image.png' },
    ])], [], { strict: true })).rejects.toThrow('slide 7, click 2, element 12: image could not be read without a screenshot')
  })
})
