import { ObjectId } from "./object-id";
import type { AnyRecord } from "./query-engine";

/**
 * A trimmed-down schema: the parts of the Mongoose declaration style that this
 * application relies on — types, defaults, enums, required fields, trimming,
 * hidden fields (`select: false`), references for `populate()`, plus unique and
 * TTL indexes.
 */

export const Mixed = Symbol("Mixed");
export type MixedType = typeof Mixed;

export type SchemaTypeConstructor =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | DateConstructor
  | typeof ObjectId
  | MixedType
  | Schema;

export type FieldDefinition = {
  type: SchemaTypeConstructor | [SchemaTypeConstructor] | SchemaTypeConstructor[];
  ref?: string;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  sparse?: boolean;
  select?: boolean;
  trim?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  enum?: readonly string[];
  min?: number;
  max?: number;
  default?: unknown;
};

export type SchemaDefinition = {
  [path: string]: FieldDefinition | SchemaDefinition | SchemaTypeConstructor | unknown[];
};

export type SchemaOptions = {
  timestamps?: boolean;
  versionKey?: boolean;
  _id?: boolean;
};

export type IndexOptions = {
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: AnyRecord;
};

export type SchemaIndex = {
  fields: Array<[string, 1 | -1]>;
  options: IndexOptions;
};

/* ------------------------------------------------------------------ *
 *  Compiled field metadata
 * ------------------------------------------------------------------ */

export type CompiledField = {
  path: string;
  kind: "string" | "number" | "boolean" | "date" | "objectid" | "mixed" | "subdocument";
  isArray: boolean;
  subSchema?: Schema;
  ref?: string;
  required: boolean;
  select: boolean;
  trim: boolean;
  lowercase: boolean;
  uppercase: boolean;
  enum?: readonly string[];
  min?: number;
  max?: number;
  default?: unknown;
  hasDefault: boolean;
};

function isSchemaInstance(value: unknown): value is Schema {
  return value instanceof Schema;
}

function isFieldDefinition(value: unknown): value is FieldDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (isSchemaInstance(value)) return false;
  return "type" in (value as AnyRecord);
}

function isTypeConstructor(value: unknown): value is SchemaTypeConstructor {
  return (
    value === String ||
    value === Number ||
    value === Boolean ||
    value === Date ||
    value === ObjectId ||
    value === Mixed ||
    isSchemaInstance(value)
  );
}

function kindOf(type: SchemaTypeConstructor): CompiledField["kind"] {
  if (type === String) return "string";
  if (type === Number) return "number";
  if (type === Boolean) return "boolean";
  if (type === Date) return "date";
  if (type === ObjectId) return "objectid";
  if (isSchemaInstance(type)) return "subdocument";
  return "mixed";
}

/* ------------------------------------------------------------------ *
 *  Schema
 * ------------------------------------------------------------------ */

export class Schema {
  readonly definition: SchemaDefinition;
  readonly options: SchemaOptions;
  readonly fields = new Map<string, CompiledField>();
  readonly indexes: SchemaIndex[] = [];
  readonly methods: Record<string, (...args: never[]) => unknown> = {};

  /** Mirrors `mongoose.Schema.Types` so model files read the same way. */
  static Types: {
    ObjectId: typeof ObjectId;
    Mixed: MixedType;
    String: StringConstructor;
    Number: NumberConstructor;
    Boolean: BooleanConstructor;
    Date: DateConstructor;
  } = {
    ObjectId,
    Mixed,
    String,
    Number,
    Boolean,
    Date,
  };

  constructor(definition: SchemaDefinition, options: SchemaOptions = {}) {
    this.definition = definition;
    this.options = { timestamps: false, versionKey: false, _id: true, ...options };
    this.compile(definition, "");
  }

  private compile(definition: SchemaDefinition, prefix: string): void {
    for (const [key, raw] of Object.entries(definition)) {
      const path = prefix ? `${prefix}.${key}` : key;

      // `field: [{ type: ObjectId, ref: "X" }]` — array shorthand
      if (Array.isArray(raw)) {
        const [inner] = raw as unknown[];
        if (isFieldDefinition(inner)) {
          this.addField(path, { ...inner, type: [inner.type as SchemaTypeConstructor] });
        } else if (isTypeConstructor(inner)) {
          this.addField(path, { type: [inner] });
        } else {
          this.addField(path, { type: Mixed });
        }
        continue;
      }

      // `field: String` — bare constructor shorthand
      if (isTypeConstructor(raw)) {
        this.addField(path, { type: raw });
        continue;
      }

      // `field: { type: …, … }` — full descriptor
      if (isFieldDefinition(raw)) {
        this.addField(path, raw);
        continue;
      }

      // Anything else is a nested object of further paths.
      if (raw && typeof raw === "object") {
        this.compile(raw as SchemaDefinition, path);
        continue;
      }

      this.addField(path, { type: Mixed });
    }
  }

  private addField(path: string, definition: FieldDefinition): void {
    const rawType = definition.type;
    const isArray = Array.isArray(rawType);
    const baseType = (isArray ? rawType[0] : rawType) as SchemaTypeConstructor;

    const field: CompiledField = {
      path,
      kind: kindOf(baseType),
      isArray,
      subSchema: isSchemaInstance(baseType) ? baseType : undefined,
      ref: definition.ref,
      required: Boolean(definition.required),
      select: definition.select !== false,
      trim: Boolean(definition.trim),
      lowercase: Boolean(definition.lowercase),
      uppercase: Boolean(definition.uppercase),
      enum: definition.enum,
      min: definition.min,
      max: definition.max,
      default: definition.default,
      hasDefault: "default" in definition,
    };

    this.fields.set(path, field);

    if (definition.unique) {
      this.indexes.push({ fields: [[path, 1]], options: { unique: true, sparse: true } });
    }
  }

