import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRunLabels } from './run-catalog'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('readRunLabels', () => {
  it('loads usable display names and ignores malformed entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-control-labels-'))
    temporaryDirectories.push(directory)
    await writeFile(join(directory, 'RUN-LABELS.json'), JSON.stringify({
      labels: {
        'run-a': { display_name: 'Clean baseline', scenario: 'priority tiers' },
        'run-b': { display_name: '  Fairness signal  ' },
        'run-c': { display_name: '' },
        'run-d': 'invalid',
      },
    }))

    await expect(readRunLabels(directory)).resolves.toEqual(new Map([
      ['run-a', { displayName: 'Clean baseline', scenario: 'priority tiers' }],
      ['run-b', { displayName: 'Fairness signal', scenario: null }],
    ]))
  })

  it('returns an empty map when the optional label file is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-control-labels-'))
    temporaryDirectories.push(directory)

    await expect(readRunLabels(directory)).resolves.toEqual(new Map())
  })
})
