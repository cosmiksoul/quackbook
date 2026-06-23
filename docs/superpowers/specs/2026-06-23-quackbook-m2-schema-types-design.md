# quackbook — Дизайн вехи M2 «Схема и типы»

- **Дата:** 2026-06-23
- **Статус:** утверждён к реализации (брейншторминг завершён, переход к плану)
- **Источник скоупа:** `docs/scope-quackbook-v1.md` + `docs/superpowers/specs/2026-06-22-quackbook-delivery-design.md` (дорожная карта)
- **Правила:** `CLAUDE.md`
- **Предшествует:** M1 (режим исследования) — задеплоен, смерджен в `main`.

## Контекст и цель

M2 превращает сырые `all_varchar` CSV-таблицы (baseline из M1) в **безопасно типизированные**. Слой данных — edge проекта; M2 наращивает его типизацией поверх готового цикла исследования.

Поверхность — **рейл-якорная** (из мокапа `docs/Screenshot 2026-06-22 214921.png`): в шапке схемы кнопка **«типы»**, тип у каждой колонки (`VARCHAR`/`DATE`/`DOUBLE`), маркер **✎** на редактируемой колонке, маркер **⚠** на колонке с потерями каста (`revenue DOUBLE ⚠`).

Депт-фёрст: M2 — один полный слой (типизация) поверх M1, остаётся задеплоенной и демонстрируемой. Parquet уже несёт родные типы — в M2 **не типизируем** (только CSV).

## Принятые решения

1. **Поверхность — рейл-якорная** (мокап). Шапка схемы: кнопка **«типы»** (one-click) + **«применить»** (видна, когда есть нестейдженные правки). Колонка: имя · тип · маркеры ✎ (открыть поповер правки) и ⚠ N (тултип «N → NULL»). Правка колонки — плавающий **поповер** (~280px, не зажат шириной рейла 260px), **не** модалка и не отдельный экран.

2. **Инференс на загрузке.** При load CSV сразу считается `sniff_csv`-инференс → предложенные типы хранятся в `Dataset.suggested`. Данные при этом остаются `all_varchar` baseline (безопасно). Кнопка **«типы»** одним кликом ставит конфиг = предложениям и применяет (соответствует «one-click типы» из скоупа).

3. **Модель материализации — неизменная сырая таблица как источник каста (вариант A).** На load CSV: `_qb_raw_<t>` (all_varchar) **и** `<t>` (TABLE-копия, изначально all_varchar baseline). На каждый apply: `CREATE OR REPLACE TABLE "<t>" AS SELECT <касты> FROM "_qb_raw_<t>"`. Даёт стабильный пере-каст в любой тип и честный подсчёт N→NULL (сравнение raw↔typed). Цена — ~2× памяти на CSV; для локальных файлов v1 приемлемо. `_qb_raw_*` — внутренние, фильтруются из списка источников, схемы и (будущего) автокомплита.
   - **Отвергнуто (вариант B):** перечитывать исходный `File` на каждый apply — медленнее (повторный парс CSV), не проще.
   - Parquet: модель A **не** применяется — Parquet грузится как одна таблица с родными типами (поведение M1 без изменений), без raw и без ре-материализации.

4. **Глубина типов — прагматичный охват скоупа.** Per-column: тип, rename, include/exclude; для DATE/TIMESTAMP — опциональный strptime-формат (по умолчанию авто `TRY_CAST` ISO); для чисел — тогл десятичного разделителя (точка/запятая); один nullstr-токен (значение → NULL). Покрывает «формат даты/decimal, nullstr» из скоупа без раздувания в ETL. Набор типов: `VARCHAR`, `BIGINT`, `DOUBLE`, `DATE`, `TIMESTAMP`, `BOOLEAN`.

5. **`TRY_CAST`-only (без жёстких кастов).** Любой каст — через `TRY_CAST` / `try_strptime` (возвращают NULL на провале, не падают). Провал каста — **не ошибка, а фича-счётчик** ⚠ N→NULL.

## Скоуп-лок

**В M2:**
- Инференс `sniff_csv` при загрузке CSV → предложенные типы.
- Кнопка **«типы»**: one-click применяет все предложенные типы.
- **Редактор схемы** (поповер на колонке): тип, rename, include/exclude, формат даты (strptime), десятичный разделитель, nullstr-токен.
- **Материализация / ре-материализация** через `CREATE OR REPLACE TABLE ... AS SELECT TRY_CAST(...)` из сырой таблицы; кнопка **«применить»**.
- **Счётчик «N → NULL»** на колонку (маркер ⚠ + число).

