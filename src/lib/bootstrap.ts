import bcrypt from "bcryptjs";

import { connectDB } from "./db";
import { env } from "./env";
import { Brand, slugify } from "@/models/Brand";
import { Organization } from "@/models/Organization";
import { DEFAULT_PLANS, Plan } from "@/models/Plan";
import { User } from "@/models/User";

/**
 * First-run setup.
 *
 * The point of the local database is that someone can be handed this folder,
 * run `npm install && npm run dev`, and be looking at a working admin panel a
 * minute later. That only holds if the very first request can create what it
 * needs, so this fills in the plans, the owner account, the organization and a
 * starter brand when the database is empty.
 *
 * It is idempotent and cheap: after the first call it is a single count.
 */

let bootstrapped = false;
let inFlight: Promise<void> | null = null;

export async function ensureBootstrapped(): Promise<void> {
  if (bootstrapped) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    await connectDB();

    if ((await User.countDocuments()) > 0) {
      bootstrapped = true;
      return;
    }

    console.log("[setup] Empty database — creating the default workspace.");

    for (const plan of DEFAULT_PLANS) {
      await Plan.findOneAndUpdate(
        { key: plan.key },
        { ...plan, active: true, visible: true },
        { upsert: true },
      );
    }

    // The agency plan lifts every limit, which is the right default for a tool
    // you host yourself. The super admin panel can change it later.
    const plan =
      (await Plan.findOne({ key: "agency" })) ?? (await Plan.findOne({}));
    if (!plan) throw new Error("Could not create the default plans.");

    const superAdminEmail = (
      process.env.SUPERADMIN_EMAIL || "superadmin@example.com"
    ).toLowerCase();

    await User.create({
      name: process.env.SUPERADMIN_NAME || "Super Admin",
      email: superAdminEmail,
      passwordHash: await bcrypt.hash(
        process.env.SUPERADMIN_PASSWORD || "Super@12345",
        12,
      ),
      role: "superadmin",
      emailVerified: true,
      active: true,
    });

    const seed = env.seedAdmin;
    const owner = await User.create({
      name: seed.name,
      email: seed.email.toLowerCase(),
      passwordHash: await bcrypt.hash(seed.password, 12),
      role: "owner",
      emailVerified: true,
      active: true,
    });

    const orgName = process.env.SEED_ORG_NAME || "My Company";
    const organization = await Organization.create({
      name: orgName,
      slug: slugify(orgName) || "workspace",
      owner: owner._id,
      plan: plan._id,
      status: "active",
      usage: { postsThisMonth: 0, periodStart: new Date() },
    });

    owner.organization = organization._id;
    owner.organizations = [organization._id];
    await owner.save();

    await Brand.create({
      organization: organization._id,
      name: orgName,
      slug: "default",
      brandVoice: "friendly, professional",
      color: "#5B5BD6",
      active: true,
    });

    console.log(`[setup] Sign in as ${seed.email} / ${seed.password}`);
    bootstrapped = true;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
