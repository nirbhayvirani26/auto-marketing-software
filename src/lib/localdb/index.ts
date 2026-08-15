/**
 * A small embedded document database that stores every collection as a JSON
 * file inside the project.
 *
 * Why not MongoDB: this tool is meant to be handed over as a folder. Zip it,
 * send it, `npm install && npm run dev` — and the data is already there. No
 * server to install, no connection string to configure, no service to keep
 * running. The `data/` directory *is* the database.
 *
 * The API deliberately mirrors the small slice of Mongoose the application
 * used before, so route handlers read exactly the same way:
 *
 *   const posts = await Post.find({ brand }).sort({ createdAt: -1 }).limit(20).lean();
 *   const post  = await Post.findById(id);
 *   post.status = "published";
 *   await post.save();
 */

export { ObjectId, isValidObjectId, sameId } from "./object-id";
export { Schema, Mixed } from "./schema";
export type {
  SchemaDefinition,
  SchemaOptions,
  FieldDefinition,
  IndexOptions,
} from "./schema";
export {
  model,
  models,
  Model,
  Query,
  DuplicateKeyError,
} from "./model";
export type {
  BaseFields,
  DocumentMethods,
  HydratedDocument,
  FilterQuery,
  UpdateQuery,
  UpdateOptions,
  Writable,
  WritableDoc,
} from "./model";
export { dataDir, setDataDir, flushAllCollections } from "./storage";
export type { AnyRecord, Projection, SortSpec } from "./query-engine";

import { ObjectId } from "./object-id";

/** Mirrors `mongoose.Types` so model files can keep the familiar spelling. */
export const Types = { ObjectId };
