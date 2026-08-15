import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import type { AnyRecord } from "./query-engine";
import { parseDocuments, serializeDocuments } from "./serialize";

/**
 * Every collection is one JSON file inside the data directory. The whole
 * collection is held in memory and written back after a change, which is the
 * right trade for a single-tenant tool: no database server to install, and the
 * entire dataset travels with the project folder when it is shared or zipped.
 *
 *   data/
 *     posts.json
 *     brands.json
 *     ...
 */

const DEFAULT_DIR = "data";

let cachedDir: string | null = null;

export function dataDir(): string {
  if (cachedDir) return cachedDir;
  const configured = process.env.LOCAL_DB_DIR?.trim();
  cachedDir = resolve(process.cwd(), configured || DEFAULT_DIR);
  if (!existsSync(cachedDir)) mkdirSync(cachedDir, { recursive: true });
  return cachedDir;
}

/** Test helper — points the store at a throwaway directory. */
export function setDataDir(dir: string): void {
  cachedDir = resolve(dir);
  if (!existsSync(cachedDir)) mkdirSync(cachedDir, { recursive: true });
}

/* ------------------------------------------------------------------ */

export class CollectionFile {
  readonly name: string;

  private docs: AnyRecord[] | null = null;
  private dirty = false;

  constructor(name: string) {
    this.name = name;
  }

  private get path(): string {
    return join(dataDir(), `${this.name}.json`);
  }

  /** Reads the file once, then serves everything from memory. */
  all(): AnyRecord[] {
    if (this.docs) return this.docs;

    try {
      if (existsSync(this.path)) {
        this.docs = parseDocuments(readFileSync(this.path, "utf8"));
      } else {
        this.docs = [];
      }
    } catch (error) {
      // A corrupt file must not take the whole app down: keep the broken copy
      // for inspection and carry on with an empty collection.
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(
          `[localdb] "${this.name}.json" could not be parsed (${(error as Error).message}). ` +
            `Moved to ${backup} and started an empty collection.`,
        );
      } catch {
        console.error(`[localdb] "${this.name}.json" could not be parsed or moved aside.`);
      }
      this.docs = [];
    }

    registerOpenCollection(this);
    return this.docs;
  }

  replaceAll(docs: AnyRecord[]): void {
    this.docs = docs;
    this.markDirty();
  }

  /**
   * Writes the collection to disk, now.
   *
   * This used to be debounced by a few milliseconds to batch bursts of
   * inserts. That traded correctness for an optimisation nobody needed: these
   * files are kilobytes, and a change that has not reached disk is lost the
   * moment the process is replaced — which in Next.js development happens on
   * every hot reload, silently, in the middle of a long job.
   *
   * A synchronous write costs well under a millisecond here and removes that
   * entire class of bug.
   */
  markDirty(): void {
    this.dirty = true;
    this.flush();
  }

  /** Writes to a temporary file first so a crash cannot truncate the real one. */
  flush(): void {
    if (!this.dirty || !this.docs) return;
    this.dirty = false;

    const target = this.path;
    const temporary = `${target}.tmp`;
    try {
      writeFileSync(temporary, serializeDocuments(this.docs), "utf8");
      renameSync(temporary, target);
    } catch (error) {
      this.dirty = true;
      console.error(`[localdb] Failed to write "${this.name}.json":`, error);
    }
  }
}

/* ------------------------------------------------------------------ */

const collections = new Map<string, CollectionFile>();
const openCollections = new Set<CollectionFile>();
let exitHookInstalled = false;

function registerOpenCollection(collection: CollectionFile): void {
  openCollections.add(collection);
  if (exitHookInstalled) return;
  exitHookInstalled = true;

  const flushAll = () => {
    for (const item of openCollections) item.flush();
  };

  process.on("exit", flushAll);
  process.on("SIGINT", () => {
    flushAll();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    flushAll();
    process.exit(0);
  });
}

export function collectionFile(name: string): CollectionFile {
  const existing = collections.get(name);
  if (existing) return existing;
  const created = new CollectionFile(name);
  collections.set(name, created);
  return created;
}

/** Forces every pending write to disk — used by scripts before they exit. */
export function flushAllCollections(): void {
  for (const collection of openCollections) collection.flush();
}
