import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW, buildOrderBy, buildWhere, buildWindowSql, buildCountSql, buildEffectiveSql,
  buildWidgetSql, WIDGET_ROW_CAP,
  type ResultView, type ColumnFilter,
} from './resultQuery'

const COLS = ['id', 'name', 'amount', 'day']
const view = (p: Partial<ResultView>): ResultView => ({ ...DEFAULT_VIEW, ...p })

describe('buildOrderBy', () => {
  it('empty when no sorts', () => { expect(buildOrderBy([])).toBe('') })
  it('single + multi, quoted', () => {
    expect(buildOrderBy([{ col: 'a', dir: 'asc' }])).toBe('ORDER BY "a" ASC')
    expect(buildOrderBy([{ col: 'a', dir: 'asc' }, { col: 'b', dir: 'desc' }]))
      .toBe('ORDER BY "a" ASC, "b" DESC')
  })
})

describe('buildWhere', () => {
  it('empty when no search/filters', () => { expect(buildWhere(COLS, view({}))).toBe('') })
  it('global search ORs every column cast to VARCHAR, escaped + ESCAPE', () => {
    const w = buildWhere(['a', 'b'], view({ search: '50%_x' }))
    expect(w).toBe(
      `WHERE ("a"::VARCHAR ILIKE '%50\\%\\_x%' ESCAPE '\\' OR "b"::VARCHAR ILIKE '%50\\%\\_x%' ESCAPE '\\')`,
    )
  })
  it('text contains predicate', () => {
    const f: ColumnFilter = { col: 'name', type: 'text', op: 'contains', value: "O'Neil" }
    expect(buildWhere(COLS, view({ filters: [f] })))
      .toBe(`WHERE ("name"::VARCHAR ILIKE '%O''Neil%' ESCAPE '\\')`)
  })
  it('number range uses typed comparisons', () => {
    const f: ColumnFilter = { col: 'amount', type: 'number', min: 10, max: 100 }
    expect(buildWhere(COLS, view({ filters: [f] })))
      .toBe(`WHERE ("amount" >= 10 AND "amount" <= 100)`)
  })
  it('set membership compares as VARCHAR', () => {
    const f: ColumnFilter = { col: 'name', type: 'set', values: ['US', 'UK'] }
    expect(buildWhere(COLS, view({ filters: [f] })))
      .toBe(`WHERE ("name"::VARCHAR IN ('US', 'UK'))`)
  })
  it('null / not-null', () => {
    expect(buildWhere(COLS, view({ filters: [{ col: 'x', type: 'null', op: 'isNull' }] })))
      .toBe(`WHERE ("x" IS NULL)`)
  })
  it('search AND filters combine', () => {
    const w = buildWhere(['a'], view({
      search: 'q',
      filters: [{ col: 'amount', type: 'number', min: 5, max: null }],
    }))
    expect(w).toBe(`WHERE ("a"::VARCHAR ILIKE '%q%' ESCAPE '\\') AND ("amount" >= 5)`)
  })
  it('NaN min is dropped; finite max is kept', () => {
    const f: ColumnFilter = { col: 'amount', type: 'number', min: NaN, max: 10 }
    expect(buildWhere(COLS, view({ filters: [f] })))
      .toBe(`WHERE ("amount" <= 10)`)
  })
  it('fully-NaN number filter contributes nothing', () => {
    const f: ColumnFilter = { col: 'amount', type: 'number', min: NaN, max: NaN }
    expect(buildWhere(COLS, view({ filters: [f] }))).toBe('')
  })
  it('date max bound includes the whole end day (TIMESTAMP columns)', () => {
    const where = buildWhere(['ts'], {
      ...DEFAULT_VIEW,
      filters: [{ col: 'ts', type: 'date', min: null, max: '2024-01-31' }],
    })
    expect(where).toBe(`WHERE ("ts" < '2024-01-31'::DATE + INTERVAL 1 DAY)`)
  })
  it('set filter with includeNull matches NULL rows via IS NULL', () => {
    const where = buildWhere(['c'], {
      ...DEFAULT_VIEW,
      filters: [{ col: 'c', type: 'set', values: ['x'], includeNull: true }],
    })
    expect(where).toBe(`WHERE ("c"::VARCHAR IN ('x') OR "c" IS NULL)`)
  })
  it('set filter with ONLY the null bucket', () => {
    const where = buildWhere(['c'], {
      ...DEFAULT_VIEW,
      filters: [{ col: 'c', type: 'set', values: [], includeNull: true }],
    })
    expect(where).toBe(`WHERE ("c" IS NULL)`)
  })
  it('empty set and no null bucket -> no predicate', () => {
    expect(
      buildWhere(['c'], { ...DEFAULT_VIEW, filters: [{ col: 'c', type: 'set', values: [] }] }),
    ).toBe('')
  })
})

describe('buildWindowSql', () => {
  it('LIMIT/OFFSET from page + size, with where/order', () => {
    expect(buildWindowSql('_qb_result_t1', COLS, view({ page: 3, pageSize: 50 })))
      .toBe('SELECT * FROM "_qb_result_t1" LIMIT 50 OFFSET 100')
    expect(buildWindowSql('_qb_result_t1', COLS, view({
      page: 1, pageSize: 100, sorts: [{ col: 'amount', dir: 'desc' }], search: 'q',
    }))).toBe(
      `SELECT * FROM "_qb_result_t1" WHERE ("id"::VARCHAR ILIKE '%q%' ESCAPE '\\' OR ` +
      `"name"::VARCHAR ILIKE '%q%' ESCAPE '\\' OR "amount"::VARCHAR ILIKE '%q%' ESCAPE '\\' OR ` +
      `"day"::VARCHAR ILIKE '%q%' ESCAPE '\\') ORDER BY "amount" DESC LIMIT 100 OFFSET 0`,
    )
  })
})

describe('buildCountSql', () => {
  it('count over the table with the same where (no order/limit)', () => {
    expect(buildCountSql('_qb_result_t1', COLS, view({})))
      .toBe('SELECT count(*) AS n FROM "_qb_result_t1"')
    expect(buildCountSql('_qb_result_t1', ['a'], view({ search: 'q' })))
      .toBe(`SELECT count(*) AS n FROM "_qb_result_t1" WHERE ("a"::VARCHAR ILIKE '%q%' ESCAPE '\\')`)
  })
})

describe('buildEffectiveSql', () => {
  it('wraps the user sql (trailing ; stripped) with where + order', () => {
    expect(buildEffectiveSql('SELECT * FROM t;', ['a'], view({
      sorts: [{ col: 'a', dir: 'asc' }], search: 'q',
    }))).toBe(
      `SELECT * FROM (\nSELECT * FROM t\n) WHERE ("a"::VARCHAR ILIKE '%q%' ESCAPE '\\') ORDER BY "a" ASC`,
    )
  })
})

describe('buildWidgetSql', () => {
  it('wraps the widget sql with a cap+1 LIMIT (cap+1 signals truncation)', () => {
    expect(buildWidgetSql('SELECT * FROM t;', 100)).toBe('SELECT * FROM (\nSELECT * FROM t\n) LIMIT 101')
  })
  it('defaults to WIDGET_ROW_CAP', () => {
    expect(buildWidgetSql('SELECT 1')).toContain(`LIMIT ${WIDGET_ROW_CAP + 1}`)
  })
})
