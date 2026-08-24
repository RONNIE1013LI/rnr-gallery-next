import pg from "pg";

export type ColumnDefinition = Readonly<{
  name: string;
  dataType: string;
  nullable: boolean;
  default: string | null;
}>;

export type TableDefinition = Readonly<{
  schema: string;
  name: string;
  columns: readonly ColumnDefinition[];
}>;

export type IndexDefinition = Readonly<{
  schema: string;
  table: string;
  name: string;
  definition: string;
}>;

export type ConstraintDefinition = Readonly<{
  schema: string;
  table: string;
  name: string;
  type: string;
  definition: string;
}>;

export type EnumDefinition = Readonly<{
  schema: string;
  name: string;
  values: readonly string[];
}>;

export type SequenceDefinition = Readonly<{
  schema: string;
  name: string;
  dataType: string;
  start: string;
  minimum: string;
  maximum: string;
  increment: string;
  cache: string;
  cycle: boolean;
  owner: string | null;
}>;

export type SchemaCatalog = Readonly<{
  tables: readonly TableDefinition[];
  indexes: readonly IndexDefinition[];
  constraints: readonly ConstraintDefinition[];
  enums: readonly EnumDefinition[];
  sequences: readonly SequenceDefinition[];
}>;

export type CatalogDifference = Readonly<{
  kind: "added" | "removed" | "changed";
  path: string;
  expected?: unknown;
  actual?: unknown;
}>;

type ColumnRow = Readonly<{
  schemaName: unknown;
  tableName: unknown;
  columnName: unknown;
  dataType: unknown;
  nullable: unknown;
  defaultValue: unknown;
}>;

type IndexRow = Readonly<{
  schemaName: unknown;
  tableName: unknown;
  indexName: unknown;
  definition: unknown;
}>;

type ConstraintRow = Readonly<{
  schemaName: unknown;
  tableName: unknown;
  constraintName: unknown;
  constraintType: unknown;
  definition: unknown;
}>;

type EnumRow = Readonly<{
  schemaName: unknown;
  enumName: unknown;
  enumValue: unknown;
  sortOrder: unknown;
}>;

type SequenceRow = Readonly<{
  schemaName: unknown;
  sequenceName: unknown;
  dataType: unknown;
  startValue: unknown;
  minimumValue: unknown;
  maximumValue: unknown;
  incrementValue: unknown;
  cacheValue: unknown;
  cycle: unknown;
  owner: unknown;
}>;

function compareText(left: string, right: string) {
  return left.localeCompare(right, "en");
}

function byPath<T>(path: (value: T) => string) {
  return (left: T, right: T) => compareText(path(left), path(right));
}

function tablePath(table: Pick<TableDefinition, "schema" | "name">) {
  return `${table.schema}.${table.name}`;
}

function tableObjectPath(
  object: Pick<IndexDefinition | ConstraintDefinition, "schema" | "table" | "name">,
) {
  return `${object.schema}.${object.table}.${object.name}`;
}

function schemaObjectPath(
  object: Pick<EnumDefinition | SequenceDefinition, "schema" | "name">,
) {
  return `${object.schema}.${object.name}`;
}

export function normalizeSchemaCatalog(catalog: SchemaCatalog): SchemaCatalog {
  return Object.freeze({
    tables: Object.freeze(catalog.tables.map((table) => Object.freeze({
      ...table,
      columns: Object.freeze([...table.columns].sort(byPath((column) => column.name))),
    })).sort(byPath(tablePath))),
    indexes: Object.freeze([...catalog.indexes].sort(byPath(tableObjectPath))),
    constraints: Object.freeze([...catalog.constraints].sort(byPath(tableObjectPath))),
    enums: Object.freeze([...catalog.enums].sort(byPath(schemaObjectPath))),
    sequences: Object.freeze([...catalog.sequences].sort(byPath(schemaObjectPath))),
  });
}

function mapBy<T>(values: readonly T[], key: (value: T) => string) {
  return new Map(values.map((value) => [key(value), value]));
}

