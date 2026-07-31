import mongoose from "mongoose";
import { env } from "./env";

/**
 * Next.js dev mode hot-reloads modules, so the connection is cached on
 * `globalThis` to avoid opening a new pool on every reload.
 */
type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalForMongoose = globalThis as unknown as {
  _mongooseCache?: MongooseCache;
};

const cache: MongooseCache = globalForMongoose._mongooseCache ?? {
  conn: null,
  promise: null,
};
globalForMongoose._mongooseCache = cache;

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    mongoose.set("strictQuery", true);
    cache.promise = mongoose.connect(env.mongodbUri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 10,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    cache.promise = null;
    throw error;
  }

  return cache.conn;
}

export async function isDbReachable(): Promise<boolean> {
  try {
    await connectDB();
    return mongoose.connection.readyState === 1;
  } catch {
    return false;
  }
}
