import { MongoClient, ObjectId } from "mongodb";
import type { ServerConfig, ColumnInfo, KeyInfo } from "@/lib/types";
import type {
  DatabaseDriver,
  DriverCapabilities,
  Engine,
  BrowseOptions,
  BrowseResult,
  ExecResult,
  RunQueryOptions,
  RunQueryResult,
  TableStructure,
  FilterCondition,
} from "./types";
import { NotSupportedError } from "./types";
import { CAPABILITIES } from "./capabilities";
import { friendlyConnectionError } from "./errors";

const SAMPLE_SIZE = 100;

/** Name of the BSON/JS type of a value, for the inferred "structure" view. */
function bsonTypeName(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof ObjectId) return "objectId";
  if (v instanceof Date) return "date";
  if (Array.isArray(v)) return "array";
  if (Buffer.isBuffer(v)) return "binary";
  if (typeof v === "object") {
    const bsontype = (v as { _bsontype?: string })._bsontype;
    if (bsontype) return bsontype.toLowerCase();
    return "object";
  }
  return typeof v; // string | number | boolean
}

/** Convert BSON values to JSON-friendly ones so NextResponse.json can serialize them. */
function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (v instanceof ObjectId) return v.toHexString();
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("base64");
  if (Array.isArray(v)) return v.map(serializeValue);
  if (typeof v === "object") {
    // Long, Decimal128, etc. serialize via toString; plain sub-docs recurse.
    if ((v as { _bsontype?: string })._bsontype) return String(v);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = serializeValue(val);
    return out;
  }
  return v;
}

/** Interpret an `_id` string: a 24-char hex is an ObjectId; otherwise a literal. */
function toId(value: unknown): unknown {
  if (typeof value === "string" && /^[a-f0-9]{24}$/i.test(value)) return new ObjectId(value);
  return value;
}

/**
 * MongoDB driver. Non-SQL: databases map to databases, collections to "tables",
 * documents to "rows". There is no SQL editor (capabilities.query = false); the
 * "structure" of a collection is *inferred* by sampling documents.
 */
export class MongoDriver implements DatabaseDriver {
  readonly engine: Engine = "mongodb";
  readonly capabilities: DriverCapabilities = CAPABILITIES.mongodb;

  constructor(private readonly config: ServerConfig) {}

  private get uri(): string {
    if (this.config.uri) return this.config.uri;
    const host = this.config.host ?? "127.0.0.1";
    const port = this.config.port ?? 27017;
    return `mongodb://${host}:${port}`;
  }

  private async withClient<T>(fn: (client: MongoClient) => Promise<T>): Promise<T> {
    const client = new MongoClient(this.uri);
    try {
      await client.connect();
    } catch (err) {
      await client.close().catch(() => {});
      throw friendlyConnectionError(err, this.engine);
    }
    try {
      return await fn(client);
    } finally {
      await client.close();
    }
  }

  async listDatabases(): Promise<string[]> {
    return this.withClient(async (client) => {
      const result = await client.db().admin().listDatabases();
      return result.databases.map((d) => d.name).sort();
    });
  }

  async createDatabase(): Promise<void> {
    // Mongo creates a database the moment data is written to it — there's no
    // empty-database concept to create up front.
    throw new NotSupportedError(this.engine, "createDatabase");
  }

  async dropDatabase(name: string): Promise<void> {
    await this.withClient((client) => client.db(name).dropDatabase().then(() => undefined));
  }

  async listTables(database: string): Promise<string[]> {
    return this.withClient(async (client) => {
      const cols = await client.db(database).listCollections({}, { nameOnly: true }).toArray();
      return cols
        .map((c) => c.name)
        .filter((n) => !n.startsWith("system."))
        .sort();
    });
  }

