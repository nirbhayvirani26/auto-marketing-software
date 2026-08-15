import { randomBytes } from "node:crypto";

/**
 * A 12-byte identifier, byte-for-byte compatible with the MongoDB ObjectId
 * layout so existing ids keep working after the move to the local database:
 *
 *   [0..3]  seconds since epoch   (sortable by creation time)
 *   [4..8]  per-process random    (unique across machines/processes)
 *   [9..11] incrementing counter  (unique inside one process)
 */
const PROCESS_RANDOM = randomBytes(5);
let counter = randomBytes(3).readUIntBE(0, 3);

const HEX_24 = /^[0-9a-fA-F]{24}$/;

export class ObjectId {
  private readonly hex: string;

  constructor(value?: string | ObjectId | null) {
    if (value == null) {
      this.hex = ObjectId.generate();
      return;
    }
    if (value instanceof ObjectId) {
      this.hex = value.hex;
      return;
    }
    const raw = String(value);
    if (!HEX_24.test(raw)) {
      throw new Error(`Invalid ObjectId: "${raw}"`);
    }
    this.hex = raw.toLowerCase();
  }

  /** Builds a fresh 24-character hex id. */
  static generate(): string {
    const buffer = Buffer.allocUnsafe(12);
    buffer.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
    PROCESS_RANDOM.copy(buffer, 4);
    counter = (counter + 1) % 0xffffff;
    buffer.writeUIntBE(counter, 9, 3);
    return buffer.toString("hex");
  }

  static isValid(value: unknown): boolean {
    if (value instanceof ObjectId) return true;
    return typeof value === "string" && HEX_24.test(value);
  }

  /** Accepts anything id-shaped and returns an ObjectId, or null. */
  static coerce(value: unknown): ObjectId | null {
    if (value instanceof ObjectId) return value;
    if (typeof value === "string" && HEX_24.test(value)) return new ObjectId(value);
    if (
      value &&
      typeof value === "object" &&
      "_id" in (value as Record<string, unknown>)
    ) {
      return ObjectId.coerce((value as Record<string, unknown>)._id);
    }
    return null;
  }

  toHexString(): string {
    return this.hex;
  }

  toString(): string {
    return this.hex;
  }

  toJSON(): string {
    return this.hex;
  }

  /** Lets `String(id)`, template literals and `JSON.stringify` all agree. */
  valueOf(): string {
    return this.hex;
  }

  get id(): string {
    return this.hex;
  }

  equals(other: unknown): boolean {
    const coerced = ObjectId.coerce(other);
    return coerced !== null && coerced.hex === this.hex;
  }

  /** Creation time, recovered from the first four bytes. */
  getTimestamp(): Date {
    return new Date(parseInt(this.hex.slice(0, 8), 16) * 1000);
  }
}

export function isValidObjectId(value: unknown): boolean {
  return ObjectId.isValid(value);
}

/** Compares two id-shaped values without caring which form each one is in. */
export function sameId(a: unknown, b: unknown): boolean {
  const left = ObjectId.coerce(a);
  const right = ObjectId.coerce(b);
  if (!left || !right) return false;
  return left.toHexString() === right.toHexString();
}
