import { quoteIdent, isInternalTable, stripTrailingSemicolon } from './sql'

export type MartKind = 'view' | 'table'

/** DDL: (re)create a mart as a live VIEW or a snapshot TABLE over a query. */
export function buildCreateMart(name: string, sql: string, kind: MartKind): string {
  const object = kind === 'view' ? 'VIEW' : 'TABLE'
  return `CREATE OR REPLACE ${object} ${quoteIdent(name)} AS ${stripTrailingSemicolon(sql)}`
}

/** DDL: drop a mart (idempotent). */
export function buildDropMart(name: string, kind: MartKind): string {
  const object = kind === 'view' ? 'VIEW' : 'TABLE'
  return `DROP ${object} IF EXISTS ${quoteIdent(name)}`
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Validate a mart name. Returns an inline error message (Russian) or null when
 * valid. Rules: non-empty after trim; a simple identifier (latin/digit/_, not
 * leading digit) so it needs no quoting in hand-written SQL / autocomplete;
 * not an internal quackbook table; not already taken by a dataset/mart.
 */
export function validateMartName(name: string, taken: string[]): string | null {
  const n = name.trim()
  if (n === '') return 'Введите имя витрины'
  if (!NAME_RE.test(n)) return 'Только латиница, цифры и _ (не с цифры)'
  if (isInternalTable(n)) return 'Это имя зарезервировано'
  if (taken.some((t) => t.toLowerCase() === n.toLowerCase())) return `Имя «${n}» уже занято`
  return null
}
