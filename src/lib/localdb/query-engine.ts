import { ObjectId } from "./object-id";
import { clone } from "./serialize";

/**
 * The subset of the MongoDB query language this application actually uses.
 * Everything here operates on plain in-memory documents.
 */

export type AnyRecord = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 *  Path access
 * ------------------------------------------------------------------ */

/** Reads `a.b.c`, and maps over arrays the way MongoDB does. */
export function getPath(doc: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = doc;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const asIndex = Number(part);
      if (Number.isInteger(asIndex)) {
        current = current[asIndex];
        continue;
      }
      const mapped = current
        .map((item) => (item as AnyRecord)?.[part])
        .filter((item) => item !== undefined);
      current = mapped.length ? mapped : undefined;
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as AnyRecord)[part];
  }

  return current;
}

export function setPath(doc: AnyRecord, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: AnyRecord = doc;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = current[key];
    if (next === null || typeof next !== "object") {
      current[key] = {};
    }
    current = current[key] as AnyRecord;
  }

  current[parts[parts.length - 1]] = value;
}

export function unsetPath(doc: AnyRecord, path: string): void {
  const parts = path.split(".");
  let current: AnyRecord = doc;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = current[parts[i]];
    if (next === null || typeof next !== "object") return;
    current = next as AnyRecord;
  }

  delete current[parts[parts.length - 1]];
}

/* ------------------------------------------------------------------ *
 *  Comparison
 * ------------------------------------------------------------------ */

/** Normalises a value so ids, dates and primitives can be compared directly. */
function comparable(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object") return JSON.stringify(value);
  return value as string | number | boolean;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  // An id compares equal whether it arrives as ObjectId or as a hex string.
  if (a instanceof ObjectId || b instanceof ObjectId) {
    const left = ObjectId.coerce(a);
    const right = ObjectId.coerce(b);
    if (left && right) return left.toHexString() === right.toHexString();
  }
  return comparable(a) === comparable(b);
}

/** Three-way compare used by sorting and by `$gt` / `$lt` operators. */
export function compareValues(a: unknown, b: unknown): number {
  const left = comparable(a);
  const right = comparable(b);
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === "number" && typeof right === "number") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  const l = String(left);
  const r = String(right);
  return l === r ? 0 : l < r ? -1 : 1;
}

/* ------------------------------------------------------------------ *
 *  Filters
 * ------------------------------------------------------------------ */

const OPERATOR_KEYS = new Set([
  "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin",
  "$exists", "$regex", "$options", "$not", "$size", "$all", "$type", "$elemMatch",
]);

function isOperatorObject(value: unknown): value is AnyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof ObjectId) return false;
  const keys = Object.keys(value as AnyRecord);
  return keys.length > 0 && keys.every((key) => OPERATOR_KEYS.has(key));
}

function matchOperators(actual: unknown, operators: AnyRecord): boolean {
  // A stored array satisfies a scalar condition if *any* element does.
  const candidates = Array.isArray(actual) ? [actual, ...actual] : [actual];
  const anyOf = (test: (candidate: unknown) => boolean) => candidates.some(test);

  for (const [op, expected] of Object.entries(operators)) {
    switch (op) {
      case "$eq":
        if (!anyOf((c) => valuesEqual(c, expected))) return false;
        break;
      case "$ne":
        if (anyOf((c) => valuesEqual(c, expected))) return false;
        break;
      case "$gt":
        if (!anyOf((c) => c !== undefined && compareValues(c, expected) > 0)) return false;
        break;
      case "$gte":
        if (!anyOf((c) => c !== undefined && compareValues(c, expected) >= 0)) return false;
        break;
      case "$lt":
        if (!anyOf((c) => c !== undefined && compareValues(c, expected) < 0)) return false;
        break;
      case "$lte":
        if (!anyOf((c) => c !== undefined && compareValues(c, expected) <= 0)) return false;
        break;
      case "$in":
        if (!Array.isArray(expected)) return false;
        if (!anyOf((c) => expected.some((item) => valuesEqual(c, item)))) return false;
        break;
      case "$nin":
        if (!Array.isArray(expected)) return false;
        if (anyOf((c) => expected.some((item) => valuesEqual(c, item)))) return false;
        break;
      case "$exists": {
        const present = actual !== undefined && actual !== null;
        if (present !== Boolean(expected)) return false;
        break;
      }
      case "$regex": {
        const flags = typeof operators.$options === "string" ? operators.$options : "";
        const regex =
          expected instanceof RegExp ? expected : new RegExp(String(expected), flags);
        if (!anyOf((c) => typeof c === "string" && regex.test(c))) return false;
        break;
      }
      case "$options":
        break; // handled together with $regex
      case "$size":
        if (!Array.isArray(actual) || actual.length !== Number(expected)) return false;
        break;
      case "$all":
        if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
        if (!expected.every((item) => actual.some((c) => valuesEqual(c, item)))) return false;
        break;
      case "$type": {
        // Only the "string" form is used, to mirror partial unique indexes.
        const isString = typeof actual === "string";
        if (expected === "string" && !isString) return false;
        break;
      }
      case "$elemMatch":
        if (!Array.isArray(actual)) return false;
        if (!actual.some((item) => matchFilter(item as AnyRecord, expected as AnyRecord))) {
          return false;
        }
        break;
      case "$not":
        if (matchOperators(actual, expected as AnyRecord)) return false;
        break;
      default:
        return false;
    }
  }

  return true;
}