  /** Declares a compound, unique or TTL index. */
  index(spec: Record<string, 1 | -1>, options: IndexOptions = {}): this {
    this.indexes.push({
      fields: Object.entries(spec).map(([field, direction]) => [
        field,
        direction >= 0 ? 1 : -1,
      ]),
      options,
    });
    return this;
  }

  field(path: string): CompiledField | undefined {
    return this.fields.get(path);
  }

  /** Paths marked `select: false`, hidden unless explicitly requested. */
  hiddenPaths(): string[] {
    const paths: string[] = [];
    for (const [path, field] of this.fields) {
      if (!field.select) paths.push(path);
    }
    return paths;
  }

  /** Reference paths, keyed by path — drives `populate()`. */
  references(): Map<string, { ref: string; isArray: boolean }> {
    const refs = new Map<string, { ref: string; isArray: boolean }>();
    for (const [path, field] of this.fields) {
      if (field.ref) refs.set(path, { ref: field.ref, isArray: field.isArray });
    }
    return refs;
  }

  /** Index entries that expire documents after a period. */
  ttlIndexes(): Array<{ path: string; seconds: number }> {
    const out: Array<{ path: string; seconds: number }> = [];
    for (const index of this.indexes) {
      if (index.options.expireAfterSeconds === undefined) continue;
      out.push({
        path: index.fields[0][0],
        seconds: index.options.expireAfterSeconds,
      });
    }
    return out;
  }

  uniqueIndexes(): SchemaIndex[] {
    return this.indexes.filter((index) => index.options.unique);
  }

  /* ---------------------------------------------------------------- *
   *  Casting
   * ---------------------------------------------------------------- */

  private castScalar(field: CompiledField, value: unknown): unknown {
    if (value === null || value === undefined) return value;

    switch (field.kind) {
      case "string": {
        let text = typeof value === "string" ? value : String(value);
        if (field.trim) text = text.trim();
        if (field.lowercase) text = text.toLowerCase();
        if (field.uppercase) text = text.toUpperCase();
        return text;
      }
      case "number": {
        const num = typeof value === "number" ? value : Number(value);
        return Number.isNaN(num) ? undefined : num;
      }
      case "boolean":
        if (typeof value === "boolean") return value;
        if (value === "true") return true;
        if (value === "false") return false;
        return Boolean(value);
      case "date": {
        if (value instanceof Date) return value;
        const date = new Date(value as string | number);
        return Number.isNaN(date.getTime()) ? undefined : date;
      }
      case "objectid": {
        if (value instanceof ObjectId) return value;
        const coerced = ObjectId.coerce(value);
        return coerced ?? undefined;
      }
      case "subdocument":
        return field.subSchema
          ? field.subSchema.cast(value as AnyRecord, { partial: true })
          : value;
      default:
        return value;
    }
  }

  /** Applies types, trimming and defaults to one document. */
  cast(input: AnyRecord, options: { partial?: boolean } = {}): AnyRecord {
    const out: AnyRecord = { ...input };

    for (const [path, field] of this.fields) {
      const raw = readPath(out, path);

      if (raw === undefined) {
        if (options.partial || !field.hasDefault) continue;
        const fallback =
          typeof field.default === "function"
            ? (field.default as () => unknown)()
            : field.default;
        writePath(out, path, Array.isArray(fallback) ? [...fallback] : fallback);
        continue;
      }

      if (field.isArray) {
        const list = Array.isArray(raw) ? raw : [raw];
        writePath(
          out,
          path,
          list.map((item) => this.castScalar(field, item)).filter((item) => item !== undefined),
        );
        continue;
      }

      writePath(out, path, this.castScalar(field, raw));
    }

    return out;
  }

  /** Throws on missing required fields and values outside an `enum`. */
  validate(doc: AnyRecord, modelName: string): void {
    for (const [path, field] of this.fields) {
      const value = readPath(doc, path);

      if (field.required && (value === undefined || value === null || value === "")) {
        throw new Error(`${modelName} validation failed: "${path}" is required.`);
      }
      if (value === undefined || value === null) continue;

      if (field.enum?.length) {
        const values = field.isArray ? (value as unknown[]) : [value];
        for (const item of values) {
          if (item === null || item === undefined) continue;
          if (!field.enum.includes(String(item))) {
            throw new Error(
              `${modelName} validation failed: "${path}" must be one of ${field.enum.join(", ")} (got "${String(item)}").`,
            );
          }
        }
      }

      if (field.kind === "number" && !field.isArray) {
        const num = value as number;
        if (field.min !== undefined && num < field.min) {
          throw new Error(`${modelName} validation failed: "${path}" must be >= ${field.min}.`);
        }
        if (field.max !== undefined && num > field.max) {
          throw new Error(`${modelName} validation failed: "${path}" must be <= ${field.max}.`);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Small path helpers (kept local so schema.ts has no cycle back to
 *  query-engine.ts, which imports nothing from here)
 * ------------------------------------------------------------------ */

function readPath(doc: AnyRecord, path: string): unknown {
  if (!path.includes(".")) return doc[path];
  let current: unknown = doc;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as AnyRecord)[part];
  }
  return current;
}

function writePath(doc: AnyRecord, path: string, value: unknown): void {
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
