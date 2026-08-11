import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

type RecordingOptions = {
  url: string
  output: string
  poster: string
  seconds: number
  startTime: number | null
  posterTime: number | null
  speed: number
}

function parseArguments(argv: string[]): RecordingOptions {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const url = valueAfter('--url')
  const output = valueAfter('--output')
  if (!url || !output) throw new Error('Use --url and --output')
  const seconds = Number(valueAfter('--seconds') ?? 20)
  const speed = Number(valueAfter('--speed') ?? 1)
  const startTimeValue = valueAfter('--start-time')
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--seconds must be positive')
  if (![0.5, 1, 2, 4].includes(speed)) throw new Error('--speed must be 0.5, 1, 2, or 4')
  return {
    url,
    output: resolve(output),
    poster: resolve(valueAfter('--poster') ?? output.replace(/\.mp4$/i, '-poster.png')),
    seconds,
    startTime: startTimeValue === undefined ? null : Number(startTimeValue),
    posterTime: valueAfter('--poster-time') === undefined ? null : Number(valueAfter('--poster-time')),
    speed,
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const videoDirectory = resolve(dirname(options.output), '.recording-tmp')
  await mkdir(videoDirectory, { recursive: true })
  await mkdir(dirname(options.poster), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 880, height: 626 },
    recordVideo: { dir: videoDirectory, size: { width: 880, height: 626 } },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const target = new URL(options.url)
  target.searchParams.set('record', '1')
  await page.goto(target.toString(), { waitUntil: 'networkidle' })
  await page.locator('select[name="run"] option[value="loaded"]').waitFor({ state: 'attached' })
  if (options.startTime !== null) {
    await page.locator('input[name="run-time"]').fill(String(options.startTime))
  }
  await page.locator('select[name="playback-speed"]').selectOption(String(options.speed))
  if (options.posterTime !== null) {
    await page.locator('input[name="run-time"]').fill(String(options.posterTime))
  }
  await page.screenshot({ path: options.poster })
  if (options.posterTime !== null && options.startTime !== null) {
    await page.locator('input[name="run-time"]').fill(String(options.startTime))
  }
  await page.getByRole('button', { name: 'Play replay' }).click()
  await page.waitForTimeout(options.seconds * 1000)
  const video = page.video()
  await page.close()
  await context.close()
  const temporaryVideo = await video?.path()
  await browser.close()
  if (!temporaryVideo) throw new Error('Playwright did not produce a recording')
  await new Promise<void>((resolvePromise, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', temporaryVideo,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', options.output,
    ], { stdio: 'inherit' })
    ffmpeg.on('error', reject)
    ffmpeg.on('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited with ${code}`)))
  })
  await rm(videoDirectory, { recursive: true, force: true })
  process.stdout.write(`Recorded ${options.output}\nPoster ${options.poster}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