  async getTableStructure(database: string, table: string): Promise<TableStructure> {
    return this.withClient(async (client) => {
      const collection = client.db(database).collection(table);
      const sample = await collection.find({}).limit(SAMPLE_SIZE).toArray();

      // Infer fields in first-seen order, aggregating the set of observed types.
      const order: string[] = [];
      const types = new Map<string, Set<string>>();
      for (const doc of sample) {
        for (const [key, val] of Object.entries(doc)) {
          if (!types.has(key)) {
            types.set(key, new Set());
            order.push(key);
          }
          types.get(key)!.add(bsonTypeName(val));
        }
      }
      // _id first.
      order.sort((a, b) => (a === "_id" ? -1 : b === "_id" ? 1 : 0));

      const columns: ColumnInfo[] = order.map((field) => {
        const typeSet = types.get(field)!;
        const typeStr = typeSet.size === 1 ? [...typeSet][0] : `mixed (${[...typeSet].join(", ")})`;
        return {
          Field: field,
          Type: typeStr,
          Null: "YES", // Mongo fields are optional per-document
          Key: field === "_id" ? "PRI" : "",
          Default: null,
          // Treat _id like an auto column so the insert form lets Mongo assign it.
          Extra: field === "_id" ? "auto_increment" : "",
        };
      });

      const rawIndexes = await collection.indexes();
      const indexes: KeyInfo[] = [];
      for (const idx of rawIndexes) {
        const keys = Object.keys(idx.key ?? {});
        keys.forEach((col, i) => {
          indexes.push({
            Table: table,
            Non_unique: idx.unique || idx.name === "_id_" ? 0 : 1,
            Key_name: idx.name ?? "",
            Seq_in_index: i + 1,
            Column_name: col,
            Collation: null,
            Cardinality: null,
            Sub_part: null,
            Packed: null,
            Null: "",
            Index_type: String(idx.key?.[col] === "text" ? "TEXT" : "BTREE"),
            Comment: "",
          });
        });
      }

      return { columns, indexes, foreignKeys: [] };
    });
  }

  async browseTable(database: string, table: string, options: BrowseOptions): Promise<BrowseResult> {
    return this.withClient(async (client) => {
      const collection = client.db(database).collection(table);
      const mongoFilter = buildMongoFilter(options.filters);
      const totalRows = await collection.countDocuments(mongoFilter);
      const totalPages = Math.ceil(totalRows / options.pageSize);
      const offset = (options.page - 1) * options.pageSize;

      let cursor = collection.find(mongoFilter);
      if (options.sortColumn) {
        cursor = cursor.sort({ [options.sortColumn]: options.sortDirection === "desc" ? -1 : 1 });
      }

      const start = performance.now();
      const docs = await cursor.skip(offset).limit(options.pageSize).toArray();
      const executionTime = parseFloat((performance.now() - start).toFixed(2));

      const rows = docs.map((d) => serializeValue(d) as Record<string, unknown>);
      const fields = fieldUnion(rows);

      return { rows, fields, totalRows, page: options.page, pageSize: options.pageSize, totalPages, executionTime };
    });
  }

  async insertRow(database: string, table: string, values: Record<string, unknown>): Promise<ExecResult> {
    return this.withClient(async (client) => {
      // Drop an empty _id so Mongo assigns one.
      const doc = { ...values };
      if (doc._id === "" || doc._id === undefined || doc._id === null) delete doc._id;
      const result = await client.db(database).collection(table).insertOne(doc);
      return {
        affectedRows: result.acknowledged ? 1 : 0,
        insertId: result.insertedId ? String(result.insertedId) : null,
        message: "1 document inserted.",
      };
    });
  }

  async updateRow(
    database: string,
    table: string,
    primaryKeys: Record<string, unknown>,
    updates: Record<string, unknown>
  ): Promise<ExecResult> {
    return this.withClient(async (client) => {
      const filter = buildIdFilter(primaryKeys);
      const set = { ...updates };
      delete set._id; // never overwrite the id
      const result = await client.db(database).collection(table).updateOne(filter, { $set: set });
      return { affectedRows: result.modifiedCount, message: `${result.modifiedCount} document(s) updated.` };
    });
  }

  async deleteRow(database: string, table: string, primaryKeys: Record<string, unknown>): Promise<ExecResult> {
    return this.withClient(async (client) => {
      const filter = buildIdFilter(primaryKeys);
      const result = await client.db(database).collection(table).deleteOne(filter);
      return { affectedRows: result.deletedCount, message: `${result.deletedCount} document(s) deleted.` };
    });
  }

  async runQuery(
    _database: string,
    _query: string,
    _options: RunQueryOptions
  ): Promise<RunQueryResult> {
    // MongoDB has no SQL; the UI hides the query editor via capabilities.query = false.
    throw new NotSupportedError(this.engine, "runQuery");
  }