/** Does `doc` satisfy `filter`? */
export function matchFilter(doc: AnyRecord, filter: AnyRecord | undefined): boolean {
  if (!filter) return true;

  for (const [key, condition] of Object.entries(filter)) {
    if (condition === undefined) continue;

    if (key === "$and") {
      const clauses = condition as AnyRecord[];
      if (!clauses.every((clause) => matchFilter(doc, clause))) return false;
      continue;
    }
    if (key === "$or") {
      const clauses = condition as AnyRecord[];
      if (clauses.length && !clauses.some((clause) => matchFilter(doc, clause))) return false;
      continue;
    }
    if (key === "$nor") {
      const clauses = condition as AnyRecord[];
      if (clauses.some((clause) => matchFilter(doc, clause))) return false;
      continue;
    }
    if (key === "$not") {
      if (matchFilter(doc, condition as AnyRecord)) return false;
      continue;
    }

    const actual = getPath(doc, key);

    if (condition instanceof RegExp) {
      const candidates = Array.isArray(actual) ? actual : [actual];
      if (!candidates.some((c) => typeof c === "string" && condition.test(c))) return false;
      continue;
    }

    if (isOperatorObject(condition)) {
      if (!matchOperators(actual, condition as AnyRecord)) return false;
      continue;
    }

    if (Array.isArray(actual) && !Array.isArray(condition)) {
      if (!actual.some((item) => valuesEqual(item, condition))) return false;
      continue;
    }

    if (!valuesEqual(actual, condition)) return false;
  }

  return true;
}

/* ------------------------------------------------------------------ *
 *  Sorting
 * ------------------------------------------------------------------ */

export type SortSpec = Record<string, 1 | -1> | string;

export function normaliseSort(spec: SortSpec | undefined): Array<[string, 1 | -1]> {
  if (!spec) return [];
  if (typeof spec === "string") {
    return spec
      .split(/\s+/)
      .filter(Boolean)
      .map((token) =>
        token.startsWith("-") ? [token.slice(1), -1 as const] : [token, 1 as const],
      );
  }
  return Object.entries(spec).map(([key, direction]) => [key, direction >= 0 ? 1 : -1]);
}

export function sortDocuments(docs: AnyRecord[], spec: SortSpec | undefined): AnyRecord[] {
  const rules = normaliseSort(spec);
  if (!rules.length) return docs;

  return [...docs].sort((a, b) => {
    for (const [field, direction] of rules) {
      const result = compareValues(getPath(a, field), getPath(b, field));
      if (result !== 0) return result * direction;
    }
    return 0;
  });
}

/* ------------------------------------------------------------------ *
 *  Projection
 * ------------------------------------------------------------------ */

export type Projection = Record<string, 0 | 1 | boolean> | string;

export type ParsedProjection = {
  include: string[];
  exclude: string[];
  forceInclude: string[];
};

/** Understands `"a b -c"`, `"+hidden"` and `{ a: 1, b: 0 }`. */
export function parseProjection(spec: Projection | undefined): ParsedProjection | null {
  if (!spec) return null;

  const include: string[] = [];
  const exclude: string[] = [];
  const forceInclude: string[] = [];

  if (typeof spec === "string") {
    for (const token of spec.split(/\s+/).filter(Boolean)) {
      if (token.startsWith("+")) forceInclude.push(token.slice(1));
      else if (token.startsWith("-")) exclude.push(token.slice(1));
      else include.push(token);
    }
  } else {
    for (const [key, value] of Object.entries(spec)) {
      if (value) include.push(key);
      else exclude.push(key);
    }
  }

  if (!include.length && !exclude.length && !forceInclude.length) return null;
  return { include, exclude, forceInclude };
}

