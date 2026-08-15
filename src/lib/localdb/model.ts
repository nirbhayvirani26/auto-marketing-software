import { ObjectId } from "./object-id";
import {
  applyProjection,
  applyUpdate,
  getPath,
  matchFilter,
  parseProjection,
  sortDocuments,
  upsertSeed,
  type AnyRecord,
  type Projection,
  type SortSpec,
} from "./query-engine";
import type { Schema } from "./schema";
import { clone } from "./serialize";
import { collectionFile, type CollectionFile } from "./storage";

/* ------------------------------------------------------------------ *
 *  Public types
 * ------------------------------------------------------------------ */

export type BaseFields = {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentMethods<T> = {
  /** Writes the document back to its collection. */
  save(): Promise<HydratedDocument<T>>;
  /** A plain copy with no attached methods. */
  toObject(): T;
  toJSON(): T;
  deleteOne(): Promise<{ acknowledged: true; deletedCount: number }>;
  /** Replaces a reference field with the referenced document. */
  populate(path: string, select?: string): Promise<HydratedDocument<T>>;
  /** The `_id` as a hex string. */
  readonly id: string;
};

export type HydratedDocument<T> = T & DocumentMethods<T>;

export type FilterQuery<T> = AnyRecord & Partial<Record<keyof T, unknown>>;
export type UpdateQuery<T> = AnyRecord & Partial<Record<keyof T, unknown>>;

/**
 * The shape accepted when writing a document.
 *
 * Reads always hand back real `ObjectId` and `Date` instances, but writes come
 * from route handlers where an id is usually still the hex string that arrived
 * in the request body. Rather than making every caller convert first, the
 * write side accepts both and the schema casts on the way in.
 */
export type Writable<V> =
  [V] extends [ObjectId] ? ObjectId | string
  : [V] extends [ObjectId | undefined] ? ObjectId | string | undefined
  : [V] extends [Date] ? Date | string | number
  : [V] extends [Date | undefined] ? Date | string | number | undefined
  : [V] extends [readonly (infer E)[]] ? Writable<E>[]
  : [V] extends [readonly (infer E)[] | undefined] ? Writable<E>[] | undefined
  : [V] extends [(...args: never[]) => unknown] ? V
  : [V] extends [object] ? { [K in keyof V]?: Writable<V[K]> }
  : [V] extends [object | undefined] ? { [K in keyof V]?: Writable<V[K]> } | undefined
  : V;

export type WritableDoc<T> = { [K in keyof T]?: Writable<T[K]> };

export type UpdateOptions = {
  /** Return the updated document rather than the original. Defaults to true. */
  new?: boolean;
  /** Create the document when the filter matches nothing. */
  upsert?: boolean;
  /** Accepted for API parity — schema defaults are always applied on insert. */
  setDefaultsOnInsert?: boolean;
};

export class DuplicateKeyError extends Error {
  readonly code = 11000;
  readonly keyPattern: Record<string, 1>;

  constructor(modelName: string, fields: string[]) {
    super(`${modelName}: duplicate value for unique index (${fields.join(", ")}).`);
    this.name = "DuplicateKeyError";
    this.keyPattern = Object.fromEntries(fields.map((field) => [field, 1 as const]));
  }
}

/* ------------------------------------------------------------------ *
 *  Model registry — populate() needs to find models by name
 * ------------------------------------------------------------------ */

const registry = new Map<string, Model<AnyRecord>>();

export const models: Record<string, Model<AnyRecord>> = new Proxy(
  {},
  {
    get: (_target, key: string) => registry.get(key),
    has: (_target, key: string) => registry.has(key),
    ownKeys: () => [...registry.keys()],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
) as Record<string, Model<AnyRecord>>;

/** Pluralised, lower-cased collection name — `Post` becomes `posts.json`. */
function collectionNameFor(modelName: string): string {
  const lower = modelName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return `${lower}s`;
}

/* ------------------------------------------------------------------ *
 *  Query
 * ------------------------------------------------------------------ */

type PopulateRequest = { path: string; select?: string };

export class Query<T extends AnyRecord, R> implements PromiseLike<R> {
  private sortSpec: SortSpec | undefined;
  private limitCount: number | undefined;
  private skipCount = 0;
  private projection: Projection | undefined;
  private populates: PopulateRequest[] = [];
  private isLean = false;

  constructor(
    private readonly model: Model<T>,
    private readonly kind: "find" | "findOne",
    private readonly filter: AnyRecord,
    private readonly finalise: (docs: AnyRecord[]) => R,
  ) {}

  sort(spec: SortSpec): this {
    this.sortSpec = spec;
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  skip(count: number): this {
    this.skipCount = count;
    return this;
  }

  select(spec: Projection): this {
    this.projection = spec;
    return this;
  }

  populate(path: string, select?: string): this {
    this.populates.push({ path, select });
    return this;
  }

  /**
   * Returns plain objects instead of documents with `save()` attached. Kept for
   * API parity — every result is already a detached copy, so this only changes
   * whether the helper methods are present.
   */
  lean(): this {
    this.isLean = true;
    return this;
  }

  async exec(): Promise<R> {
    const matched = this.model.rawFind(this.filter);
    const sorted = sortDocuments(matched, this.sortSpec);

    const windowed = this.kind === "findOne"
      ? sorted.slice(this.skipCount, this.skipCount + 1)
      : sorted.slice(
          this.skipCount,
          this.limitCount === undefined ? undefined : this.skipCount + this.limitCount,
        );

    const projection = this.model.resolveProjection(this.projection);
    const shaped = windowed.map((doc) => applyProjection(clone(doc), projection));

    for (const request of this.populates) {
      await this.model.applyPopulate(shaped, request.path, request.select);
    }

    const finished = this.isLean ? shaped : shaped.map((doc) => this.model.hydrate(doc));
    return this.finalise(finished);
  }

  then<TResult1 = R, TResult2 = never>(
    onfulfilled?: ((value: R) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<R | TResult> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<R> {
    return this.exec().finally(onfinally);
  }
}

/* ------------------------------------------------------------------ *
 *  Model
 * ------------------------------------------------------------------ */

export class Model<T extends AnyRecord> {
  readonly modelName: string;
  readonly schema: Schema;
  readonly collectionName: string;

  private readonly file: CollectionFile;
  private ttlSweptAt = 0;

  constructor(modelName: string, schema: Schema) {
    this.modelName = modelName;
    this.schema = schema;
    this.collectionName = collectionNameFor(modelName);
    this.file = collectionFile(this.collectionName);
  }

  /* ------------------------------ reads ------------------------------ */

  /** Every stored document, with expired ones removed first. */
  private documents(): AnyRecord[] {
    this.sweepExpired();
    return this.file.all();
  }

  /** Applies TTL indexes at most once a second. */
  private sweepExpired(): void {
    const ttls = this.schema.ttlIndexes();
    if (!ttls.length) return;

    const now = Date.now();
    if (now - this.ttlSweptAt < 1000) return;
    this.ttlSweptAt = now;

    const docs = this.file.all();
    const kept = docs.filter((doc) =>
      ttls.every(({ path, seconds }) => {
        const value = getPath(doc, path);
        if (!(value instanceof Date)) return true;
        return value.getTime() + seconds * 1000 > now;
      }),
    );

    if (kept.length !== docs.length) this.file.replaceAll(kept);
  }

  /** @internal */
  rawFind(filter: AnyRecord): AnyRecord[] {
    return this.documents().filter((doc) => matchFilter(doc, filter));
  }

  /** @internal — hidden paths stay hidden unless `+path` asks for them. */
  resolveProjection(spec: Projection | undefined) {
    const hidden = this.schema.hiddenPaths();
    const parsed = parseProjection(spec);

    if (!parsed) {
      return hidden.length ? { include: [], exclude: hidden, forceInclude: [] } : null;
    }

    const forced = new Set(parsed.forceInclude);
    const stillHidden = hidden.filter((path) => !forced.has(path));

    if (parsed.include.length) {
      return {
        include: [...parsed.include, ...parsed.forceInclude],
        exclude: parsed.exclude,
        forceInclude: parsed.forceInclude,
      };
    }

    return {
      include: [],
      exclude: [...new Set([...parsed.exclude, ...stillHidden])],
      forceInclude: parsed.forceInclude,
    };
  }

  /** @internal — swaps reference ids for the documents they point at. */
  async applyPopulate(docs: AnyRecord[], path: string, select?: string): Promise<void> {
    const reference = this.schema.references().get(path);
    if (!reference) return;

    const target = registry.get(reference.ref);
    if (!target) return;

    const ids = new Set<string>();
    for (const doc of docs) {
      const value = getPath(doc, path);
      for (const item of Array.isArray(value) ? value : [value]) {
        const id = ObjectId.coerce(item);
        if (id) ids.add(id.toHexString());
      }
    }
    if (!ids.size) return;

    const related = await target
      .find({ _id: { $in: [...ids].map((id) => new ObjectId(id)) } })
      .select(select ?? "")
      .lean();

    const byId = new Map(related.map((doc) => [String((doc as AnyRecord)._id), doc]));

    for (const doc of docs) {
      const value = getPath(doc, path);
      if (Array.isArray(value)) {
        const resolved = value
          .map((item) => byId.get(String(item)))
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
        writeAtPath(doc, path, resolved);
      } else if (value !== undefined && value !== null) {
        const resolved = byId.get(String(value));
        if (resolved) writeAtPath(doc, path, resolved);
      }
    }
  }

  /** @internal — attaches `save()` and friends without making them enumerable. */
  hydrate(plain: AnyRecord): HydratedDocument<T> {
    const model = this;
    const doc = plain as HydratedDocument<T>;

    const define = (name: string | symbol, value: unknown) =>
      Object.defineProperty(doc, name, { value, enumerable: false, configurable: true });

    // The state this document was loaded in. `save()` compares against it so
    // only the fields the caller actually touched get written.
    define(SNAPSHOT, clone(stripMethods(doc)));

    define("save", async function save() {
      model.persistChanges(doc);
      define(SNAPSHOT, clone(stripMethods(doc)));
      return doc;
    });
    define("toObject", () => clone(stripMethods(doc)));
    define("toJSON", () => clone(stripMethods(doc)));
    define("deleteOne", async () =>
      model.deleteOne({ _id: (doc as AnyRecord)._id } as FilterQuery<T>),
    );
    define("populate", async (path: string, select?: string) => {
      await model.applyPopulate([doc], path, select);
      return doc;
    });

    Object.defineProperty(doc, "id", {
      get: () => String((doc as AnyRecord)._id ?? ""),
      enumerable: false,
      configurable: true,
    });

    return doc;
  }

  /* ------------------------------ writes ----------------------------- */

  /** Rejects a write that would break a unique index. */
  private assertUnique(candidate: AnyRecord, ignoreId?: ObjectId): void {
    const uniques = this.schema.uniqueIndexes();
    if (!uniques.length) return;

    const docs = this.documents();

    for (const index of uniques) {
      const fields = index.fields.map(([field]) => field);
      const values = fields.map((field) => getPath(candidate, field));

      // A sparse or partial index ignores documents missing the value.
      if (values.some((value) => value === undefined || value === null || value === "")) {
        continue;
      }
      if (
        index.options.partialFilterExpression &&
        !matchFilter(candidate, index.options.partialFilterExpression)
      ) {
        continue;
      }

      const clash = docs.some((doc) => {
        if (ignoreId && String(doc._id) === ignoreId.toHexString()) return false;
        return fields.every((field, position) => {
          const stored = getPath(doc, field);
          const wanted = values[position];
          if (stored instanceof ObjectId || wanted instanceof ObjectId) {
            return String(stored) === String(wanted);
          }
          return stored === wanted;
        });
      });

      if (clash) throw new DuplicateKeyError(this.modelName, fields);
    }
  }

  /** Casts, validates, stamps timestamps and writes one document. */
  private persist(input: AnyRecord): AnyRecord {
    const now = new Date();
    const docs = this.file.all();

    const cast = this.schema.cast(stripMethods(input));
    const id = ObjectId.coerce(cast._id) ?? new ObjectId();
    cast._id = id;

    const index = docs.findIndex((doc) => String(doc._id) === id.toHexString());

    if (this.schema.options.timestamps) {
      if (index === -1) cast.createdAt = (cast.createdAt as Date) ?? now;
      else cast.createdAt = (docs[index].createdAt as Date) ?? now;
      cast.updatedAt = now;
    }

    this.schema.validate(cast, this.modelName);
    this.assertUnique(cast, index === -1 ? undefined : id);

    const stored = clone(cast);
    if (index === -1) docs.push(stored);
    else docs[index] = stored;

    this.file.markDirty();

    // Keep the caller's object in step with what was written (ids, defaults,
    // timestamps) without swapping the reference out from under them.
    for (const [key, value] of Object.entries(cast)) {
      (input as AnyRecord)[key] = value;
    }

    return stored;
  }

  /**
   * Writes back only what changed on a hydrated document.
   *
   * Two parts of the app routinely hold the same record at the same time — the
   * reel pipeline keeps a job object while `setStep()` records progress on its
   * own copy. Writing the whole document would mean whichever saved last wiped
   * the other's work. Comparing against the load-time snapshot and merging the
   * changed fields onto whatever is currently stored keeps both.
   */
  private persistChanges(doc: AnyRecord): AnyRecord {
    const current = stripMethods(doc);
    const snapshot = (doc as Record<symbol, unknown>)[SNAPSHOT] as AnyRecord | undefined;

    // Created outside a read (or the snapshot is gone) — write it whole.
    if (!snapshot) return this.persist(doc);

    const id = ObjectId.coerce(current._id);
    const stored = id
      ? this.file.all().find((row) => String(row._id) === id.toHexString())
      : undefined;

    // Nothing on disk to merge with; this is an insert.
    if (!stored) return this.persist(doc);

    const merged = clone(stored);

    // Fields the caller changed since loading win.
    for (const key of Object.keys(current)) {
      if (!deepEqual(current[key], snapshot[key])) merged[key] = current[key];
    }
    // Fields the caller deleted are removed.
    for (const key of Object.keys(snapshot)) {
      if (key in current) continue;
      delete merged[key];
    }

    return this.persist(merged);
  }

  /* ------------------------------ public API ------------------------- */

  find(filter: FilterQuery<T> = {}, projection?: Projection): Query<T, HydratedDocument<T>[]> {
    const query = new Query<T, HydratedDocument<T>[]>(
      this,
      "find",
      filter,
      (docs) => docs as HydratedDocument<T>[],
    );
    return projection ? query.select(projection) : query;
  }

  findOne(
    filter: FilterQuery<T> = {},
    projection?: Projection,
  ): Query<T, HydratedDocument<T> | null> {
    const query = new Query<T, HydratedDocument<T> | null>(
      this,
      "findOne",
      filter,
      (docs) => (docs[0] as HydratedDocument<T>) ?? null,
    );
    return projection ? query.select(projection) : query;
  }

  findById(
    id: ObjectId | string | null | undefined,
    projection?: Projection,
  ): Query<T, HydratedDocument<T> | null> {
    const objectId = ObjectId.coerce(id);
    // An unusable id must resolve to null rather than throw.
    return this.findOne(
      (objectId ? { _id: objectId } : { _id: " never" }) as FilterQuery<T>,
      projection,
    );
  }

  async create(input: WritableDoc<T> | WritableDoc<T>[]): Promise<HydratedDocument<T>> {
    if (Array.isArray(input)) {
      const created: HydratedDocument<T>[] = [];
      for (const item of input) created.push(await this.create(item));
      return created[0];
    }

    const draft = clone(input as AnyRecord);
    const stored = this.persist(draft);
    return this.hydrate(clone(stored));
  }

  async insertMany(inputs: WritableDoc<T>[]): Promise<HydratedDocument<T>[]> {
    const out: HydratedDocument<T>[] = [];
    for (const input of inputs) out.push(await this.create(input));
    return out;
  }

  /**
   * How many documents fall under each value of one field — the local stand-in
   * for a `$group` count aggregation.
   *
   *   await Post.groupCount("status", { brand })  // { draft: 4, published: 12 }
   */
  async groupCount(
    field: string,
    filter: FilterQuery<T> = {},
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const doc of this.rawFind(filter)) {
      const value = getPath(doc, field);
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item === undefined || item === null) continue;
        const key = String(item);
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }

  async countDocuments(filter: FilterQuery<T> = {}): Promise<number> {
    return this.rawFind(filter).length;
  }

  async estimatedDocumentCount(): Promise<number> {
    return this.documents().length;
  }

  async exists(filter: FilterQuery<T>): Promise<{ _id: ObjectId } | null> {
    const found = this.rawFind(filter)[0];
    return found ? { _id: found._id as ObjectId } : null;
  }

  async distinct(field: string, filter: FilterQuery<T> = {}): Promise<unknown[]> {
    const seen = new Map<string, unknown>();
    for (const doc of this.rawFind(filter)) {
      const value = getPath(doc, field);
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item === undefined || item === null) continue;
        seen.set(String(item), item);
      }
    }
    return [...seen.values()];
  }

  async updateOne(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options: UpdateOptions = {},
  ): Promise<{ acknowledged: true; matchedCount: number; modifiedCount: number; upsertedId: ObjectId | null }> {
    const target = this.rawFind(filter)[0];

    if (!target) {
      if (!options.upsert) {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: null };
      }
      const seed = applyUpdate(upsertSeed(filter, update), update);
      const created = this.persist(seed);
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedId: created._id as ObjectId,
      };
    }

    this.persist(applyUpdate(clone(target), update));
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedId: null };
  }

  async updateMany(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
  ): Promise<{ acknowledged: true; matchedCount: number; modifiedCount: number }> {
    const targets = this.rawFind(filter);
    for (const target of targets) this.persist(applyUpdate(clone(target), update));
    return {
      acknowledged: true,
      matchedCount: targets.length,
      modifiedCount: targets.length,
    };
  }

  // An upsert always produces a document, so callers should not have to
  // null-check what the database just guaranteed.
  findOneAndUpdate(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options: UpdateOptions & { upsert: true; new?: true },
  ): Promise<HydratedDocument<T>>;
  findOneAndUpdate(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options?: UpdateOptions,
  ): Promise<HydratedDocument<T> | null>;
  async findOneAndUpdate(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options: UpdateOptions = {},
  ): Promise<HydratedDocument<T> | null> {
    const target = this.rawFind(filter)[0];

    if (!target) {
      if (!options.upsert) return null;
      const seed = applyUpdate(upsertSeed(filter, update), update);
      const created = this.persist(seed);
      return this.hydrate(clone(created));
    }

    const before = clone(target);
    const after = this.persist(applyUpdate(clone(target), update));
    return this.hydrate(clone(options.new === false ? before : after));
  }

  async findByIdAndUpdate(
    id: ObjectId | string,
    update: UpdateQuery<T>,
    options: UpdateOptions = {},
  ): Promise<HydratedDocument<T> | null> {
    const objectId = ObjectId.coerce(id);
    if (!objectId) return null;
    return this.findOneAndUpdate({ _id: objectId } as FilterQuery<T>, update, options);
  }

  async findByIdAndDelete(id: ObjectId | string): Promise<HydratedDocument<T> | null> {
    const objectId = ObjectId.coerce(id);
    if (!objectId) return null;
    return this.findOneAndDelete({ _id: objectId } as FilterQuery<T>);
  }

  async findOneAndDelete(filter: FilterQuery<T>): Promise<HydratedDocument<T> | null> {
    const target = this.rawFind(filter)[0];
    if (!target) return null;
    await this.deleteOne({ _id: target._id } as FilterQuery<T>);
    return this.hydrate(clone(target));
  }

  async deleteOne(filter: FilterQuery<T>): Promise<{ acknowledged: true; deletedCount: number }> {
    const docs = this.file.all();
    const index = docs.findIndex((doc) => matchFilter(doc, filter));
    if (index === -1) return { acknowledged: true, deletedCount: 0 };
    docs.splice(index, 1);
    this.file.markDirty();
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(filter: FilterQuery<T> = {}): Promise<{ acknowledged: true; deletedCount: number }> {
    const docs = this.file.all();
    const kept = docs.filter((doc) => !matchFilter(doc, filter));
    const removed = docs.length - kept.length;
    if (removed) this.file.replaceAll(kept);
    return { acknowledged: true, deletedCount: removed };
  }

  /** No-op kept so callers can mirror the Mongoose index-build call. */
  async syncIndexes(): Promise<void> {}
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

/** Where a hydrated document keeps its load-time copy, out of the way. */
const SNAPSHOT = Symbol("localdb.snapshot");

function stripMethods(doc: AnyRecord): AnyRecord {
  const out: AnyRecord = {};
  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === "function") continue;
    out[key] = value;
  }
  return out;
}

/** Value equality that understands ObjectId and Date. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;

  if (a instanceof ObjectId || b instanceof ObjectId) {
    const left = ObjectId.coerce(a);
    const right = ObjectId.coerce(b);
    return Boolean(left && right && left.toHexString() === right.toHexString());
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as AnyRecord);
    const bKeys = Object.keys(b as AnyRecord);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual((a as AnyRecord)[key], (b as AnyRecord)[key]),
    );
  }

  return false;
}

function writeAtPath(doc: AnyRecord, path: string, value: unknown): void {
  if (!path.includes(".")) {
    doc[path] = value;
    return;
  }
  const parts = path.split(".");
  let current: AnyRecord = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (current[key] === null || typeof current[key] !== "object") current[key] = {};
    current = current[key] as AnyRecord;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Defines a model, or returns the one already registered under this name.
 * Next.js reloads modules in development, so re-registering must be harmless.
 */
export function model<T extends AnyRecord>(
  modelName: string,
  schema: Schema,
): Model<T> {
  const existing = registry.get(modelName);
  if (existing) return existing as unknown as Model<T>;

  const created = new Model<AnyRecord>(modelName, schema);
  registry.set(modelName, created);
  return created as unknown as Model<T>;
}
