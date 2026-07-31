import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('parses headers, empty values, and CRLF rows', () => {
    expect(parseCsv('name,value,note\r\na,1,\r\nb,2,ok\r\n')).toEqual([
      { name: 'a', value: '1', note: '' },
      { name: 'b', value: '2', note: 'ok' },
    ])
  })

  it('supports quoted commas and escaped quotes', () => {
    expect(parseCsv('name,note\nalpha,"queued, then dispatched"\nbeta,"said ""go"""')).toEqual([
      { name: 'alpha', note: 'queued, then dispatched' },
      { name: 'beta', note: 'said "go"' },
    ])
  })
})