export function applyProjection(doc: AnyRecord, projection: ParsedProjection | null): AnyRecord {
  if (!projection) return doc;
  const { include, exclude } = projection;

  if (include.length) {
    const out: AnyRecord = {};
    setPath(out, "_id", doc._id);
    for (const field of include) {
      const value = getPath(doc, field);
      if (value !== undefined) setPath(out, field, value);
    }
    for (const field of exclude) {
      if (field === "_id") delete out._id;
    }
    return out;
  }

  const out = clone(doc);
  for (const field of exclude) unsetPath(out, field);
  return out;
}

/* ------------------------------------------------------------------ *
 *  Updates
 * ------------------------------------------------------------------ */

/** Applies `$set` / `$unset` / `$inc` / `$push` / `$pull` / `$addToSet`. */
export function applyUpdate(doc: AnyRecord, update: AnyRecord): AnyRecord {
  const operatorKeys = Object.keys(update).filter((key) => key.startsWith("$"));

  // A plain object with no operators replaces every field it mentions.
  if (!operatorKeys.length) {
    for (const [key, value] of Object.entries(update)) {
      if (key === "_id") continue;
      setPath(doc, key, value);
    }
    return doc;
  }

  for (const key of operatorKeys) {
    const payload = update[key] as AnyRecord;

    switch (key) {
      case "$set":
        for (const [field, value] of Object.entries(payload)) setPath(doc, field, value);
        break;
      case "$setOnInsert":
        break; // handled by the caller, which knows whether it inserted
      case "$unset":
        for (const field of Object.keys(payload)) unsetPath(doc, field);
        break;
      case "$inc":
        for (const [field, amount] of Object.entries(payload)) {
          const current = Number(getPath(doc, field) ?? 0);
          setPath(doc, field, current + Number(amount));
        }
        break;
      case "$min":
        for (const [field, value] of Object.entries(payload)) {
          const current = getPath(doc, field);
          if (current === undefined || compareValues(value, current) < 0) {
            setPath(doc, field, value);
          }
        }
        break;
      case "$max":
        for (const [field, value] of Object.entries(payload)) {
          const current = getPath(doc, field);
          if (current === undefined || compareValues(value, current) > 0) {
            setPath(doc, field, value);
          }
        }
        break;
      case "$push":
        for (const [field, value] of Object.entries(payload)) {
          const current = getPath(doc, field);
          const list = Array.isArray(current) ? [...current] : [];
          const each = (value as AnyRecord)?.$each;
          if (Array.isArray(each)) list.push(...each);
          else list.push(value);
          setPath(doc, field, list);
        }
        break;
      case "$addToSet":
        for (const [field, value] of Object.entries(payload)) {
          const current = getPath(doc, field);
          const list = Array.isArray(current) ? [...current] : [];
          const each = Array.isArray((value as AnyRecord)?.$each)
            ? ((value as AnyRecord).$each as unknown[])
            : [value];
          for (const item of each) {
            if (!list.some((existing) => valuesEqual(existing, item))) list.push(item);
          }
          setPath(doc, field, list);
        }
        break;
      case "$pull":
        for (const [field, condition] of Object.entries(payload)) {
          const current = getPath(doc, field);
          if (!Array.isArray(current)) continue;
          setPath(
            doc,
            field,
            current.filter((item) =>
              isOperatorObject(condition)
                ? !matchOperators(item, condition as AnyRecord)
                : !valuesEqual(item, condition),
            ),
          );
        }
        break;
      case "$pop":
        for (const [field, direction] of Object.entries(payload)) {
          const current = getPath(doc, field);
          if (!Array.isArray(current) || !current.length) continue;
          const list = [...current];
          if (Number(direction) < 0) list.shift();
          else list.pop();
          setPath(doc, field, list);
        }
        break;
      default:
        throw new Error(`Unsupported update operator "${key}"`);
    }
  }

  return doc;
}

/** Builds the seed document for an upsert that matched nothing. */
export function upsertSeed(filter: AnyRecord, update: AnyRecord): AnyRecord {
  const seed: AnyRecord = {};

  // Equality conditions in the filter describe the document being created.
  for (const [key, condition] of Object.entries(filter)) {
    if (key.startsWith("$")) continue;
    if (isOperatorObject(condition)) {
      const eq = (condition as AnyRecord).$eq;
      if (eq !== undefined) setPath(seed, key, eq);
      continue;
    }
    if (condition instanceof RegExp) continue;
    setPath(seed, key, condition);
  }

  const setOnInsert = update.$setOnInsert as AnyRecord | undefined;
  if (setOnInsert) {
    for (const [field, value] of Object.entries(setOnInsert)) setPath(seed, field, value);
  }

  return seed;
}
