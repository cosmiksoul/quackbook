/** Quote a SQL identifier (double-quote, escaping embedded double-quotes). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Quote a SQL string literal (single-quote, escaping embedded single-quotes). */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Build `SELECT * FROM <table> LIMIT <limit>`; table identifier is quoted. */
export function buildSelectAll(table: string, limit = 100): string {
  return `SELECT * FROM ${quoteIdent(table)} LIMIT ${limit}`
}

/** Derive a safe SQL identifier from a file name (strip extension, sanitize). */
export function tableNameFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '') // strip last extension
  let ident = base.replace(/[^A-Za-z0-9_]/g, '_') // invalid chars -> _
  if (ident === '') return 'table'
  if (/^[0-9]/.test(ident)) ident = `_${ident}` // identifiers cannot start with a digit
  return ident
}

/** Make `desired` unique against `taken` by appending _1, _2, ...
 *  Регистронезависимо: каталог DuckDB резолвит имена case-insensitively. */
export function uniqueTableName(desired: string, taken: string[]): string {
  const low = new Set(taken.map((t) => t.toLowerCase()))
  if (!low.has(desired.toLowerCase())) return desired
  let i = 1
  while (low.has(`${desired.toLowerCase()}_${i}`)) i++
  return `${desired}_${i}`
}

/** `SELECT * FROM <table>` (unbounded) — the seed query for a dataset tab. */
export function buildSelectStar(table: string): string {
  return `SELECT * FROM ${quoteIdent(table)}`
}

/** DDL: materialize a registered CSV as an all-VARCHAR baseline table. */
export function buildLoadCsv(virtualFile: string, table: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM read_csv_auto(${quoteLiteral(virtualFile)}, all_varchar = true)`
}

/** DDL: materialize a registered Parquet file as a typed table. */
export function buildLoadParquet(virtualFile: string, table: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdent(table)} AS SELECT * FROM read_parquet(${quoteLiteral(virtualFile)})`
}

/** Introspection: DuckDB DESCRIBE gives DuckDB type names (VARCHAR, DATE, ...). */
export function buildDescribe(table: string): string {
  return `DESCRIBE ${quoteIdent(table)}`
}

/** Reset helper: drop a table if present. */
export function buildDropTable(table: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(table)}`
}

/** Internal prefix for the immutable all-VARCHAR cast-source table (model A). */
const RAW_PREFIX = '_qb_raw_'

/** Name of the immutable raw cast-source table for a user table. */
export function rawTableName(table: string): string {
  return `${RAW_PREFIX}${table}`
}

/** Internal prefix for a per-tab materialized result table (M3). */
const RESULT_PREFIX = '_qb_result_'

/** True for tables quackbook owns internally (filtered from sources/schema). */
export function isInternalTable(name: string): boolean {
  return name.startsWith(RAW_PREFIX) || name.startsWith(RESULT_PREFIX)
}

/** DDL: materialize a registered CSV as the immutable all-VARCHAR raw table. */
export function buildLoadCsvRaw(virtualFile: string, rawTable: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdent(rawTable)} AS SELECT * FROM read_csv_auto(${quoteLiteral(virtualFile)}, all_varchar = true)`
}

/** Introspection: DuckDB's inferred (native) schema for a registered CSV. */
export function buildSniffCsv(virtualFile: string): string {
  return `DESCRIBE SELECT * FROM read_csv_auto(${quoteLiteral(virtualFile)}, sample_size = -1)`
}

/** DDL: (re)create `dest` as a verbatim SELECT * copy of `src` (both quoted). */
export function buildCloneTable(dest: string, src: string): string {
  return `CREATE OR REPLACE TABLE ${quoteIdent(dest)} AS SELECT * FROM ${quoteIdent(src)}`
}

/** Internal name of the materialized result table for a tab. */
export function resultTempName(tabId: string): string {
  return `${RESULT_PREFIX}${tabId}`
}

/** Strip ONE trailing `;` (+ whitespace): wrapping `... AS <select>;` with the
 *  semicolon inside is invalid SQL. */
export function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '').trim()
}

/**
 * DDL: materialize a tab's query result into a REGULAR (catalog-global) internal
 * table so it can be profiled by name (reusing profileRelation). NOT a TEMP
 * table: DuckDBClient opens a fresh connection per call and a TEMP table is
 * connection-local, so SUMMARIZE on the next connection would not see it. A
 * regular CREATE OR REPLACE TABLE survives across connections (same mechanism as
 * _qb_raw_*) and is overwritten per tab. The table inherits DuckDB's real
 * inferred types. A trailing `;` (and surrounding whitespace) is stripped — a
 * CREATE ... AS <select>; with the semicolon inside would be invalid.
 */
export function buildResultTempDDL(tabId: string, sql: string): string {
  const select = stripTrailingSemicolon(sql)
  return `CREATE OR REPLACE TABLE ${quoteIdent(resultTempName(tabId))} AS ${select}`
}
