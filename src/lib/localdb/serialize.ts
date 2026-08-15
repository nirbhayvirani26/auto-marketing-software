import { ObjectId } from "./object-id";

/**
 * JSON has no ObjectId and no Date, so both are written as tagged objects and
 * restored on read. The tags match the MongoDB Extended JSON spelling, which
 * keeps the on-disk files readable by anyone who opens them in an editor.
 *
 *   ObjectId("64f…")  ->  { "$oid":  "64f…" }
 *   new Date(…)       ->  { "$date": "2026-08-15T09:30:00.000Z" }
 */

type Tagged = { $oid?: string; $date?: string };

export function encode(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof ObjectId) return { $oid: value.toHexString() };
  if (value instanceof Date) {
    return { $date: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = encode(item);
    }
    return out;
  }
  return value;
}

export function decode(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === "object") {
    const tagged = value as Tagged;
    if (typeof tagged.$oid === "string") return new ObjectId(tagged.$oid);
    if ("$date" in tagged) {
      return tagged.$date ? new Date(tagged.$date) : null;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = decode(item);
    }
    return out;
  }
  return value;
}

/** Structural copy that keeps ObjectId and Date instances intact. */
export function clone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof ObjectId) return new ObjectId(value) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = clone(item);
    }
    return out as T;
  }
  return value;
}

export function serializeDocuments(docs: unknown[]): string {
  return JSON.stringify(encode(docs), null, 2);
}

export function parseDocuments(text: string): Record<string, unknown>[] {
  if (!text.trim()) return [];
  const parsed = decode(JSON.parse(text));
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
}