function changed(
  differences: CatalogDifference[],
  path: string,
  expected: unknown,
  actual: unknown,
) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    differences.push({ kind: "changed", path, expected, actual });
  }
}

function compareObjects<T>(input: Readonly<{
  category: string;
  expected: readonly T[];
  actual: readonly T[];
  key: (value: T) => string;
  compareShared: (
    expected: T,
    actual: T,
    path: string,
    differences: CatalogDifference[],
  ) => void;
}>): CatalogDifference[] {
  const differences: CatalogDifference[] = [];
  const expectedByKey = mapBy(input.expected, input.key);
  const actualByKey = mapBy(input.actual, input.key);
  const keys = [...new Set([...expectedByKey.keys(), ...actualByKey.keys()])]
    .sort(compareText);

  for (const key of keys) {
    const expected = expectedByKey.get(key);
    const actual = actualByKey.get(key);
    const path = `${input.category}.${key}`;
    if (expected === undefined) differences.push({ kind: "added", path });
    else if (actual === undefined) differences.push({ kind: "removed", path });
    else input.compareShared(expected, actual, path, differences);
  }
  return differences;
}

function compareTables(
  expected: readonly TableDefinition[],
  actual: readonly TableDefinition[],
) {
  const differences: CatalogDifference[] = [];
  const expectedByKey = mapBy(expected, tablePath);
  const actualByKey = mapBy(actual, tablePath);
  const keys = [...new Set([...expectedByKey.keys(), ...actualByKey.keys()])]
    .sort(compareText);

  for (const key of keys) {
    if (!expectedByKey.has(key)) {
      differences.push({ kind: "added", path: `tables.${key}` });
    } else if (!actualByKey.has(key)) {
      differences.push({ kind: "removed", path: `tables.${key}` });
    }
  }

  for (const key of keys) {
    const expectedTable = expectedByKey.get(key);
    const actualTable = actualByKey.get(key);
    if (!expectedTable || !actualTable) continue;
    const expectedColumns = mapBy(expectedTable.columns, (column) => column.name);
    const actualColumns = mapBy(actualTable.columns, (column) => column.name);
    const columnNames = [...new Set([
      ...expectedColumns.keys(),
      ...actualColumns.keys(),
    ])].sort(compareText);
    for (const columnName of columnNames) {
      const expectedColumn = expectedColumns.get(columnName);
      const actualColumn = actualColumns.get(columnName);
      const path = `tables.${key}.columns.${columnName}`;
      if (!expectedColumn) differences.push({ kind: "added", path });
      else if (!actualColumn) differences.push({ kind: "removed", path });
      else {
        changed(differences, `${path}.dataType`, expectedColumn.dataType, actualColumn.dataType);
        changed(differences, `${path}.default`, expectedColumn.default, actualColumn.default);
        changed(differences, `${path}.nullable`, expectedColumn.nullable, actualColumn.nullable);
      }
    }
  }
  return differences;
}

export function compareSchemaCatalogs(
  expectedCatalog: SchemaCatalog,
  actualCatalog: SchemaCatalog,
): readonly CatalogDifference[] {
  const expected = normalizeSchemaCatalog(expectedCatalog);
  const actual = normalizeSchemaCatalog(actualCatalog);
  return Object.freeze([
    ...compareTables(expected.tables, actual.tables),
    ...compareObjects({
      category: "indexes",
      expected: expected.indexes,
      actual: actual.indexes,
      key: tableObjectPath,
      compareShared(expectedIndex, actualIndex, path, differences) {
        changed(differences, `${path}.definition`, expectedIndex.definition, actualIndex.definition);
      },
    }),
    ...compareObjects({
      category: "constraints",
      expected: expected.constraints,
      actual: actual.constraints,
      key: tableObjectPath,
      compareShared(expectedConstraint, actualConstraint, path, differences) {
        changed(differences, `${path}.definition`, expectedConstraint.definition, actualConstraint.definition);
        changed(differences, `${path}.type`, expectedConstraint.type, actualConstraint.type);
      },
    }),
    ...compareObjects({
      category: "enums",
      expected: expected.enums,
      actual: actual.enums,
      key: schemaObjectPath,
      compareShared(expectedEnum, actualEnum, path, differences) {
        changed(differences, `${path}.values`, expectedEnum.values, actualEnum.values);
      },
    }),
    ...compareObjects({
      category: "sequences",
      expected: expected.sequences,
      actual: actual.sequences,
      key: schemaObjectPath,
      compareShared(expectedSequence, actualSequence, path, differences) {
        for (const field of [
          "dataType",
          "start",
          "minimum",
          "maximum",
          "increment",
          "cache",
          "cycle",
          "owner",
        ] as const) {
          changed(differences, `${path}.${field}`, expectedSequence[field], actualSequence[field]);
        }
      },
    }),
  ]);
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  return value;
}

