/**
 * Heuristic: which of `columns` does `sql` read? Identifier-token match, not a
 * full SQL parser — false positives on aliases/literals are acceptable for a
 * rail highlight. `SELECT *` / `t.*` => all columns; `count(*)` => not all.
 */
export function detectUsedColumns(sql: string, columns: string[]): string[] {
  // A select-star is a `*` whose previous non-space char is not '(' (so
  // count(*) is excluded). `e.*` qualifies too (prev char '.').
  let star = false
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] !== '*') continue
    let j = i - 1
    while (j >= 0 && /\s/.test(sql[j])) j--
    if (sql[j] !== '(') {
      star = true
      break
    }
  }
  if (star) return [...columns]

  const tokens = new Set(
    (sql.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []),
  )
  return columns.filter((c) => tokens.has(c.toLowerCase()))
}

/**
 * Heuristic: which of `tableNames` does `sql` reference? Whole identifier-token
 * match (case-insensitive); preserves the order of `tableNames`, not the SQL.
 * Powers the rail showing the schema of every table a query touches.
 */
export function detectReferencedTables(
  sql: string,
  tableNames: string[],
): string[] {
  const tokens = new Set(sql.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [])
  return tableNames.filter((t) => tokens.has(t.toLowerCase()))
}
