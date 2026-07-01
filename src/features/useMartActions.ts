import { buildCreateMart, buildDropMart, validateMartName, type MartKind } from '../core/mart'
import type { DuckDBClient } from '../db/duckdbClient'
import { useSession } from '../state/session'

/**
 * Mart orchestration (side effects), mirroring useSchemaActions/useProfileActions:
 * DDL via client.exec, schema via client.describeTable, state via add/removeDataset.
 * createMart returns an inline error string or null on success; refresh/drop route
 * failures to a toast (drop still removes from the store — DROP IF EXISTS).
 *
 * martSql is stored as `sql.trim()` (any trailing `;` kept as-is): it is only ever
 * fed back to buildCreateMart, which strips the semicolon — so no separate
 * normalize step is duplicated here.
 */
export function useMartActions(client: DuckDBClient) {
  async function createMart(name: string, sql: string, kind: MartKind): Promise<string | null> {
    const n = name.trim()
    const taken = useSession.getState().datasets.map((d) => d.table)
    const invalid = validateMartName(n, taken)
    if (invalid) return invalid
    try {
      await client.exec(buildCreateMart(n, sql, kind))
      const columns = await client.describeTable(n)
      useSession.getState().addDataset({
        table: n,
        fileName: n,
        bytes: 0,
        kind,
        columns,
        martSql: sql.trim(),
      })
      return null
    } catch (e) {
      return String(e)
    }
  }

  // Only a snapshot TABLE needs refreshing; a VIEW is always live. Re-materialize
  // from martSql, re-read the schema, replace the store entry (drops any stale
  // profile cache with the old dataset object).
  async function refreshMart(name: string): Promise<void> {
    const ds = useSession.getState().datasets.find((d) => d.table === name)
    if (!ds || ds.kind !== 'table' || ds.martSql == null) return
    try {
      await client.exec(buildCreateMart(name, ds.martSql, 'table'))
      const columns = await client.describeTable(name)
      useSession.getState().removeDataset(name)
      useSession.getState().addDataset({
        table: name, fileName: name, bytes: 0, kind: 'table', columns, martSql: ds.martSql,
      })
    } catch (e) {
      useSession.getState().setToast('Не удалось обновить витрину: ' + String(e))
    }
  }

  async function dropMart(name: string): Promise<void> {
    const ds = useSession.getState().datasets.find((d) => d.table === name)
    if (!ds || (ds.kind !== 'view' && ds.kind !== 'table')) return
    try {
      await client.exec(buildDropMart(name, ds.kind))
    } catch {
      // DROP IF EXISTS is idempotent; remove from the store regardless.
    }
    useSession.getState().removeDataset(name)
  }

  return { createMart, refreshMart, dropMart }
}