**Отложено / вне M2:**
- Профиль (`SUMMARIZE`, топ-значения, гистограммы), вкладка `профиль`, кнопка `профиль источника` — **M3**.
- `закрепить в отчёт`, `сохранить` — M4/M5.
- Автокомплит SQL по схеме (nice-to-have).
- Типизация Parquet (родные типы достаточны).

**Firewall (вне v1 — не строим):**
- Правка значений per-cell.
- Деривативные / вычисляемые колонки в редакторе схемы (только пере-типизация / rename / include-exclude существующих).
- Множественные null-токены, `DECIMAL(precision, scale)`, набор date-локалей (это «богатый ETL» — сознательно не берём).

## Архитектура — модули и файлы

Зоны из дизайна деливери (`db/`, `core/`, `state/`, `features/`+`components/`).

| Зона | Файл | Статус | Ответственность |
|---|---|---|---|
| `core/` | `schemaTypes.ts` | новый | Тип `ColumnConfig`; `parseInferredColumns(arrow)` + `suggestTypes`; маппинг DuckDB-типов в наш набор. |
| `core/` | `castBuilder.ts` | новый | `buildCastExpr(cfg)`, `buildMaterializeDDL(table, rawTable, cfgs)`, `buildNullLossQuery(rawTable, cfgs)` + интерпретация результата. Чистые строкобилдеры (TDD). |
| `core/` | `sql.ts` | расширить | переиспользуем `quoteIdent`/`quoteLiteral`; `+rawTableName(table)` (`_qb_raw_<t>`); `+isInternalTable(name)`. |
| `db/` | `duckdbClient.ts` | расширить | `+sniffCsv(virtualFile) → Arrow`; `+exec(sql)` (DDL: `CREATE OR REPLACE TABLE`); CSV-load переписан на raw+typed; `describeTable` переиспользуется после apply. |
| `state/` | `session.ts` | расширить | `Dataset` += `rawTable`, `suggested`, `schemaConfig`, `dirty`; колонки получают `nullLoss`. Действия `inferAndApply`, `stageColumn`, `resetColumn`, `setApplied`. Чистая часть логики — в `core`. |
| `features/` | `Rail.tsx` | расширить | шапка схемы: «типы» + «применить»; колонки: маркеры ✎/⚠; открыть поповер. Источники/pruning — без изменений (M1). |
| `features/` | `useSchemaActions.ts` | новый | оркестрация apply: `core`-билдеры → `db.exec`/`db.query` → `describeTable` → store. Side-effects здесь, не в сторе и не в `db`. |
| `components/` | `SchemaColumnEditor.tsx` | новый | поповер правки колонки (тип, rename, include, условно date-формат / разделитель / nullstr). |

**Новых внешних зависимостей нет** (всё на текущем стеке M1; поповер — лёгкий self-rolled на CSS, без либы).

## Стейт (Zustand)

```ts
type ColType = 'VARCHAR' | 'BIGINT' | 'DOUBLE' | 'DATE' | 'TIMESTAMP' | 'BOOLEAN'

interface ColumnConfig {
  origName: string          // имя в сырой таблице (неизменно)
  name: string              // целевое имя (rename); по умолчанию = origName
  type: ColType
  include: boolean          // false → колонка не выносится в типизированную таблицу
  dateFormat?: string       // strptime-паттерн для DATE/TIMESTAMP (опц.)
  decimalSep?: ','          // ',' → десятичная запятая (для BIGINT/DOUBLE)
  nullToken?: string        // строковое значение, трактуемое как NULL
}

// Dataset (расширение M1):
interface Dataset {
  table: string
  fileName: string
  bytes: number
  kind: 'csv' | 'parquet'
  columns: { name: string; type: string; nullLoss?: number }[]  // ПРИМЕНЁННАЯ схема (из DESCRIBE) + потери
  // --- M2, только для kind==='csv' ---
  rawTable?: string                 // '_qb_raw_<t>'
  suggested?: { name: string; type: ColType }[]  // инференс при загрузке
  schemaConfig?: ColumnConfig[]     // желаемая конфигурация (редактируется)
  dirty?: boolean                   // schemaConfig != последней применённой
}
```

