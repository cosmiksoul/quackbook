import type { QueryResult } from '../core/arrowToRows'

interface Props {
  result: QueryResult
}

// bigint cannot be rendered/serialized directly (JSON.stringify throws on it);
// stringify any bigint cell. DuckDB BIGINT/COUNT/SUM surface as bigint.
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  return String(value)
}

export function ResultTable({ result }: Props) {
  return (
    <table className="data">
      <thead>
        <tr>
          {result.columns.map((c) => (
            <th key={c.name}>{c.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => (
          <tr key={i}>
            {result.columns.map((c) => (
              <td key={c.name}>{formatCell(row[c.name])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
