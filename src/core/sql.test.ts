import { describe, expect, it } from 'vitest'
import { buildCloneTable, buildDescribe, buildDropTable, buildLoadCsv, buildLoadCsvRaw, buildLoadParquet, buildResultTempDDL, buildSelectAll, buildSelectStar, buildSniffCsv, isInternalTable, quoteIdent, quoteLiteral, rawTableName, resultTempName, stripTrailingSemicolon, tableNameFromFilename, uniqueTableName } from './sql'

describe('quoteIdent', () => {
  it('double-quotes an identifier', () => {
    expect(quoteIdent('events')).toBe('"events"')
  })
  it('escapes embedded double-quotes', () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"')
  })
})

describe('quoteLiteral', () => {
  it('single-quotes a string literal', () => {
    expect(quoteLiteral('events.csv')).toBe("'events.csv'")
  })
  it('escapes embedded single-quotes', () => {
    expect(quoteLiteral("o'brien.csv")).toBe("'o''brien.csv'")
  })
})

describe('buildSelectAll', () => {
  it('builds a select-all with default limit 100', () => {
    expect(buildSelectAll('events')).toBe('SELECT * FROM "events" LIMIT 100')
  })
  it('honors an explicit limit', () => {
    expect(buildSelectAll('events', 5)).toBe('SELECT * FROM "events" LIMIT 5')
  })
  it('quotes the table identifier', () => {
    expect(buildSelectAll('we"ird')).toBe('SELECT * FROM "we""ird" LIMIT 100')
  })
})

describe('tableNameFromFilename', () => {
  it('strips the extension and keeps a clean base name', () => {
    expect(tableNameFromFilename('events.csv')).toBe('events')
    expect(tableNameFromFilename('orders.parquet')).toBe('orders')
  })
  it('replaces invalid identifier chars with underscores', () => {
    expect(tableNameFromFilename('My Data!.csv')).toBe('My_Data_')
  })
  it('prefixes a leading digit so the identifier is valid', () => {
    expect(tableNameFromFilename('2024.csv')).toBe('_2024')
  })
  it('falls back to "table" when nothing usable remains', () => {
    expect(tableNameFromFilename('.csv')).toBe('table')
    expect(tableNameFromFilename('')).toBe('table')
  })
  it('handles names with multiple dots (only last extension stripped)', () => {
    expect(tableNameFromFilename('a.b.csv')).toBe('a_b')
  })
})

describe('uniqueTableName', () => {
  it('returns the desired name when free', () => {
    expect(uniqueTableName('events', [])).toBe('events')
    expect(uniqueTableName('events', ['orders'])).toBe('events')
  })
  it('suffixes on collision', () => {
    expect(uniqueTableName('events', ['events'])).toBe('events_1')
    expect(uniqueTableName('events', ['events', 'events_1'])).toBe('events_2')
  })
  it('collides case-insensitively (DuckDB catalog is case-insensitive)', () => {
    expect(uniqueTableName('Sales', ['sales'])).toBe('Sales_1')
    expect(uniqueTableName('SALES', ['sales', 'Sales_1'])).toBe('SALES_2')
  })
})

describe('buildSelectStar', () => {
  it('builds an unbounded select-star with a quoted ident', () => {
    expect(buildSelectStar('events')).toBe('SELECT * FROM "events"')
    expect(buildSelectStar('we"ird')).toBe('SELECT * FROM "we""ird"')
  })
})

describe('buildLoadCsv', () => {
  it('creates an all-VARCHAR table from a registered CSV', () => {
    expect(buildLoadCsv('events.csv', 'events')).toBe(
      `CREATE OR REPLACE TABLE "events" AS SELECT * FROM read_csv_auto('events.csv', all_varchar = true)`,
    )
  })
})

describe('buildLoadParquet', () => {
  it('creates a table from a registered Parquet file', () => {
    expect(buildLoadParquet('orders.parquet', 'orders')).toBe(
      `CREATE OR REPLACE TABLE "orders" AS SELECT * FROM read_parquet('orders.parquet')`,
    )
  })
})

describe('buildDescribe', () => {
  it('describes a quoted table', () => {
    expect(buildDescribe('events')).toBe('DESCRIBE "events"')
  })
})

describe('buildDropTable', () => {
  it('drops a quoted table if it exists', () => {
    expect(buildDropTable('events')).toBe('DROP TABLE IF EXISTS "events"')
  })
})

describe('rawTableName', () => {
  it('prefixes the immutable raw cast-source table name', () => {
    expect(rawTableName('events')).toBe('_qb_raw_events')
  })
})

describe('isInternalTable', () => {
  it('flags raw tables as internal', () => {
    expect(isInternalTable('_qb_raw_events')).toBe(true)
  })
  it('treats user tables as not internal', () => {
    expect(isInternalTable('events')).toBe(false)
    expect(isInternalTable('raw_events')).toBe(false)
  })
})

describe('buildLoadCsvRaw', () => {
  it('creates the immutable all-VARCHAR raw table from a registered CSV', () => {
    expect(buildLoadCsvRaw('events.csv', '_qb_raw_events')).toBe(
      `CREATE OR REPLACE TABLE "_qb_raw_events" AS SELECT * FROM read_csv_auto('events.csv', all_varchar = true)`,
    )
  })
})

describe('buildSniffCsv', () => {
  it('describes the inferred (native-typed) schema of a registered CSV', () => {
    expect(buildSniffCsv('events.csv')).toBe(
      `DESCRIBE SELECT * FROM read_csv_auto('events.csv', sample_size = -1)`,
    )
  })
})

describe('buildCloneTable', () => {
  it('clones a source table into a fresh dest table (quoted idents)', () => {
    expect(buildCloneTable('events', '_qb_raw_events')).toBe(
      'CREATE OR REPLACE TABLE "events" AS SELECT * FROM "_qb_raw_events"',
    )
  })
})

describe('resultTempName', () => {
  it('prefixes the internal per-tab result table name', () => {
    expect(resultTempName('tab-3')).toBe('_qb_result_tab-3')
  })
})

describe('isInternalTable (result tables)', () => {
  it('flags result tables as internal too', () => {
    expect(isInternalTable('_qb_result_tab-3')).toBe(true)
  })
  it('still treats user tables as not internal', () => {
    expect(isInternalTable('result_x')).toBe(false)
  })
})

describe('stripTrailingSemicolon', () => {
  it('strips a trailing semicolon and whitespace', () => {
    expect(stripTrailingSemicolon('SELECT 1;')).toBe('SELECT 1')
    expect(stripTrailingSemicolon('  SELECT 1 ;  ')).toBe('SELECT 1')
  })
  it('leaves a clean query untouched', () => {
    expect(stripTrailingSemicolon('SELECT 1')).toBe('SELECT 1')
  })
})

describe('buildResultTempDDL', () => {
  it('CREATE OR REPLACE TABLE (catalog-global, NOT TEMP) from the (trailing-; stripped) select', () => {
    expect(buildResultTempDDL('tab-3', 'SELECT 1')).toBe(
      'CREATE OR REPLACE TABLE "_qb_result_tab-3" AS SELECT 1',
    )
  })
  it('strips a trailing semicolon and surrounding whitespace from the select', () => {
    expect(buildResultTempDDL('tab-3', '  SELECT a FROM t ;  \n')).toBe(
      'CREATE OR REPLACE TABLE "_qb_result_tab-3" AS SELECT a FROM t',
    )
  })
})
