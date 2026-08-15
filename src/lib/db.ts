import { existsSync, mkdirSync } from "node:fs";

import { dataDir, flushAllCollections } from "./localdb";

/**
 * Database bootstrap.
 *
 * There is no server to connect to — the database is the `data/` folder next
 * to the source code. This module only makes sure that folder exists, so the
 * rest of the app can keep calling `connectDB()` at the top of a request the
 * way it always did.
 */

let ready = false;

export async function connectDB(): Promise<void> {
  if (ready) return;
  const directory = dataDir();
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  ready = true;
}

/** True whenever the data directory is usable. */
export async function isDbReachable(): Promise<boolean> {
  try {
    await connectDB();
    return true;
  } catch {
    return false;
  }
}

/** Where the JSON collections live — shown on the Settings page. */
export function databaseLocation(): string {
  return dataDir();
}

/** Forces pending writes to disk. Scripts call this before exiting. */
export function flushDatabase(): void {
  flushAllCollections();
}
