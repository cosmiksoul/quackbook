# M7a «Витрины» — дизайн

**Статус:** дизайн согласован (brainstorm 2026-07-01), готов к плану.
**Веха:** M7a. M7 разбита на два независимых спека: **M7a «Витрины»** (этот, слой данных) → **M7b «Исполняемые ячейки»** (Colab-стиль код-ячейки в отчёте, отдельный цикл позже).
**Источник скоупа:** `docs/scope-quackbook-v1.md` + `docs/superpowers/specs/2026-06-22-quackbook-delivery-design.md`. Витрины — пост-v1 расширение слоя данных, углубляют существующий цикл, firewall не пересекают.

## Что строим

Витрина — сохранённый под именем результат запроса, доступный как переиспользуемый датасет: появляется в рейле, подхватывается автокомплитом, на неё можно ссылаться из других табов (`SELECT … FROM моя_витрина`). Создаётся из панели результата в Исследовании одной кнопкой.

Пользовательский цикл: в Исследовании отработал запрос → результат-таблица → **«+ витрина»** → имя + выбор VIEW/TABLE → витрина в рейле, доступна везде.

## Решения (из брейншторма)

1. **VIEW или материализованная TABLE — обе, выбор при создании.** VIEW = живая (хранит текст запроса, пересчитывается при обращении, всегда свежая, нулевой расход памяти). TABLE = снапшот результата (быстрый доступ, устаревает, дублирует данные в памяти, обновляется вручную).
2. **Сессионные (эфемерные).** Витрины живут до reload/Reset, потом исчезают. Персиста определений нет (согласуется с «данные не персистятся»; OPFS вырезан осознанно). Регидрация витрин — вне M7a (кандидат на позже, если понадобится).
3. **Витрина = расширенный `Dataset`.** Переиспользуем рейл + автокомплит + профиль. Дискриминант — `kind`.
4. **Без проактивного трекинга зависимостей.** Сломал источник — зависимая витрина ругнётся при обращении (существующий error-путь). Это осознанно.

## Не-цели (firewall)

- Не персист витрин между сессиями (эфемерно; см. решение 2).
- Не проактивный каскад при удалении источника (см. решение 4).
- Не визуальный конструктор витрин / drag-drop — только SQL + кнопка.
- Не правка значений, не деривативные колонки в редакторе схемы (firewall). Витрина — это `CREATE VIEW/TABLE AS <SQL>`, чистая SQL-композиция (join/union в скоупе).
- Не таб «План»/EXPLAIN.

## Модель данных

Расширяем `Dataset` (`src/state/session.ts`):

```ts
export interface Dataset {
  table: string
  fileName: string          // для витрин = имя витрины (рейл его же показывает)
  bytes: number             // для витрин = 0
  kind: 'csv' | 'parquet' | 'view' | 'table'   // <- расширено
  columns: { name: string; type: string; nullLoss?: number }[]
  martSql?: string          // <- новое: исходный SQL витрины (для refresh table-витрин)
  // ...существующие опциональные поля M2/M3 (rawTable/schemaConfig/suggested/profile/...)
}
```

- `kind: 'view' | 'table'` — единственный дискриминант витрины. Хелпер `isMart(ds) = ds.kind === 'view' || ds.kind === 'table'`.
- Витрины нативно типизированы (как parquet): без `rawTable`/`schemaConfig`/`suggested`. `kind === 'csv'` остаётся **единственным** триггером редактора схемы → витрины его не показывают даром.
- `martSql` хранит SQL, из которого создана витрина (нужен для «обновить» у table-витрин; у view refresh не нужен, но поле держим для обоих единообразно и для возможной инспекции).

## Ядро — `src/core/mart.ts` (TDD)

Чистые строители DDL + валидация. Переиспользуют `quoteIdent` из `core/sql.ts`.

```ts
export type MartKind = 'view' | 'table'

/** CREATE OR REPLACE {VIEW|TABLE} "name" AS <sql без трейлинг-;>. */
export function buildCreateMart(name: string, sql: string, kind: MartKind): string

/** DROP {VIEW|TABLE} IF EXISTS "name". */
export function buildDropMart(name: string, kind: MartKind): string

/**
 * Валидация имени. Возвращает текст ошибки или null.
 * Правила: непустое (после trim); идентификатор ^[A-Za-z_][A-Za-z0-9_]*$;
 * не коллизит с `taken` (все имена таблиц-датасетов + витрин) и не совпадает
 * с внутренними (isInternalTable). Сравнение имён — как есть (case-sensitive,
 * DuckDB folds unquoted, но мы всегда quoted → точное совпадение).
 */
export function validateMartName(name: string, taken: string[]): string | null
```

