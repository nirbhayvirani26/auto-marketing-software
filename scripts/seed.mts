/**
 * Platform seed.
 *   npm run seed            -> plans + super admin + default organization
 *   npm run seed -- --demo  -> saathe sample campaign + automation pan
 *
 * Fari fari chalavi shakay — badhu upsert thay che.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

/* -------------------- env -------------------- */

function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(resolve(process.cwd(), name), "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index === -1) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {
      // File nathi to vandho nahi.
    }
  }
}

/* -------------------- loose schemas --------------------
 * Script Next.js bahar chale che etle ahiya halka schemas vaparyа che —
 * `strict: false` thi app na models na badha fields pass thai jay che.
 */
const loose = (collection: string) =>
  new mongoose.Schema({}, { strict: false, timestamps: true, collection });

function model(name: string, collection: string) {
  return mongoose.models[name] ?? mongoose.model(name, loose(collection));
}

/* -------------------- plans -------------------- */

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    description: "Ek brand thi shuru karo",
    priceMonthly: 999,
    priceYearly: 9990,
    sortOrder: 1,
    limits: {
      organizations: 1,
      brands: 1,
      socialAccounts: 3,
      postsPerMonth: 100,
      users: 1,
      automations: 2,
      commentRules: 0,
    },
    modules: {
      posts: true,
      campaigns: true,
      automations: true,
      autoDm: false,
      aiGeneration: true,
      n8n: false,
      apiTokens: false,
      whiteLabel: false,
      analytics: false,
    },
    highlights: [
      "1 brand",
      "3 social accounts",
      "100 AI posts / month",
      "Scheduling + auto publish",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    description: "Vadhta business mate",
    priceMonthly: 2999,
    priceYearly: 29990,
    popular: true,
    sortOrder: 2,
    limits: {
      organizations: 1,
      brands: 5,
      socialAccounts: 20,
      postsPerMonth: 1000,
      users: 5,
      automations: 20,
      commentRules: 20,
    },
    modules: {
      posts: true,
      campaigns: true,
      automations: true,
      autoDm: true,
      aiGeneration: true,
      n8n: true,
      apiTokens: false,
      whiteLabel: false,
      analytics: true,
    },
    highlights: [
      "5 brands",
      "20 social accounts",
      "1000 AI posts / month",
      "Auto DM & comment replies",
      "n8n automation",
      "5 team members",
    ],
  },
  {
    key: "agency",
    name: "Agency",
    description: "Ghani organizations chalavo — clients mate",
    priceMonthly: 9999,
    priceYearly: 99990,
    sortOrder: 3,
    limits: {
      organizations: -1,
      brands: -1,
      socialAccounts: -1,
      postsPerMonth: -1,
      users: -1,
      automations: -1,
      commentRules: -1,
    },
    modules: {
      posts: true,
      campaigns: true,
      automations: true,
      autoDm: true,
      aiGeneration: true,
      n8n: true,
      apiTokens: true,
      whiteLabel: true,
      analytics: true,
    },
    highlights: [
      "Unlimited organizations",
      "Unlimited brands & accounts",
      "Unlimited AI posts",
      "API tokens + n8n",
      "White-label",
      "Unlimited team members",
    ],
  },
];

async function seedPlans() {
  const Plan = model("Plan", "plans");
  for (const plan of PLANS) {
    await Plan.findOneAndUpdate({ key: plan.key }, { ...plan, active: true, visible: true }, {
      upsert: true,
    });
  }
  console.log(`✔ ${PLANS.length} plans seed thaya`);
}

/* -------------------- users + org -------------------- */

async function seedSuperAdmin() {
  const User = model("User", "users");
  const email = (process.env.SUPERADMIN_EMAIL || "superadmin@example.com").toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || "Super@12345";

  await User.findOneAndUpdate(
    { email },
    {
      name: process.env.SUPERADMIN_NAME || "Super Admin",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "superadmin",
      emailVerified: true,
      active: true,
      organization: null,
    },
    { upsert: true },
  );

  console.log(`✔ SUPER ADMIN : ${email} / ${password}`);
  return email;
}

