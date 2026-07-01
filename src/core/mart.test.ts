import { describe, it, expect } from 'vitest'
import { buildCreateMart, buildDropMart, validateMartName } from './mart'

describe('buildCreateMart', () => {
  it('builds a VIEW', () => {
    expect(buildCreateMart('rev', 'SELECT 1', 'view')).toBe(
      'CREATE OR REPLACE VIEW "rev" AS SELECT 1',
    )
  })
  it('builds a TABLE', () => {
    expect(buildCreateMart('rev', 'SELECT 1', 'table')).toBe(
      'CREATE OR REPLACE TABLE "rev" AS SELECT 1',
    )
  })
  it('strips a trailing semicolon + whitespace from the query', () => {
    expect(buildCreateMart('rev', 'SELECT 1;  ', 'view')).toBe(
      'CREATE OR REPLACE VIEW "rev" AS SELECT 1',
    )
  })
  it('quotes the name', () => {
    expect(buildCreateMart('a"b', 'SELECT 1', 'table')).toBe(
      'CREATE OR REPLACE TABLE "a""b" AS SELECT 1',
    )
  })
})

describe('buildDropMart', () => {
  it('drops a view / table idempotently', () => {
    expect(buildDropMart('rev', 'view')).toBe('DROP VIEW IF EXISTS "rev"')
    expect(buildDropMart('rev', 'table')).toBe('DROP TABLE IF EXISTS "rev"')
  })
})

describe('validateMartName', () => {
  it('rejects an empty / whitespace name', () => {
    expect(validateMartName('   ', [])).toBeTruthy()
  })
  it('rejects a leading digit', () => {
    expect(validateMartName('1rev', [])).toBeTruthy()
  })
  it('rejects non-identifier characters', () => {
    expect(validateMartName('rev-1', [])).toBeTruthy()
    expect(validateMartName('моя', [])).toBeTruthy()
  })
  it('rejects an internal (_qb_*) name', () => {
    expect(validateMartName('_qb_raw_x', [])).toBeTruthy()
  })
  it('rejects a name already taken by a dataset/mart', () => {
    expect(validateMartName('payments', ['payments'])).toBeTruthy()
  })
  it('accepts a fresh simple identifier', () => {
    expect(validateMartName('rev_by_day', ['payments'])).toBeNull()
  })
})
