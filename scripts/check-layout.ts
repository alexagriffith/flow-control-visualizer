/// <reference lib="dom" />

import { spawn } from 'node:child_process'
import { chromium, type Page } from 'playwright'

const host = '127.0.0.1'
const port = 5199
const baseUrl = `http://${host}:${port}`

type Box = { x: number; y: number; width: number; height: number }

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not start at ${baseUrl}`)
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))
  assert(dimensions.content <= dimensions.viewport + 1, `${label}: page overflows horizontally`)
}

async function assertPlaybackControls(page: Page, label: string): Promise<void> {
  const boxes = await page.locator('.timeline-controls > *').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }))
  assert(boxes.length === 3, `${label}: expected three playback controls`)
  for (let index = 0; index < boxes.length; index += 1) {
    for (let peer = index + 1; peer < boxes.length; peer += 1) {
      assert(!overlaps(boxes[index], boxes[peer]), `${label}: playback controls overlap`)
    }
  }
}

async function assertFourCardGrid(page: Page, label: string, columns: number): Promise<void> {
  await page.getByRole('button', { name: 'Metrics' }).click()
  await page.locator('.tenant-grid').evaluate((grid, expectedColumns) => {
    const firstCard = grid.firstElementChild
    if (!firstCard) throw new Error('Traffic grid has no cards')
    while (grid.children.length < 4) grid.append(firstCard.cloneNode(true))
    while (grid.children.length > 4) grid.lastElementChild?.remove()
    ;(grid as HTMLElement).style.setProperty('--tenant-grid-columns', String(expectedColumns))
  }, columns)
  const boxes = await page.locator('.tenant-grid > *').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }))
  assert(boxes.length === 4, `${label}: expected four traffic cards`)
  const roundedX = new Set(boxes.map((box) => Math.round(box.x)))
  assert(roundedX.size === columns, `${label}: expected ${columns} balanced traffic-card column(s)`)
  if (columns === 2) {
    const roundedY = new Set(boxes.map((box) => Math.round(box.y)))
    assert(roundedY.size === 2, `${label}: expected a complete 2 by 2 traffic-card grid`)
    const widths = boxes.map((box) => Math.round(box.width))
    assert(Math.max(...widths) - Math.min(...widths) <= 1, `${label}: traffic-card widths differ`)
  }
}

async function assertFlowLabels(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Flow' }).click()
  const bodyText = (await page.locator('body').innerText()).toLowerCase()
  for (const staleText of [
    'priority + fairness',
    'llm-d priority ends here',
    'mechanics, not measured membership',
    'p100 → p50 → p0 → p-10',
  ]) {
    assert(!bodyText.includes(staleText), `${label}: stale label remains: ${staleText}`)
  }
  assert(await page.locator('.request-stream-columns').count() === 1, `${label}: missing shared in-flight header`)
  assert(await page.locator('.priority-stack-columns').count() === 1, `${label}: missing shared queued header`)
}

async function checkViewport(width: number, height: number, recording = false): Promise<void> {
  const label = `${width}x${height}${recording ? ' recording' : ''}`
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(`${baseUrl}${recording ? '?record=1' : ''}`, { waitUntil: 'networkidle' })
  await page.locator('select[name="run"] option[value="loaded"]').waitFor({ state: 'attached' })
  await page.locator('.request-stream').first().waitFor({ state: 'visible' })
  await assertNoHorizontalOverflow(page, label)
  await assertPlaybackControls(page, label)
  await assertFlowLabels(page, label)
  await assertFourCardGrid(page, label, width <= 520 ? 1 : 2)
  await assertNoHorizontalOverflow(page, `${label} metrics`)
  await context.close()
  await browser.close()
}

async function main(): Promise<void> {
  const server = spawn('npm', ['run', 'dev', '--', '--host', host, '--port', String(port), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  let serverOutput = ''
  server.stdout.on('data', (chunk) => { serverOutput += String(chunk) })
  server.stderr.on('data', (chunk) => { serverOutput += String(chunk) })

  try {
    await waitForServer()
    await checkViewport(1440, 900)
    await checkViewport(880, 626, true)
    await checkViewport(390, 800)
    process.stdout.write('Layout checks passed at desktop, recording, and mobile viewports.\n')
  } catch (error) {
    process.stderr.write(serverOutput)
    throw error
  } finally {
    if (server.pid && process.platform !== 'win32') {
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        server.kill('SIGTERM')
      }
    } else {
      server.kill('SIGTERM')
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