**Действия стора (чистые):** `setColumnConfig(table, cfgs)` (заменить конфиг целиком — «типы» ставит его = `suggested`); `stageColumn(table, cfg)` (правка одной колонки → dirty=true); `resetColumn(table, origName)` (вернуть к baseline/suggested); `setApplied(table, columns, losses)` (после материализации: обновить `columns`+`nullLoss`, dirty=false). Оркестрация apply (db-вызовы) живёт в `useSchemaActions`, **не** в сторе. Детерминированность сохраняется (без `Math.random`/`Date.now`).

`schemaConfig` инициализируется на load из baseline (все `VARCHAR`, `include=true`, `name=origName`) — рейл показывает M1-состояние, пока не нажали «типы»/«применить».

## Поток данных

drop CSV → `registerFile` → `read_csv(..., all_varchar=true)` в `_qb_raw_<t>` → `CREATE OR REPLACE TABLE <t> AS SELECT * FROM _qb_raw_<t>` (baseline) → `sniffCsv` → `parseInferredColumns` → `addDataset` (suggested + schemaConfig baseline). Рейл показывает схему `<t>` (все VARCHAR).

**«типы»** → `useSchemaActions.applyInferred(table)`: `setColumnConfig(table, suggested)` → `apply(table)`. Сам `apply(table)`:
1. `buildMaterializeDDL(table, rawTable, cfgs)` → `db.exec`.
2. `buildNullLossQuery(rawTable, cfgs)` → `db.query` → интерпретация → потери на колонку.
3. `describeTable(table)` → новые типы.
4. `setApplied(table, columns, losses)` → рейл показывает типы + ⚠.

**Правка колонки** (поповер) → `stageColumn` (dirty) → кнопка **«применить»** → тот же `apply(table)`.

Открытые табы после apply просто пере-ранятся (`SELECT … FROM <t>` уже с новыми типами; имя таблицы не меняется). Reset (M1) дропает и `<t>`, и `_qb_raw_<t>`.

## Билдеры `core/` (сердце TDD)

**`buildCastExpr(cfg) → string`** (для одной включённой колонки):
1. `v = quoteIdent(cfg.origName)`.
2. nullstr: если `cfg.nullToken != null` → `v = nullif(v, quoteLiteral(cfg.nullToken))`.
3. по типу:
   - `VARCHAR` → `v` (passthrough, без каста);
   - `BIGINT`/`DOUBLE` → если `decimalSep===','`: `num = replace(v, ',', '.')`, иначе `num = v`; → `TRY_CAST(num AS <type>)`;
   - `DATE` → `dateFormat` задан: `CAST(try_strptime(v, '<fmt>') AS DATE)`, иначе `TRY_CAST(v AS DATE)`;
   - `TIMESTAMP` → `dateFormat` задан: `try_strptime(v, '<fmt>')`, иначе `TRY_CAST(v AS TIMESTAMP)`;
   - `BOOLEAN` → `TRY_CAST(v AS BOOLEAN)`.
4. → `<expr> AS quoteIdent(cfg.name)`.

**`buildMaterializeDDL(table, rawTable, cfgs) → string`:**
`CREATE OR REPLACE TABLE quoteIdent(table) AS SELECT <castExpr по include=true, порядок сохранён> FROM quoteIdent(rawTable)`. UI гарантирует ≥1 включённую колонку (иначе билдер кидает — пустой SELECT невалиден).

**`buildNullLossQuery(rawTable, cfgs) → {sql, columns}`** — один проход. Для каждой включённой **не-VARCHAR** колонки:
- `present = "<orig>" IS NOT NULL AND "<orig>" <> ''` (+ `AND "<orig>" <> quoteLiteral(nullToken)`, если задан — токен-NULL намеренный, не потеря);
- `lost = present AND (<castExpr>) IS NULL`;
- `SELECT sum(CASE WHEN <lost_i> THEN 1 ELSE 0 END) AS l<i>, … FROM rawTable`.
VARCHAR-колонки пропускаются (каста нет → потерь нет). Интерпретация: строка результата `l0…ln` → `nullLoss` на колонку. ⚠ показываем при `>0`.

**`parseInferredColumns(arrow) → {name, type: ColType}[]`** — парс результата инференса (`sniff_csv` или `DESCRIBE`); маппинг DuckDB-типов: `BIGINT/INTEGER/HUGEINT→BIGINT`, `DOUBLE/FLOAT/DECIMAL→DOUBLE`, `DATE→DATE`, `TIMESTAMP*→TIMESTAMP`, `BOOLEAN→BOOLEAN`, прочее→`VARCHAR`.

## Обработка ошибок (минимум, CLAUDE.md rule 2)

