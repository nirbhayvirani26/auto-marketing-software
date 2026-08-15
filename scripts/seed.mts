/**
 * Seeds the local database.
 *
 *   npm run seed            -> plans + super admin + an organization and brand
 *   npm run seed -- --demo  -> the above, plus a sample campaign and automation
 *
 * Safe to run again at any time: everything is an upsert.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import bcrypt from "bcryptjs";

import { Plan, DEFAULT_PLANS } from "../src/models/Plan";
import { User } from "../src/models/User";
import { Organization } from "../src/models/Organization";
import { Brand, slugify } from "../src/models/Brand";
import { Campaign } from "../src/models/Campaign";
import { Automation } from "../src/models/Automation";
import { dataDir, flushAllCollections, type ObjectId } from "../src/lib/localdb";

// This script runs outside Next.js, which would otherwise load `.env` for us.
const ENV_FILE = path.join(process.cwd(), ".env");
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // A missing or unreadable .env is fine — the defaults take over.
  }
}

/* -------------------- plans -------------------- */

async function seedPlans() {
  for (const plan of DEFAULT_PLANS) {
    await Plan.findOneAndUpdate(
      { key: plan.key },
      { ...plan, active: true, visible: true },
      { upsert: true },
    );
  }
  console.log(`  ${DEFAULT_PLANS.length} plans ready`);
}

/* -------------------- users and organization -------------------- */

async function seedSuperAdmin() {
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
    },
    { upsert: true },
  );

  console.log(`  Super admin  ${email} / ${password}`);
}

async function seedOrgOwner() {
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@example.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "Admin@12345";
  const orgName = process.env.SEED_ORG_NAME || "My Company";

  // The agency plan lifts every limit, which is the friendliest default for a
  // tool you run for yourself.
  const plan = (await Plan.findOne({ key: "agency" })) ?? (await Plan.findOne({}));
  if (!plan) throw new Error("No plans found — seedPlans() must run first.");

  const user = await User.findOneAndUpdate(
    { email },
    {
      name: process.env.SEED_ADMIN_NAME || "Workspace Owner",
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
      slug: slugify(orgName) || "workspace",
      owner: user._id,
      plan: plan._id,
      status: "active",
      usage: { postsThisMonth: 0, periodStart: new Date() },
    });
    console.log(`  Organization "${org.name}" created on the ${plan.name} plan`);
  }

  await User.updateOne(
    { _id: user._id },
    { organization: org._id, organizations: [org._id] },
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
    console.log(`  Brand "${brand.name}" created`);
  }

  console.log(`  Owner        ${email} / ${password}`);
  return { orgId: org._id, brandId: brand._id };
}

/* -------------------- demo content -------------------- */

async function seedDemoData(brandId: ObjectId) {
  const campaign = await Campaign.findOneAndUpdate(
    { name: "Demo Campaign", brand: brandId },
    {
      brand: brandId,
      name: "Demo Campaign",
      description: "A sample campaign — delete it whenever you like",
      brandVoice: "friendly, helpful, down to earth",
      targetAudience: "Small business owners, 25-45",
      keywords: ["small business", "growth", "marketing"],
      hashtags: ["smallbusiness", "marketingtips"],
      callToAction: "Try it today",
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
      topic: "One practical marketing tip for small business owners",
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

  console.log("  Demo campaign and automation created (the automation is off)");
}

/* -------------------- main -------------------- */

async function main() {
  console.log(`\nSeeding the local database at ${dataDir()}\n`);

  await seedPlans();
  await seedSuperAdmin();
  const { brandId } = await seedOrgOwner();

  if (process.argv.includes("--demo")) {
    await seedDemoData(brandId);
  }

  flushAllCollections();

  console.log("\n  Sign in          http://localhost:3000/login");
  console.log("  Super admin      http://localhost:3000/superadmin\n");
}

main().catch((error) => {
  console.error("Seed failed:", error.message);
  process.exit(1);
});