function nullableString(value: unknown, label: string) {
  if (value === null) return null;
  return requiredString(value, label);
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function userSchemaFilter(alias: string) {
  return `${alias}.nspname NOT IN ('pg_catalog', 'information_schema')
    AND ${alias}.nspname NOT LIKE 'pg_toast%'
    AND ${alias}.nspname NOT LIKE 'pg_temp_%'`;
}

const extensionOwnedClass = (objectAlias: string) => `NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_depend extension_dependency
  JOIN pg_catalog.pg_extension extension
    ON extension.oid = extension_dependency.refobjid
  WHERE extension_dependency.classid = 'pg_class'::regclass
    AND extension_dependency.refclassid = 'pg_extension'::regclass
    AND extension_dependency.objid = ${objectAlias}.oid
    AND extension_dependency.deptype = 'e'
)`;

const extensionOwnedType = (objectAlias: string) => `NOT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_depend extension_dependency
  JOIN pg_catalog.pg_extension extension
    ON extension.oid = extension_dependency.refobjid
  WHERE extension_dependency.classid = 'pg_type'::regclass
    AND extension_dependency.refclassid = 'pg_extension'::regclass
    AND extension_dependency.objid = ${objectAlias}.oid
    AND extension_dependency.deptype = 'e'
)`;

const columnCatalogQuery = `
  SELECT namespace.nspname AS "schemaName",
         relation.relname AS "tableName",
         attribute.attname AS "columnName",
         pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS "dataType",
         NOT attribute.attnotnull AS nullable,
         pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid) AS "defaultValue"
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = relation.oid
  LEFT JOIN pg_catalog.pg_attrdef attribute_default
    ON attribute_default.adrelid = relation.oid
   AND attribute_default.adnum = attribute.attnum
  WHERE relation.relkind IN ('r', 'p')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND ${userSchemaFilter("namespace")}
    AND NOT (namespace.nspname = 'drizzle' AND relation.relname = '__drizzle_migrations')
    AND ${extensionOwnedClass("relation")}
  ORDER BY namespace.nspname, relation.relname, attribute.attnum`;

const indexCatalogQuery = `
  SELECT namespace.nspname AS "schemaName",
         relation.relname AS "tableName",
         index_relation.relname AS "indexName",
         pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
  FROM pg_catalog.pg_index index_metadata
  JOIN pg_catalog.pg_class relation ON relation.oid = index_metadata.indrelid
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index_metadata.indexrelid
  WHERE relation.relkind IN ('r', 'p')
    AND ${userSchemaFilter("namespace")}
    AND NOT (namespace.nspname = 'drizzle' AND relation.relname = '__drizzle_migrations')
    AND ${extensionOwnedClass("relation")}
    AND ${extensionOwnedClass("index_relation")}
  ORDER BY namespace.nspname, relation.relname, index_relation.relname`;

const constraintCatalogQuery = `
  SELECT namespace.nspname AS "schemaName",
         relation.relname AS "tableName",
         constraint_metadata.conname AS "constraintName",
         CASE constraint_metadata.contype
           WHEN 'p' THEN 'primaryKey'
           WHEN 'u' THEN 'unique'
           WHEN 'f' THEN 'foreignKey'
           WHEN 'c' THEN 'check'
           WHEN 'x' THEN 'exclusion'
           ELSE constraint_metadata.contype::text
         END AS "constraintType",
         pg_catalog.pg_get_constraintdef(constraint_metadata.oid, true) AS definition
  FROM pg_catalog.pg_constraint constraint_metadata
  JOIN pg_catalog.pg_class relation ON relation.oid = constraint_metadata.conrelid
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE relation.relkind IN ('r', 'p')
    AND ${userSchemaFilter("namespace")}
    AND NOT (namespace.nspname = 'drizzle' AND relation.relname = '__drizzle_migrations')
    AND ${extensionOwnedClass("relation")}
  ORDER BY namespace.nspname, relation.relname, constraint_metadata.conname`;

const enumCatalogQuery = `
  SELECT namespace.nspname AS "schemaName",
         enum_type.typname AS "enumName",
         enum_value.enumlabel AS "enumValue",
         enum_value.enumsortorder AS "sortOrder"
  FROM pg_catalog.pg_type enum_type
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = enum_type.typnamespace
  JOIN pg_catalog.pg_enum enum_value ON enum_value.enumtypid = enum_type.oid
  WHERE ${userSchemaFilter("namespace")}
    AND ${extensionOwnedType("enum_type")}
  ORDER BY namespace.nspname, enum_type.typname, enum_value.enumsortorder`;

const sequenceCatalogQuery = `
  SELECT namespace.nspname AS "schemaName",
         sequence_relation.relname AS "sequenceName",
         pg_catalog.format_type(sequence_metadata.seqtypid, NULL) AS "dataType",
         sequence_metadata.seqstart::text AS "startValue",
         sequence_metadata.seqmin::text AS "minimumValue",
         sequence_metadata.seqmax::text AS "maximumValue",
         sequence_metadata.seqincrement::text AS "incrementValue",
         sequence_metadata.seqcache::text AS "cacheValue",
         sequence_metadata.seqcycle AS cycle,
         CASE
           WHEN owner_relation.oid IS NULL THEN NULL
           ELSE owner_namespace.nspname || '.' || owner_relation.relname || '.' || owner_attribute.attname
         END AS owner
  FROM pg_catalog.pg_class sequence_relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = sequence_relation.relnamespace
  JOIN pg_catalog.pg_sequence sequence_metadata ON sequence_metadata.seqrelid = sequence_relation.oid
  LEFT JOIN pg_catalog.pg_depend owner_dependency
    ON owner_dependency.classid = 'pg_class'::regclass
   AND owner_dependency.objid = sequence_relation.oid
   AND owner_dependency.refclassid = 'pg_class'::regclass
   AND owner_dependency.deptype IN ('a', 'i')
  LEFT JOIN pg_catalog.pg_class owner_relation ON owner_relation.oid = owner_dependency.refobjid
  LEFT JOIN pg_catalog.pg_namespace owner_namespace ON owner_namespace.oid = owner_relation.relnamespace
  LEFT JOIN pg_catalog.pg_attribute owner_attribute
    ON owner_attribute.attrelid = owner_relation.oid
   AND owner_attribute.attnum = owner_dependency.refobjsubid
  WHERE sequence_relation.relkind = 'S'
    AND ${userSchemaFilter("namespace")}
    AND ${extensionOwnedClass("sequence_relation")}
    AND NOT COALESCE(
      owner_namespace.nspname = 'drizzle'
      AND owner_relation.relname = '__drizzle_migrations',
      false
    )
  ORDER BY namespace.nspname, sequence_relation.relname`;

function catalogFromRows(input: Readonly<{
  columns: readonly ColumnRow[];
  indexes: readonly IndexRow[];
  constraints: readonly ConstraintRow[];
  enums: readonly EnumRow[];
  sequences: readonly SequenceRow[];
}>): SchemaCatalog {
  const tables = new Map<string, {
    schema: string;
    name: string;
    columns: ColumnDefinition[];
  }>();
  for (const row of input.columns) {
    const schema = requiredString(row.schemaName, "Column schema");
    const table = requiredString(row.tableName, "Column table");
    const key = `${schema}.${table}`;
    const definition = tables.get(key) ?? { schema, name: table, columns: [] };
    definition.columns.push({
      name: requiredString(row.columnName, "Column name"),
      dataType: requiredString(row.dataType, "Column type"),
      nullable: requiredBoolean(row.nullable, "Column nullability"),
      default: nullableString(row.defaultValue, "Column default"),
    });
    tables.set(key, definition);
  }

  const enums = new Map<string, { schema: string; name: string; values: string[] }>();
  for (const row of input.enums) {
    const schema = requiredString(row.schemaName, "Enum schema");
    const name = requiredString(row.enumName, "Enum name");
    const key = `${schema}.${name}`;
    const definition = enums.get(key) ?? { schema, name, values: [] };
    definition.values.push(requiredString(row.enumValue, "Enum value"));
    enums.set(key, definition);
  }

  return normalizeSchemaCatalog({
    tables: [...tables.values()],
    indexes: input.indexes.map((row) => ({
      schema: requiredString(row.schemaName, "Index schema"),
      table: requiredString(row.tableName, "Index table"),
      name: requiredString(row.indexName, "Index name"),
      definition: requiredString(row.definition, "Index definition"),
    })),
    constraints: input.constraints.map((row) => ({
      schema: requiredString(row.schemaName, "Constraint schema"),
      table: requiredString(row.tableName, "Constraint table"),
      name: requiredString(row.constraintName, "Constraint name"),
      type: requiredString(row.constraintType, "Constraint type"),
      definition: requiredString(row.definition, "Constraint definition"),
    })),
    enums: [...enums.values()],
    sequences: input.sequences.filter((row) => (
      row.owner !== "drizzle.__drizzle_migrations.id"
    )).map((row) => ({
      schema: requiredString(row.schemaName, "Sequence schema"),
      name: requiredString(row.sequenceName, "Sequence name"),
      dataType: requiredString(row.dataType, "Sequence type"),
      start: requiredString(row.startValue, "Sequence start"),
      minimum: requiredString(row.minimumValue, "Sequence minimum"),
      maximum: requiredString(row.maximumValue, "Sequence maximum"),
      increment: requiredString(row.incrementValue, "Sequence increment"),
      cache: requiredString(row.cacheValue, "Sequence cache"),
      cycle: requiredBoolean(row.cycle, "Sequence cycle"),
      owner: nullableString(row.owner, "Sequence owner"),
    })),
  });
}

export async function readSchemaCatalog(connectionString: string): Promise<SchemaCatalog> {
  let client: pg.Client | undefined;
  let transactionOpen = false;
  let failure = false;
  let catalog: SchemaCatalog | undefined;
  try {
    client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = 15000");
    const columns = await client.query<ColumnRow>(columnCatalogQuery);
    const indexes = await client.query<IndexRow>(indexCatalogQuery);
    const constraints = await client.query<ConstraintRow>(constraintCatalogQuery);
    const enums = await client.query<EnumRow>(enumCatalogQuery);
    const sequences = await client.query<SequenceRow>(sequenceCatalogQuery);
    catalog = catalogFromRows({
      columns: columns.rows,
      indexes: indexes.rows,
      constraints: constraints.rows,
      enums: enums.rows,
      sequences: sequences.rows,
    });
    await client.query("ROLLBACK");
    transactionOpen = false;
  } catch {
    failure = true;
  } finally {
    if (client && transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        failure = true;
      }
    }
    if (client) {
      try {
        await client.end();
      } catch {
        failure = true;
      }
    }
  }
  if (failure || !catalog) throw new Error("Schema catalog could not be read");
  return catalog;
}