  // ---- schema editing: N/A for schemaless MongoDB (UI hides it via schemaEdit=false) ----
  async addColumn(): Promise<ExecResult> { throw new NotSupportedError(this.engine, "addColumn"); }
  async changeColumn(): Promise<ExecResult> { throw new NotSupportedError(this.engine, "changeColumn"); }
  async dropColumn(): Promise<ExecResult> { throw new NotSupportedError(this.engine, "dropColumn"); }
  async addIndex(): Promise<ExecResult> { throw new NotSupportedError(this.engine, "addIndex"); }
  async dropIndex(): Promise<ExecResult> { throw new NotSupportedError(this.engine, "dropIndex"); }

  // ---- collection operations (map to table operations) ----

  async createTable(database: string, name: string): Promise<ExecResult> {
    // Mongo is schemaless: creating a "table" is just creating an empty collection (columns ignored).
    return this.withClient(async (client) => {
      await client.db(database).createCollection(name);
      return { affectedRows: 0, message: `Collection "${name}" created.` };
    });
  }

  async dumpTableSql(): Promise<string> {
    throw new NotSupportedError(this.engine, "dumpTableSql");
  }

  async listDatabaseObjects(): Promise<{ views: never[]; routines: never[]; triggers: never[] }> {
    return { views: [], routines: [], triggers: [] };
  }

  async dropObject(): Promise<ExecResult> {
    throw new NotSupportedError(this.engine, "dropObject");
  }

  async truncateTable(database: string, table: string): Promise<ExecResult> {
    return this.withClient(async (client) => {
      const r = await client.db(database).collection(table).deleteMany({});
      return { affectedRows: r.deletedCount, message: `Collection "${table}" emptied (${r.deletedCount} documents).` };
    });
  }

  async renameTable(database: string, table: string, newName: string): Promise<ExecResult> {
    return this.withClient(async (client) => {
      await client.db(database).collection(table).rename(newName);
      return { affectedRows: 0, message: `Renamed to "${newName}".` };
    });
  }

  async dropTable(database: string, table: string): Promise<ExecResult> {
    return this.withClient(async (client) => {
      await client.db(database).collection(table).drop();
      return { affectedRows: 0, message: `Collection "${table}" dropped.` };
    });
  }
}

/** Union of keys across the page, with `_id` first, preserving first-seen order. */
function fieldUnion(rows: Record<string, unknown>[]): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!set.has(k)) {
        set.add(k);
        seen.push(k);
      }
    }
  }
  seen.sort((a, b) => (a === "_id" ? -1 : b === "_id" ? 1 : 0));
  return seen;
}

/** Translate browse filter conditions into a Mongo find() query (ANDed). */
function buildMongoFilter(filters: FilterCondition[] | undefined): Record<string, unknown> {
  if (!filters || filters.length === 0) return {};
  const and: Record<string, unknown>[] = [];
  for (const f of filters) {
    if (!f || !f.column) continue;
    const col = f.column;
    // Coerce numeric-looking values so `total > 100` compares as a number.
    const raw = f.value ?? "";
    const coerced: unknown = raw !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;
    switch (f.op) {
      case "=": and.push({ [col]: coerced }); break;
      case "!=": and.push({ [col]: { $ne: coerced } }); break;
      case "<": and.push({ [col]: { $lt: coerced } }); break;
      case ">": and.push({ [col]: { $gt: coerced } }); break;
      case "<=": and.push({ [col]: { $lte: coerced } }); break;
      case ">=": and.push({ [col]: { $gte: coerced } }); break;
      case "LIKE": and.push({ [col]: { $regex: likeToRegex(raw), $options: "i" } }); break;
      case "NOT LIKE": and.push({ [col]: { $not: { $regex: likeToRegex(raw), $options: "i" } } }); break;
      case "IS NULL": and.push({ [col]: null }); break;
      case "IS NOT NULL": and.push({ [col]: { $ne: null } }); break;
    }
  }
  return and.length ? { $and: and } : {};
}

/** Convert a SQL LIKE pattern (%, _) into an anchored regex source string. */
function likeToRegex(pattern: string): string {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return "^" + escaped.replace(/%/g, ".*").replace(/_/g, ".") + "$";
}

function buildIdFilter(primaryKeys: Record<string, unknown>): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(primaryKeys)) {
    filter[k] = k === "_id" ? toId(v) : v;
  }
  return filter;
}
