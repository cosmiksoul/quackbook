import { quoteIdent, quoteLiteral } from './sql'
import type { ColumnConfig } from './schemaTypes'

/**
 * Build the BARE cast expression for ONE column from the raw (all_varchar)
 * table — no alias. Every cast is TRY_CAST/try_strptime: failures become NULL,
 * never errors. Used directly inside the loss query's CASE, and wrapped with an
 * alias by buildCastExpr for the materialize SELECT list.
 */
export function buildCastValue(cfg: ColumnConfig): string {
  let v = quoteIdent(cfg.origName)
  if (cfg.nullToken != null) {
    v = `nullif(${v}, ${quoteLiteral(cfg.nullToken)})`
  }

  switch (cfg.type) {
    case 'VARCHAR':
      return v
    case 'BIGINT':
    case 'DOUBLE': {
      const num = cfg.decimalSep === ',' ? `replace(${v}, ',', '.')` : v
      return `TRY_CAST(${num} AS ${cfg.type})`
    }
    case 'DATE':
      return cfg.dateFormat
        ? `CAST(try_strptime(${v}, ${quoteLiteral(cfg.dateFormat)}) AS DATE)`
        : `TRY_CAST(${v} AS DATE)`
    case 'TIMESTAMP':
      return cfg.dateFormat
        ? `try_strptime(${v}, ${quoteLiteral(cfg.dateFormat)})`
        : `TRY_CAST(${v} AS TIMESTAMP)`
    case 'BOOLEAN':
      return `TRY_CAST(${v} AS BOOLEAN)`
  }
}

/** Bare cast expression aliased to the column's target name. */
export function buildCastExpr(cfg: ColumnConfig): string {
  return `${buildCastValue(cfg)} AS ${quoteIdent(cfg.name)}`
}
