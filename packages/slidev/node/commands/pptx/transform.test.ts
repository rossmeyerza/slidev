import type { RawSnapshot, RawStyle } from './ir'
import { describe, expect, it } from 'vitest'
import { nativeScale, scaleSnapshot } from './transform'

describe('native container scale', () => {
  it('accepts uniform positive scales and translations only', () => {
    expect(nativeScale({ transform: 'matrix(0.8, 0, 0, 0.8, 12, -5)' } as RawStyle)).toBe(0.8)
    expect(nativeScale({ scale: '120%', zoom: '2' } as RawStyle)).toBe(2.4)
    for (const transform of ['matrix(1, 1, 0, 1, 0, 0)', 'matrix(1, 0, 0, 2, 0, 0)', 'matrix(-1, 0, 0, -1, 0, 0)', 'matrix(0, 1, -1, 0, 0, 0)'])
      expect(nativeScale({ transform } as RawStyle)).toBeUndefined()
  })
  it('compounds parent scales without scaling measured rectangles twice', () => {
    const style = { transform: 'matrix(0.5, 0, 0, 0.5, 0, 0)', fontSize: '20px', lineHeight: '30px', borderTopWidth: '4px', boxShadow: 'rgb(0, 0, 0) 2px 4px 6px' } as RawStyle
    const rect = { x: 10, y: 20, w: 50, h: 30 }
    const input: RawSnapshot = { slides: [{ no: 1, clickIndex: 0, containerId: '001-01', size: { w: 980, h: 552 }, nodes: [
      { id: 1, parent: -1, tag: 'DIV', style: 0, rect },
      { id: 2, parent: 1, tag: 'DIV', style: 0, rect },
    ] }], styles: [style], fontResolution: {}, unplaceablePseudos: [] }
    const result = scaleSnapshot(input)
    const nested = result.styles[result.slides[0].nodes[1].style]
    expect(nested.fontSize).toBe('5px')
    expect(nested.borderTopWidth).toBe('1px')
    expect(nested.boxShadow).toBe('rgb(0, 0, 0) 0.5px 1px 1.5px')
    expect(result.slides[0].nodes[1].rect).toEqual(rect)
    expect(input.styles[0].fontSize).toBe('20px')
  })
})
