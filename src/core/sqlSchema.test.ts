import { describe, expect, it } from 'vitest'
import type { Dataset } from '../state/session'
import { buildSqlSchema } from './sqlSchema'

const ds = (table: string, cols: string[]): Dataset => ({
  table,
  fileName: `${table}.csv`,
  bytes: 0,
  kind: 'csv',
  columns: cols.map((name) => ({ name, type: 'VARCHAR' })),
})

describe('buildSqlSchema', () => {
  it('maps each dataset table to its column names', () => {
    expect(buildSqlSchema([ds('users', ['UserID', 'DateUTC'])])).toEqual({
      users: ['UserID', 'DateUTC'],
    })
  })

  it('excludes internal _qb_ tables', () => {
    expect(buildSqlSchema([ds('users', ['a']), ds('_qb_raw_users', ['a'])])).toEqual({
      users: ['a'],
    })
  })

  it('returns {} for no datasets', () => {
    expect(buildSqlSchema([])).toEqual({})
  })
})
