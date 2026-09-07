import process from 'node:process'
import JSZip from 'jszip'
import { chromium } from 'playwright-chromium'
import PptxGenJS from 'pptxgenjs'
import { expect, it } from 'vitest'
import { buildPptx } from './build'
import { capture } from './capture'
import { normalize } from './normalize'
import { assertNativeExport } from './strict'
import { collectSnapshot } from './walker'

// Opt in with a local Chromium binary. This test requires real layout, not jsdom.
it.runIf(!!process.env.SLIDEV_TEST_CHROMIUM)('keeps an overlapping SVG annotation and heading native', async () => {
  const browser = await chromium.launch({ executablePath: process.env.SLIDEV_TEST_CHROMIUM })
  try {
    const page = await browser.newPage({ viewport: { width: 980, height: 552 } })
    await page.setContent(`<style>
      body { margin: 0; font-family: Arial; }
      .print-slide-container { width: 980px; height: 552px; }
      h1 { margin: 0; font-size: 40px; }
      .paint { width: 400px; height: 100px; background: linear-gradient(90deg, red, blue); }
    </style><div class="print-slide-container" id="001-01">
      <h1>Approve a short<br><span>Discovery sprint</span>
        <svg style="position: absolute; top: 0; left: 0; width: 100px; height: 100px; overflow: visible">
          <path d="M0 60 C100 55 200 65 350 60" fill="none" stroke="orange" stroke-width="30" opacity="0.3" stroke-dasharray="1000" stroke-dashoffset="0"/>
        </svg>
      </h1><div class="paint"></div></div>`)
    const snapshot = await page.evaluate(collectSnapshot, { containerSelector: '.print-slide-container', idAttribute: 'data-slidev-export-id' })
    const result = normalize(snapshot, { notes: new Map() })
    assertNativeExport(result.slides, result.unparsedColors, snapshot.unplaceablePseudos)
    expect(result.rasterRequests).toEqual([])
    const text = result.slides[0].nodes.filter(node => node.kind === 'text').flatMap(node => node.runs.map(run => run.text)).join('')
    expect(text.match(/Approve a short/g)).toHaveLength(1)
    expect(text.match(/Discovery sprint/g)).toHaveLength(1)
    expect(result.slides[0].nodes.some(node => node.kind === 'path')).toBe(true)
    const zip = await JSZip.loadAsync(await buildPptx(PptxGenJS, result.slides, { width: 980, height: 552 }))
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain('<a:gradFill')
    expect(xml).toContain('<a:custGeom>')
    expect(xml).not.toContain('<p:pic>')
  }
  finally {
    await browser.close()
  }
})

it.runIf(!!process.env.SLIDEV_TEST_CHROMIUM)('hides ancestor text during capture and restores the page', async () => {
  const browser = await chromium.launch({ executablePath: process.env.SLIDEV_TEST_CHROMIUM })
  try {
    const page = await browser.newPage({ viewport: { width: 980, height: 552 } })
    await page.setContent('<h1>Parent heading<svg data-slidev-export-id="1" width="100" height="100"><rect width="100" height="100" fill="red"/></svg><span>Sibling</span></h1>')
    const screenshot = page.screenshot.bind(page)
    let checked = false
    page.screenshot = async (options) => {
      expect(await page.locator('h1').evaluate(el => getComputedStyle(el).visibility)).toBe('hidden')
      expect(await page.locator('svg').evaluate(el => getComputedStyle(el).visibility)).toBe('visible')
      checked = true
      return screenshot(options)
    }
    await capture(page, [{ no: 1, clickIndex: 0, containerId: '001-01', size: { w: 980, h: 552 }, nodes: [
      { kind: 'raster', sourceId: 1, rect: { x: 0, y: 0, w: 100, h: 100 }, reason: 'svg', data: '', isolate: true, hideDescendants: false },
    ] }], [{ sourceId: 1, isolate: true, hideDescendants: false }])
    expect(checked).toBe(true)
    expect(await page.locator('h1').evaluate(el => getComputedStyle(el).visibility)).toBe('visible')
    expect(await page.locator('[data-slidev-export-restore]').count()).toBe(0)
  }
  finally {
    await browser.close()
  }
})
