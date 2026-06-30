import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deserializeReport, neededDatasets } from './report'

describe('sample-report.json', () => {
  const json = readFileSync(
    resolve(import.meta.dirname, '../../public/demo/sample-report.json'),
    'utf8',
  )

  it('deserializes to a non-empty report', () => {
    const doc = deserializeReport(json)
    expect(doc.version).toBe(1)
    expect(doc.blocks.length).toBeGreaterThan(0)
  })

  it('references only the demo tables', () => {
    const doc = deserializeReport(json)
    expect(neededDatasets(doc).every((t) => t === 'users' || t === 'payments')).toBe(true)
  })
})