- `buildCreateMart` снимает трейлинг-`;` (как `exportQuery`: `sql.trim().replace(/;\s*$/, '').trim()`), затем оборачивает: `CREATE OR REPLACE ${kind==='view'?'VIEW':'TABLE'} ${quoteIdent(name)} AS ${select}`.
- Простой идентификатор (без пробелов/спецсимволов) выбран осознанно: он же — то, что пользователь наберёт в SQL (`FROM моя_витрина`), и то, что уходит в автокомплит. Кириллица допускается? — **нет**, только `[A-Za-z0-9_]` (DuckDB unquoted-идентификаторы + чтобы автокомплит и ручной ввод совпадали без кавычек). Ограничение показываем в подсказке поля.

## Стор — `src/state/session.ts`

- **`removeDataset(table: string)`** — новый экшен: `set((s) => ({ datasets: s.datasets.filter((d) => d.table !== table) }))`. Используется `dropMart`. (Сейчас датасет удаляется только через `reset()`.)
- `addDataset` (существует) — используется `createMart` для добавления витрины.
- `reset()` (существует) чистит `datasets` целиком → витрины тоже уходят (ок).
- Обновление колонок витрины при refresh: `removeDataset(name)` + `addDataset(обновлённый)` — либо точечный `updateDatasetColumns`. **Решение:** delete+add (переиспользуем существующие экшены, без нового; порядок в рейле не критичен для сессионной витрины). Если тесты покажут мигание — заменим на точечный апдейт в плане.

## Оркестрация — `src/features/useMartActions.ts`

Side-effects (по образцу `useSchemaActions`): DDL через `client.exec`, схема через `client.describeTable`, ошибки — в тост/инлайн, не throw наружу.

```ts
export function useMartActions(client: DuckDBClient) {
  // Валидирует, создаёт VIEW/TABLE, читает схему, добавляет в стор.
  // Возвращает ошибку (строку) или null — форма показывает её инлайн.
  async function createMart(name, sql, kind): Promise<string | null>

  // Только для table-витрин: пере-exec CREATE OR REPLACE TABLE, пере-describe,
  // обновить колонки. Для view — no-op (всегда живая).
  async function refreshMart(name): Promise<void>

  // DROP + removeDataset.
  async function dropMart(name): Promise<void>

  return { createMart, refreshMart, dropMart }
}
```

`createMart`:
1. `validateMartName(name, [...datasets.map(d=>d.table)])` → ошибка → вернуть её (форма покажет), DDL не гонять.
2. `await client.exec(buildCreateMart(name, sql, kind))` в try/catch → ошибка exec → вернуть `String(e)`.
3. `const columns = await client.describeTable(name)`.
4. `addDataset({ table: name, fileName: name, bytes: 0, kind, columns, martSql: <stripped sql> })`.
5. вернуть `null` (успех).

## UI

### Кнопка создания — `src/components/ResultPanel.tsx`

Рядом с группой «экспорт в · CSV/Parquet», когда есть `result`: кнопка **«+ витрина»**. Клик → инлайн-форма (локальный `useState` открытия) в шапке панели:
- поле имени (`placeholder="имя_витрины"`, hint «латиница/цифры/_»),
- сегмент-тумблер **VIEW / TABLE** (по умолчанию VIEW — согласно рекомендации «живая по умолчанию»),
- «создать» / «отмена»,
- строка инлайн-ошибки (из `createMart`/валидации).

По «создать»: `const err = await createMart(name, sql, kind)`. `err` → показать в форме, форма открыта. `null` → тост «витрина «N» создана», форма закрыта, поле очищено. SQL — тот же проп `sql`, что использует пин/экспорт (текущий запрос активного таба).

### Секция рейла — `src/features/Rail.tsx`

