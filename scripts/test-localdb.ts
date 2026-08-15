/**
 * Local database test suite.
 *
 *   npm run test:db
 *
 * Runs against a throwaway data directory, so it never touches real content.
 * Covers the whole engine: casting, defaults, validation, every query and
 * update operator, sorting, projections, hidden fields, populate, unique
 * indexes, TTL expiry, and reloading from disk.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ObjectId,
  Schema,
  model,
  setDataDir,
  flushAllCollections,
} from "../src/lib/localdb";
import { parseDocuments } from "../src/lib/localdb/serialize";

const workDir = mkdtempSync(join(tmpdir(), "localdb-test-"));
process.env.LOCAL_DB_DIR = workDir;
setDataDir(workDir);

/* ------------------------------------------------------------------ *
 *  Tiny test harness
 * ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(detail === undefined ? name : `${name}\n      got: ${JSON.stringify(detail)}`);
}

function section(title: string): void {
  console.log(`\n  ${title}`);
}

/* ------------------------------------------------------------------ *
 *  Schemas
 * ------------------------------------------------------------------ */

type AuthorDoc = {
  _id: InstanceType<typeof ObjectId>;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  email: string;
  secret: string;
};

const AuthorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    secret: { type: String, select: false },
  },
  { timestamps: true },
);

const Author = model<AuthorDoc>("TestAuthor", AuthorSchema);

type ArticleDoc = {
  _id: InstanceType<typeof ObjectId>;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  author: InstanceType<typeof ObjectId>;
  tags: string[];
  views: number;
  status: "draft" | "published";
  publishedAt?: Date;
  meta?: unknown;
  revisions: { label: string; at: Date }[];
};

const RevisionSchema = new Schema({
  label: { type: String, required: true },
  at: { type: Date },
});

const ArticleSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    author: { type: Schema.Types.ObjectId, ref: "TestAuthor", required: true },
    tags: { type: [String], default: [] },
    views: { type: Number, default: 0 },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    publishedAt: { type: Date },
    meta: { type: Schema.Types.Mixed },
    revisions: { type: [RevisionSchema], default: [] },
  },
  { timestamps: true },
);

const Article = model<ArticleDoc>("TestArticle", ArticleSchema);

type SessionDoc = {
  _id: InstanceType<typeof ObjectId>;
  createdAt: Date;
  updatedAt: Date;
  token: string;
};

const SessionSchema = new Schema({ token: { type: String, required: true } }, { timestamps: true });
// Deliberately already expired, so the sweep has something to remove.
SessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 0 });

const Session = model<SessionDoc>("TestSession", SessionSchema);

/* ------------------------------------------------------------------ *
 *  Tests
 * ------------------------------------------------------------------ */