async function seedOrgOwner() {
  const User = model("User", "users");
  const Organization = model("Organization", "organizations");
  const Plan = model("Plan", "plans");
  const Brand = model("Brand", "brands");

  const email = (process.env.SEED_ADMIN_EMAIL || "admin@example.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "Admin@12345";
  const orgName = process.env.SEED_ORG_NAME || "My Company";

  const plan =
    (await Plan.findOne({ key: "agency" })) ?? (await Plan.findOne({}));

  const user = await User.findOneAndUpdate(
    { email },
    {
      name: process.env.SEED_ADMIN_NAME || "Org Owner",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "owner",
      emailVerified: true,
      active: true,
    },
    { upsert: true, new: true },
  );

  let org = await Organization.findOne({ owner: user._id });
  if (!org) {
    org = await Organization.create({
      name: orgName,
      slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      owner: user._id,
      plan: plan?._id,
      status: "active",
      usage: { postsThisMonth: 0, periodStart: new Date() },
    });
    console.log(`✔ Organization banyu: ${org.name} (${plan?.name} plan)`);
  }

  await User.updateOne(
    { _id: user._id },
    { organization: org._id, organizations: [org._id] },
  );

  // Brands ne organization saathe jodo (juna brands ne pan).
  await Brand.updateMany(
    { organization: { $exists: false } },
    { $set: { organization: org._id } },
  );

  let brand = await Brand.findOne({ organization: org._id });
  if (!brand) {
    brand = await Brand.create({
      organization: org._id,
      name: orgName,
      slug: "default",
      brandVoice: "friendly, professional",
      color: "#5B5BD6",
      active: true,
    });
    console.log(`✔ Brand banyu: ${brand.name}`);
  }

  console.log(`✔ ORG OWNER   : ${email} / ${password}`);
  return { orgId: org._id, brandId: brand._id };
}

/* -------------------- migration -------------------- */

/** Juna records (brand field vagar na) ne default brand ma jodi de. */
async function migrateLegacy(brandId: mongoose.Types.ObjectId) {
  let migrated = 0;
  for (const collection of [
    "socialaccounts",
    "campaigns",
    "posts",
    "automations",
    "commentrules",
  ]) {
    const result = await mongoose.connection
      .collection(collection)
      .updateMany({ brand: { $exists: false } }, { $set: { brand: brandId } });
    migrated += result.modifiedCount;
  }
  if (migrated > 0) console.log(`✔ ${migrated} juna records migrate thaya`);
}

/* -------------------- demo -------------------- */

async function seedDemoData(
  orgId: mongoose.Types.ObjectId,
  brandId: mongoose.Types.ObjectId,
) {
  const Campaign = model("Campaign", "campaigns");
  const Automation = model("Automation", "automations");

  const campaign = await Campaign.findOneAndUpdate(
    { name: "Demo Campaign", brand: brandId },
    {
      brand: brandId,
      name: "Demo Campaign",
      description: "Sample campaign — delete kari shako cho",
      brandVoice: "friendly, helpful, down to earth",
      targetAudience: "25-45 age, small business owners",
      keywords: ["small business", "growth", "marketing"],
      hashtags: ["smallbusiness", "marketingtips"],
      callToAction: "Aaje j try karo →",
      status: "draft",
    },
    { upsert: true, new: true },
  );

  await Automation.findOneAndUpdate(
    { name: "Demo Daily Tip", brand: brandId },
    {
      brand: brandId,
      name: "Demo Daily Tip",
      campaign: campaign._id,
      topic: "Ek practical marketing tip for small business owners",
      tone: "friendly",
      frequency: "daily",
      timeOfDay: "09:30",
      dayOfWeek: 1,
      autoPublish: false,
      enabled: false,
      runCount: 0,
    },
    { upsert: true },
  );

  console.log("✔ Demo campaign ane automation banya (automation disabled che)");
}

/* -------------------- main -------------------- */

async function main() {
  loadEnvFile();

  const uri =
    process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/auto_marketing";
  console.log(`Connecting to ${uri} …\n`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  await seedPlans();
  await seedSuperAdmin();
  const { orgId, brandId } = await seedOrgOwner();
  await migrateLegacy(brandId);

  if (process.argv.includes("--demo")) {
    await seedDemoData(orgId, brandId);
  }

  console.log("\n  Login: http://localhost:3000/login");
  console.log("  Super admin panel: http://localhost:3000/superadmin\n");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Seed fail thayu:", error.message);
  process.exit(1);
});
