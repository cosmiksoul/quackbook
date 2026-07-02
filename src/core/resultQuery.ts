import { quoteIdent, quoteLiteral, stripTrailingSemicolon } from './sql'

export type SortDir = 'asc' | 'desc'
export interface SortSpec { col: string; dir: SortDir }

export type ColumnFilter =
  | { col: string; type: 'text'; op: 'contains' | 'equals' | 'startsWith'; value: string }
  | { col: string; type: 'null'; op: 'isNull' | 'notNull' }
  | { col: string; type: 'number'; min: number | null; max: number | null }
  | { col: string; type: 'date'; min: string | null; max: string | null }
  | { col: string; type: 'set'; values: string[]; includeNull?: boolean }

export interface ResultView {
  page: number // 1-based
  pageSize: number
  sorts: SortSpec[]
  search: string
  filters: ColumnFilter[]
}

export const PAGE_SIZES = [10, 20, 50, 100]
export const CHART_CAP = 5000
export const DEFAULT_VIEW: ResultView = { page: 1, pageSize: 50, sorts: [], search: '', filters: [] }

/** Escape LIKE wildcards (\ % _) so search text is matched literally; used with ESCAPE '\'. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/** `col::VARCHAR ILIKE '%<escaped>%' ESCAPE '\'` — a case-insensitive literal-contains. */
function likeContains(col: string, text: string): string {
  return `${quoteIdent(col)}::VARCHAR ILIKE ${quoteLiteral('%' + escapeLike(text) + '%')} ESCAPE '\\'`
}

export function buildOrderBy(sorts: SortSpec[]): string {
  if (sorts.length === 0) return ''
  return 'ORDER BY ' + sorts.map((s) => `${quoteIdent(s.col)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`).join(', ')
}

function globalSearch(columns: string[], search: string): string | null {
  const q = search.trim()
  if (q === '') return null
  return '(' + columns.map((c) => likeContains(c, q)).join(' OR ') + ')'
}

function columnPredicate(f: ColumnFilter): string | null {
  const col = quoteIdent(f.col)
  if (f.type === 'text') {
    if (f.value === '') return null
    const esc = quoteLiteral((f.op === 'startsWith' ? '' : '%') + escapeLike(f.value) + '%')
    if (f.op === 'equals') return `(${col}::VARCHAR = ${quoteLiteral(f.value)})`
    return `(${col}::VARCHAR ILIKE ${esc} ESCAPE '\\')`
  }
  if (f.type === 'null') return `(${col} IS ${f.op === 'isNull' ? 'NULL' : 'NOT NULL'})`
  if (f.type === 'number') {
    const parts: string[] = []
    if (Number.isFinite(f.min)) parts.push(`${col} >= ${f.min}`)
    if (Number.isFinite(f.max)) parts.push(`${col} <= ${f.max}`)
    return parts.length ? `(${parts.join(' AND ')})` : null
  }
  if (f.type === 'date') {
    const parts: string[] = []
    if (f.min) parts.push(`${col} >= ${quoteLiteral(f.min)}`)
    // «до» включительно: `<= 'YYYY-MM-DD'` сравнивал бы с полуночью и отрезал
    // весь последний день у TIMESTAMP — сравниваем строго со следующим днём.
    if (f.max) parts.push(`${col} < ${quoteLiteral(f.max)}::DATE + INTERVAL 1 DAY`)
    return parts.length ? `(${parts.join(' AND ')})` : null
  }
  // set: NULL не ловится через IN (NULL IN (...) -> NULL) — отдельный IS NULL.
  const inList = f.values.length
    ? `${col}::VARCHAR IN (${f.values.map((v) => quoteLiteral(v)).join(', ')})`
    : null
  const nullPred = f.includeNull ? `${col} IS NULL` : null
  const parts = [inList, nullPred].filter(Boolean)
  return parts.length ? `(${parts.join(' OR ')})` : null
}

export function buildWhere(columns: string[], view: ResultView): string {
  const clauses: string[] = []
  const gs = globalSearch(columns, view.search)
  if (gs) clauses.push(gs)
  for (const f of view.filters) {
    const p = columnPredicate(f)
    if (p) clauses.push(p)
  }
  return clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
}

/** `SELECT * FROM <table> [WHERE ...] [ORDER BY ...] LIMIT size OFFSET (page-1)*size`. */
export function buildWindowSql(table: string, columns: string[], view: ResultView): string {
  const where = buildWhere(columns, view)
  const order = buildOrderBy(view.sorts)
  const offset = (Math.max(1, view.page) - 1) * view.pageSize
  return [`SELECT * FROM ${quoteIdent(table)}`, where, order, `LIMIT ${view.pageSize} OFFSET ${offset}`]
    .filter(Boolean).join(' ')
}

/** `SELECT count(*) AS n FROM <table> [WHERE ...]` — the (filtered) total. */
export function buildCountSql(table: string, columns: string[], view: ResultView): string {
  const where = buildWhere(columns, view)
  return [`SELECT count(*) AS n FROM ${quoteIdent(table)}`, where].filter(Boolean).join(' ')
}

/** Portable copy-as-SQL: wrap the user's original query + the active view's where/order. */
export function buildEffectiveSql(userSql: string, columns: string[], view: ResultView): string {
  const select = stripTrailingSemicolon(userSql)
  const where = buildWhere(columns, view)
  const order = buildOrderBy(view.sorts)
  return [`SELECT * FROM (\n${select}\n)`, where, order].filter(Boolean).join(' ')
}

/** Кап строк, который виджет отчёта готов материализовать в JS-объекты. */
export const WIDGET_ROW_CAP = 5000

/** Обернуть сохранённый SQL виджета: не больше cap+1 строк (cap+1 — сигнал усечения). */
export function buildWidgetSql(sql: string, cap = WIDGET_ROW_CAP): string {
  return `SELECT * FROM (\n${stripTrailingSemicolon(sql)}\n) LIMIT ${cap + 1}`
}