async function run() {
  section("Identifiers");
  {
    const a = new ObjectId();
    const b = new ObjectId(a.toHexString());
    check("a new id is 24 hex characters", /^[0-9a-f]{24}$/.test(a.toHexString()));
    check("two ids for the same value are equal", a.equals(b));
    check("string form round-trips", String(a) === a.toHexString());
    check("JSON form is the hex string", JSON.stringify(a) === `"${a.toHexString()}"`);
    check("timestamp is close to now", Math.abs(a.getTimestamp().getTime() - Date.now()) < 5000);
    check("garbage is rejected", ObjectId.isValid("nope") === false);
    check("ids sort by creation order", new ObjectId().toHexString() > a.toHexString());
  }

  section("Create, cast and default");
  const author = await Author.create({
    name: "  Priya Shah  ",
    email: "PRIYA@Example.COM ",
    secret: "top-secret",
  });
  {
    check("string fields are trimmed", author.name === "Priya Shah", author.name);
    check("lowercase applies", author.email === "priya@example.com", author.email);
    check("an id was assigned", ObjectId.isValid(author._id));
    check("createdAt was stamped", author.createdAt instanceof Date);
    check("updatedAt was stamped", author.updatedAt instanceof Date);
  }

  const article = await Article.create({
    title: "Marketing on autopilot",
    // Passing a hex string where an ObjectId belongs must be accepted.
    author: String(author._id),
    tags: ["ai", "marketing"],
  });
  {
    check("defaults fill in", article.views === 0 && article.status === "draft");
    check("array default is present", Array.isArray(article.revisions));
    check(
      "a hex string was cast to an ObjectId",
      article.author instanceof ObjectId && article.author.equals(author._id),
    );
  }

  section("Validation");
  {
    let rejected = false;
    try {
      await Article.create({ title: "No author" } as never);
    } catch {
      rejected = true;
    }
    check("a missing required field is rejected", rejected);

    rejected = false;
    try {
      await Article.create({
        title: "Bad status",
        author: author._id,
        status: "archived" as never,
      });
    } catch {
      rejected = true;
    }
    check("a value outside the enum is rejected", rejected);

    rejected = false;
    try {
      await Author.create({ name: "Duplicate", email: "priya@example.com" });
    } catch (error) {
      rejected = (error as { code?: number }).code === 11000;
    }
    check("a duplicate unique value is rejected with code 11000", rejected);
  }

  section("Hidden fields");
  {
    const found = await Author.findById(author._id).lean();
    check("a select:false field is hidden by default", found?.secret === undefined);

    const withSecret = await Author.findById(author._id).select("+secret").lean();
    check("+field reveals it", withSecret?.secret === "top-secret", withSecret?.secret);
  }

  section("Reading and sorting");
  await Article.create({
    title: "Reels that convert",
    author: author._id,
    tags: ["reels", "ai"],
    views: 120,
    status: "published",
    publishedAt: new Date("2026-03-01T10:00:00Z"),
  });
  await Article.create({
    title: "Hashtag ladders",
    author: author._id,
    tags: ["hashtags"],
    views: 45,
    status: "published",
    publishedAt: new Date("2026-05-01T10:00:00Z"),
  });
  {
    const all = await Article.find().lean();
    check("every document comes back", all.length === 3, all.length);

    const byViews = await Article.find().sort({ views: -1 }).lean();
    check("descending sort works", byViews[0].views === 120, byViews.map((a) => a.views));

    const byViewsAsc = await Article.find().sort("views").lean();
    check("string sort syntax works", byViewsAsc[0].views === 0);

    const byStatusThenViews = await Article.find().sort({ status: 1, views: -1 }).lean();
    check(
      "multi-key sort works",
      byStatusThenViews[0].status === "draft" && byStatusThenViews[1].views === 120,
    );

    const limited = await Article.find().sort({ views: -1 }).limit(2).lean();
    check("limit works", limited.length === 2);

    const skipped = await Article.find().sort({ views: -1 }).skip(1).limit(1).lean();
    check("skip works", skipped[0].views === 45, skipped[0].views);

    const one = await Article.findOne({ status: "published" }).sort({ views: -1 }).lean();
    check("findOne respects sort", one?.views === 120);

    const missing = await Article.findById(new ObjectId());
    check("an unknown id gives null", missing === null);

    const invalid = await Article.findById("not-an-id");
    check("an unparseable id gives null instead of throwing", invalid === null);
  }

  section("Query operators");
  {
    const gte = await Article.find({ views: { $gte: 45 } }).lean();
    check("$gte works", gte.length === 2, gte.length);

    const range = await Article.find({ views: { $gt: 0, $lt: 100 } }).lean();
    check("a combined range works", range.length === 1 && range[0].views === 45);

    const inList = await Article.find({ status: { $in: ["published"] } }).lean();
    check("$in works", inList.length === 2);

    const notIn = await Article.find({ status: { $nin: ["published"] } }).lean();
    check("$nin works", notIn.length === 1);

    const ne = await Article.find({ views: { $ne: 0 } }).lean();
    check("$ne works", ne.length === 2);

    const tagged = await Article.find({ tags: "ai" }).lean();
    check("matching one element of an array works", tagged.length === 2, tagged.length);

    const allTags = await Article.find({ tags: { $all: ["ai", "reels"] } }).lean();
    check("$all works", allTags.length === 1);

    const exists = await Article.find({ publishedAt: { $exists: true } }).lean();
    check("$exists works", exists.length === 2);

    const regex = await Article.find({ title: { $regex: "reel", $options: "i" } }).lean();
    check("$regex with options works", regex.length === 1, regex.map((a) => a.title));

    const or = await Article.find({ $or: [{ views: 120 }, { views: 45 }] }).lean();
    check("$or works", or.length === 2);

    const and = await Article.find({ $and: [{ status: "published" }, { views: { $lt: 100 } }] }).lean();
    check("$and works", and.length === 1);

    const byDate = await Article.find({
      publishedAt: { $gte: new Date("2026-04-01T00:00:00Z") },
    }).lean();
    check("date comparison works", byDate.length === 1, byDate.map((a) => a.title));

    const byRef = await Article.find({ author: String(author._id) }).lean();
    check("a reference matches a hex string", byRef.length === 3);

    check("countDocuments works", (await Article.countDocuments({ status: "published" })) === 2);
    check("exists works", (await Article.exists({ views: 120 })) !== null);

    const distinctTags = (await Article.distinct("tags")) as string[];
    check(
      "distinct flattens arrays and de-duplicates",
      distinctTags.length === 4 && distinctTags.includes("ai"),
      distinctTags,
    );

    const counts = await Article.groupCount("status");
    check("groupCount works", counts.published === 2 && counts.draft === 1, counts);
  }

  section("Projections");
  {
    const only = await Article.find({}, "title views").lean();
    check(
      "an inclusion projection keeps _id plus the named fields",
      only[0]._id !== undefined && only[0].title !== undefined && only[0].status === undefined,
      only[0],
    );

    const without = await Article.find().select("-tags").lean();
    check("an exclusion projection drops the field", without[0].tags === undefined);

    const objectForm = await Article.find().select({ title: 1 }).lean();
    check("the object form works", objectForm[0].title !== undefined && objectForm[0].views === undefined);
  }

  section("Populate");
  {
    const populated = await Article.find().populate("author", "name email").lean();
    const first = populated[0].author as unknown as AuthorDoc;
    check("a reference is replaced by its document", first?.name === "Priya Shah", first);
    check("populate honours its field list", first?.secret === undefined);

    const unpopulated = await Article.find().lean();
    check(
      "populate does not leak into later reads",
      unpopulated[0].author instanceof ObjectId,
    );
  }

  section("Updates");
  {
    await Article.updateOne({ _id: article._id }, { $set: { views: 10 } });
    let reloaded = await Article.findById(article._id).lean();
    check("$set works", reloaded?.views === 10, reloaded?.views);

    await Article.updateOne({ _id: article._id }, { $inc: { views: 5 } });
    reloaded = await Article.findById(article._id).lean();
    check("$inc works", reloaded?.views === 15, reloaded?.views);

    await Article.updateOne({ _id: article._id }, { $push: { tags: "growth" } });
    reloaded = await Article.findById(article._id).lean();
    check("$push works", reloaded?.tags.includes("growth") === true, reloaded?.tags);

    await Article.updateOne({ _id: article._id }, { $addToSet: { tags: "growth" } });
    reloaded = await Article.findById(article._id).lean();
    check(
      "$addToSet does not duplicate",
      reloaded?.tags.filter((t) => t === "growth").length === 1,
      reloaded?.tags,
    );

    await Article.updateOne({ _id: article._id }, { $pull: { tags: "growth" } });
    reloaded = await Article.findById(article._id).lean();
    check("$pull works", !reloaded?.tags.includes("growth"), reloaded?.tags);

    await Article.updateOne({ _id: article._id }, { $unset: { publishedAt: "" } });
    reloaded = await Article.findById(article._id).lean();
    check("$unset works", reloaded?.publishedAt === undefined);

    const updatedMany = await Article.updateMany({ status: "published" }, { $inc: { views: 1 } });
    check("updateMany reports how many it touched", updatedMany.modifiedCount === 2);

    const returned = await Article.findOneAndUpdate(
      { _id: article._id },
      { $set: { title: "Renamed" } },
    );
    check("findOneAndUpdate returns the new version", returned?.title === "Renamed");

    const original = await Article.findOneAndUpdate(
      { _id: article._id },
      { $set: { title: "Renamed again" } },
      { new: false },
    );
    check("new:false returns the previous version", original?.title === "Renamed");

    const upserted = await Article.findOneAndUpdate(
      { title: "Brand new" },
      { $set: { author: author._id, views: 7 } },
      { upsert: true },
    );
    check("upsert creates the document", upserted.views === 7 && upserted.title === "Brand new");
    check("upsert seeds fields from the filter", upserted.title === "Brand new");

    const plainReplace = await Article.findOneAndUpdate(
      { _id: upserted._id },
      { views: 99 },
    );
    check("an update with no operators sets fields", plainReplace?.views === 99);
  }

  section("Documents and save()");
  {
    const live = await Article.findById(article._id);
    if (!live) throw new Error("article vanished");

    check("id is the hex string", live.id === String(live._id));

    live.views = 500;
    live.revisions.push({ label: "manual edit", at: new Date() });
    await live.save();

    const reloaded = await Article.findById(article._id).lean();
    check("save() persists a scalar", reloaded?.views === 500, reloaded?.views);
    check("save() persists a subdocument push", reloaded?.revisions.length === 1);
    check(
      "subdocument fields keep their types",
      reloaded?.revisions[0].at instanceof Date,
      reloaded?.revisions[0],
    );

    // Mutating a nested object in place, then saving, is how the reel pipeline
    // records step progress — it has to survive the round trip.
    const again = await Article.findById(article._id);
    Object.assign(again!.revisions[0], { label: "edited in place" });
    await again!.save();
    const third = await Article.findById(article._id).lean();
    check("in-place mutation is persisted", third?.revisions[0].label === "edited in place");

    check(
      "toObject() strips the helper methods",
      typeof (live.toObject() as { save?: unknown }).save !== "function",
    );
    check("JSON output has no methods", JSON.parse(JSON.stringify(live)).save === undefined);
  }

  section("Two writers on one document");
  {
    // Exactly what the reel pipeline does: it holds a job object for minutes
    // while setStep() records progress through its own copy. Neither may wipe
    // the other's work.
    const first = await Article.findById(article._id);
    const second = await Article.findById(article._id);

    first!.title = "Changed by the first writer";
    second!.views = 4242;

    await first!.save();
    await second!.save();

    const merged = await Article.findById(article._id).lean();
    check(
      "the first writer's change survives",
      merged?.title === "Changed by the first writer",
      merged?.title,
    );
    check("the second writer's change survives", merged?.views === 4242, merged?.views);

    // The same again, but into an array — the shape setStep() actually uses.
    const writerA = await Article.findById(article._id);
    const writerB = await Article.findById(article._id);

    writerA!.revisions.push({ label: "from writer A", at: new Date() });
    writerB!.meta = { touchedBy: "writer B" };

    await writerA!.save();
    await writerB!.save();

    const bothWrote = await Article.findById(article._id).lean();
    check(
      "the appended array element survives",
      bothWrote?.revisions.some((entry) => entry.label === "from writer A") === true,
      bothWrote?.revisions,
    );
    check(
      "the unrelated field survives",
      (bothWrote?.meta as { touchedBy?: string })?.touchedBy === "writer B",
      bothWrote?.meta,
    );

    // A deleted field must actually go, not be resurrected by the merge.
    const remover = await Article.findById(article._id);
    delete (remover as Record<string, unknown>).meta;
    await remover!.save();
    const afterDelete = await Article.findById(article._id).lean();
    check("a deleted field stays deleted", afterDelete?.meta === undefined, afterDelete?.meta);
  }

  section("Deleting");
  {
    const before = await Article.countDocuments();
    const target = await Article.findOne({ title: "Brand new" });
    await target!.deleteOne();
    check("document.deleteOne() removes it", (await Article.countDocuments()) === before - 1);

    const removed = await Article.findOneAndDelete({ title: "Hashtag ladders" });
    check("findOneAndDelete returns what it removed", removed?.title === "Hashtag ladders");
    check("and it is gone", (await Article.countDocuments({ title: "Hashtag ladders" })) === 0);

    const many = await Article.deleteMany({ status: "published" });
    check("deleteMany reports a count", many.deletedCount === 1, many.deletedCount);
  }

  section("TTL expiry");
  {
    await Session.create({ token: "abc" });
    // The index expires records immediately, so the next read must sweep it.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const remaining = await Session.countDocuments();
    check("an expired document is swept on read", remaining === 0, remaining);
  }

  section("Persistence");
  {
    flushAllCollections();

    // Read the file back exactly the way a fresh process would.
    const raw = readFileSync(join(workDir, "test-authors.json"), "utf8");
    check("the file is human-readable JSON", raw.includes('"$oid"') && raw.includes('"$date"'));

    const rows = parseDocuments(raw);
    check("the collection file is on disk", rows.length === 1, rows.length);
    check("dates were restored as Date objects", rows[0].createdAt instanceof Date, rows[0]);
    check(
      "ids were restored as ObjectId objects",
      String(rows[0]._id) === String(author._id),
      rows[0]._id,
    );
    check(
      "a hidden field is still stored on disk",
      rows[0].secret === "top-secret",
      rows[0].secret,
    );
  }

  /* ---------------------------------------------------------------- */

  const total = passed + failures.length;
  console.log(`\n${"─".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`  All ${total} checks passed.\n`);
  } else {
    console.log(`  ${passed}/${total} checks passed. Failures:\n`);
    for (const failure of failures) console.log(`   ✗ ${failure}`);
    console.log("");
  }
  return failures.length;
}

run()
  .then((failed) => {
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error("\n  Test run crashed:", error);
    process.exit(1);
  })
  .finally(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; leaving a temp folder is harmless.
    }
  });
