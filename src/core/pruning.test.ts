import { describe, expect, it } from 'vitest'
import { detectReferencedTables, detectUsedColumns } from './pruning'

const cols = ['user_id', 'country', 'zip', 'signup', 'revenue']

describe('detectUsedColumns', () => {
  it('SELECT * uses all columns', () => {
    expect(detectUsedColumns('SELECT * FROM events', cols).sort()).toEqual(
      [...cols].sort(),
    )
  })
  it('qualified star (t.*) uses all columns', () => {
    expect(
      detectUsedColumns('SELECT e.* FROM events e', cols).sort(),
    ).toEqual([...cols].sort())
  })
  it('count(*) does NOT count as all-columns', () => {
    expect(
      detectUsedColumns(
        'SELECT country, count(*) AS n FROM events GROUP BY 1 ORDER BY n DESC',
        cols,
      ),
    ).toEqual(['country'])
  })
  it('matches qualified and unqualified column tokens', () => {
    expect(
      detectUsedColumns(
        'SELECT e.user_id, revenue FROM events e',
        cols,
      ).sort(),
    ).toEqual(['revenue', 'user_id'])
  })
  it('ignores unknown identifiers', () => {
    expect(detectUsedColumns('SELECT total FROM orders', cols)).toEqual([])
  })
  it('is case-insensitive', () => {
    expect(detectUsedColumns('select COUNTRY from events', cols)).toEqual([
      'country',
    ])
  })
})

const tables = ['events', 'metrics', 'orders_2024']

describe('detectReferencedTables', () => {
  it('finds a single referenced table', () => {
    expect(detectReferencedTables('SELECT * FROM events', tables)).toEqual([
      'events',
    ])
  })
  it('finds every table in a JOIN, in the input list order', () => {
    expect(
      detectReferencedTables(
        'SELECT e.x, m.y FROM events e JOIN metrics m ON e.k = m.k',
        tables,
      ),
    ).toEqual(['events', 'metrics'])
  })
  it('finds both sides of a UNION (order follows the tables list, not the SQL)', () => {
    expect(
      detectReferencedTables(
        'SELECT a FROM metrics UNION ALL SELECT a FROM events',
        tables,
      ),
    ).toEqual(['events', 'metrics'])
  })
  it('is case-insensitive', () => {
    expect(detectReferencedTables('select * from EVENTS', tables)).toEqual([
      'events',
    ])
  })
  it('matches whole tokens only (no substring), incl. names with digits', () => {
    expect(
      detectReferencedTables('SELECT * FROM events_archive', tables),
    ).toEqual([])
    expect(detectReferencedTables('SELECT * FROM orders_2024', tables)).toEqual([
      'orders_2024',
    ])
  })
  it('returns [] when no known table is referenced', () => {
    expect(detectReferencedTables('SELECT 1', tables)).toEqual([])
    expect(detectReferencedTables('', tables)).toEqual([])
  })
})