- Сбой `sniff_csv` → сообщение, остаёмся на `all_varchar` baseline (suggested пустой, «типы» = no-op).
- `TRY_CAST`→NULL — **не ошибка**, а счётчик ⚠.
- Ошибка DDL/запроса из DuckDB → текст в поверхности рейла (не падаем).
- Никакой спекулятивной обработки под несуществующие сценарии.

## Стратегия тестирования (Vitest, TDD)

Red-green-refactor для всей логики `core/` и `state/`.

- **core `castBuilder`:** `buildCastExpr` — каждый тип; DATE/TIMESTAMP с форматом и без; десятичная запятая; nullstr; rename; VARCHAR-passthrough; экранирование. `buildMaterializeDDL` — include/exclude, порядок, ≥1 колонка (иначе throw). `buildNullLossQuery` — present-условие (пусто/токен исключаются), пропуск VARCHAR, интерпретация строки `l0…ln`.
- **core `schemaTypes`:** `parseInferredColumns` (маппинг типов, фолбэк VARCHAR), `suggestTypes`.
- **state:** `inferAndApply` (config := suggested), `stageColumn` (dirty), `setApplied` (columns+losses, dirty=false).
- **db (smoke, Node):** грузим «грязный» CSV (числа с запятой, плохие даты, токен `NA`) → raw all_varchar → материализация типов → `DESCRIBE` показывает новые типы → loss-запрос даёт ожидаемые потери.
- **точечно RTL:** «типы» обновляет типы в рейле; правка в поповере + «применить» меняет тип; ⚠ появляется при `loss>0`.
- Презентация (CSS, поповер, раскладка) — глазами (честная граница CLAUDE.md).

## Порядок сборки — два внутренних среза

Каждый срез задеплоен и демонстрируем. Точная нарезка на задачи — в плане (writing-plans).

- **Срез 1 — типизация-ядро + one-click.** Раздел CSV-load на `_qb_raw_<t>`+`<t>`; инференс `sniff_csv`; билдеры `castBuilder`/`schemaTypes` (TDD); `db.exec`/`sniffCsv`; `useSchemaActions.apply`; кнопка **«типы»** в рейле; ⚠-счётчик; типы в схеме рейла. **Демо:** грязный CSV → «типы» → типы появились, ⚠ на лоссовых колонках, запрос типизированной таблицы.
- **Срез 2 — ручной редактор.** `SchemaColumnEditor` (поповер: тип/rename/include/date-формат/разделитель/nullstr) + стейджинг (`stageColumn`/`dirty`) + кнопка **«применить»** + ре-материализация. **Демо:** меняю тип/формат колонки, применяю — типы и ⚠ пересчитались.

## Готово, когда (критерий вехи)

Гружу «грязный» CSV → вижу инференс; жму «типы» — таблица типизируется, на колонках с неудачными кастами вижу счётчик N→NULL (⚠); меняю тип/формат/include колонки в поповере, жму «применить» — схема ре-материализуется, типы и ⚠ обновились; запрашиваю типизированную таблицу из таба, результат уже в правильных типах. На задеплоенном Pages-URL всё работает; reload → пустое состояние.

## Расхождения со скоупом/мокапом (зафиксированы)

- **Parquet не типизируется** в M2 (родные типы достаточны); модель raw+typed — только для CSV.
- **Глубина форматов** — прагматичная (один strptime-формат, тогл разделителя, один nullstr-токен); множественные null-токены / `DECIMAL(p,s)` / локали — вне M2 (см. firewall).
- **Маркер ✎** в мокапе трактуем как «колонка редактируема / открыть поповер»; **⚠** — «N значений → NULL при касте».

## Открытые мелочи / риски

- Точная функция инференса (`sniff_csv` с разбором поля `Columns` vs `DESCRIBE SELECT * FROM read_csv(..., auto_detect=true)`) — выверить на скаффолде среза 1; `parseInferredColumns` тестируется на представительном Arrow-результате независимо от выбора.
- `CREATE OR REPLACE TABLE` + `_qb_raw_*` фильтрация — проверить на скаффолде, что внутренние таблицы не протекают в источники/схему.
- ~2× памяти на CSV (raw+typed) — принятый компромисс v1; оптимизация (view-до-первой-типизации) — возможна позже, в спек не берём ради простоты и единообразия DDL.
- `try_strptime` доступна в DuckDB-WASM 1.32 — подтвердить на smoke-тесте среза 1 (фолбэк: `strptime` в `TRY`-обёртке).