Новая секция **«ВИТРИНЫ»** под «ИСТОЧНИКИ», рендерится только если есть витрины (`datasets.filter(isMart)`). Каждая:
- имя + бейдж типа **VIEW / TABLE** (стиль `.source-kind`, как CSV/PQ),
- колонки (имя + тип) — существующий рендер (тот же, что у parquet-источника),
- действия: **«профиль»** (переиспользует source-profile: `setProfileTarget({kind:'source', table})` + `profileSource`), **«обновить»** (только `kind==='table'` → `refreshMart`), **«удалить»** (`dropMart`),
- редактора схемы нет (нет `schemaConfig`).

Файловые источники (kind csv/parquet) остаются в «ИСТОЧНИКИ» — секция фильтрует `!isMart`.

### Автокомплит

Даром: `buildSqlSchema(datasets)` уже строится из `datasets` минус `isInternalTable`. Витрины — обычные датасеты → попадают в схему → `FROM моя_витрина` и её колонки подсказываются в любом табе.

## Потоки данных

**Создать:** запрос отработал → «+ витрина» → форма → `createMart` (валидация → exec CREATE → describe → addDataset) → тост → витрина в рейле + автокомплите.

**Сослаться:** в другом табе `SELECT … FROM моя_витрина` → работает (объект в общей in-memory БД; `query()` = свежее соединение, но одна БД; view/table не TEMP → видны во всех соединениях).

**Обновить (table):** «обновить» → `refreshMart` (пере-exec CREATE OR REPLACE TABLE из `martSql` → пере-describe → обновить колонки). View — кнопки нет (всегда живая).

**Удалить:** «удалить» → `dropMart` (DROP IF EXISTS → removeDataset).

## Обработка ошибок

- **Битое/коллизящее имя** → инлайн-ошибка формы, DDL не гоняется.
- **exec упал** (кривой запрос / CREATE не прошёл) → `createMart` вернул `String(e)` → форма показывает, в стор не добавляем.
- **Обращение к витрине с удалённым источником** → DuckDB падает в момент запроса → существующий error-путь панели результата. Проактивного трекинга нет (v1).
- **Refresh при пропавшем источнике** → exec упал → тост «не удалось обновить витрину: …», старый снапшот остаётся (view/table в БД не тронут, т.к. CREATE OR REPLACE упал до замены — либо ловим и не меняем стор).
- **Удаление** → `DROP … IF EXISTS` (идемпотентно; даже если объект уже пропал).
- **Утечка при Reset:** `reset()` чистит стор, но объекты в DuckDB-каталоге остаются до reload. Безвредно (сессионно; повторное создание — `CREATE OR REPLACE`). В v1 не чистим.

## Тесты / TDD-граница

- **TDD (логика), `src/core/mart.test.ts`:** `buildCreateMart` (view/table, снятие трейлинг-`;`, quoting имени), `validateMartName` (пусто, пробел/спецсимвол, ведущая цифра, коллизия с датасетом, коллизия с внутренним `_qb_*`, валидное → null), `buildDropMart` (view/table).
- **TDD (стор), `src/state/session.test.ts`:** `removeDataset` убирает по `table`, не трогает остальные.
- **Node-интеграция, `src/features/mart.integration.test.ts`** (демо-харнес `public/demo/*`, как `exampleQueries.integration.test.ts`): создать view-витрину над `payments` → `SELECT * FROM <view>` в другом запросе даёт строки; создать table-витрину → строки; изменить/пересоздать источник → view отражает, table нет до refresh; refresh table → отражает; drop → последующий `SELECT` падает.
- **Глазами:** форма создания, секция рейла «ВИТРИНЫ», бейджи VIEW/TABLE, тосты.

## Firewall

Чисто. Витрина = `CREATE VIEW/TABLE AS <SQL>` — SQL-композиция (join/union явно в скоупе, scope-файл). НЕ деривативные-колонки-в-редакторе-схемы (line 90), НЕ визуальный join-builder, НЕ персист (OPFS), НЕ EXPLAIN. Рейл/форма — состояния существующих surface'ов, не новые роуты.

## Вне скоупа M7a (кандидаты на потом)

- Персист определений витрин + регидрация (сейчас сессионные).
- Проактивный трекинг/каскад зависимостей при удалении источника.
- Переименование витрины, инспекция/правка её SQL из рейла.
- Чистка DuckDB-каталога при Reset.
- Пин витрины в отчёт напрямую (сейчас: запрос к витрине в табе → пин, как обычно).
