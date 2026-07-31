/**
 * Admin user seed script.
 *   npm run seed           -> fakt admin user banave
 *   npm run seed -- --demo -> saathe ek sample campaign + automation pan banave
 *
 * .env na SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME vaapre che.
 * User pehla thi hoy to password reset kari de che.
 */
import "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

// Aa script Next.js runtime bahar chale che, etle .env jate load karvu pade.
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

async function main() {
  loadEnvFile();

  const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/auto_marketing";
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
  const name = process.env.SEED_ADMIN_NAME ?? "Super Admin";

  console.log(`Connecting to ${uri} …`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const UserSchema = new mongoose.Schema(
    {
      name: String,
      email: { type: String, unique: true },
      passwordHash: String,
      role: String,
      active: Boolean,
    },
    { timestamps: true, collection: "users" },
  );
  const User = mongoose.models.User ?? mongoose.model("User", UserSchema);

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await User.findOne({ email });

  if (existing) {
    existing.set({ passwordHash, name, role: "admin", active: true });
    await existing.save();
    console.log(`✔ Existing admin update thayu: ${email}`);
  } else {
    await User.create({
      name,
      email,
      passwordHash,
      role: "admin",
      active: true,
    });
    console.log(`✔ Admin user banyo: ${email}`);
  }

  console.log(`  Password: ${password}`);

  if (process.argv.includes("--demo")) {
    await seedDemoData();
  }

  console.log("  Have http://localhost:3000/login par login karo.");
  await mongoose.disconnect();
}

/**
 * Sample campaign + automation — UI khali na lage etle. Koi real token nathi
 * etle aa demo data thi kai publish nahi thay; e safe che.
 */
async function seedDemoData() {
  const CampaignSchema = new mongoose.Schema(
    {
      name: String,
      description: String,
      brandVoice: String,
      targetAudience: String,
      keywords: [String],
      hashtags: [String],
      callToAction: String,
      accounts: [mongoose.Schema.Types.ObjectId],
      status: String,
    },
    { timestamps: true, collection: "campaigns" },
  );
  const AutomationSchema = new mongoose.Schema(
    {
      name: String,
      campaign: mongoose.Schema.Types.ObjectId,
      accounts: [mongoose.Schema.Types.ObjectId],
      topic: String,
      tone: String,
      frequency: String,
      timeOfDay: String,
      dayOfWeek: Number,
      autoPublish: Boolean,
      enabled: Boolean,
      runCount: Number,
    },
    { timestamps: true, collection: "automations" },
  );

  const Campaign =
    mongoose.models.Campaign ?? mongoose.model("Campaign", CampaignSchema);
  const Automation =
    mongoose.models.Automation ?? mongoose.model("Automation", AutomationSchema);

  const campaign = await Campaign.findOneAndUpdate(
    { name: "Demo Campaign" },
    {
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
    { name: "Demo Daily Tip" },
    {
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
    { upsert: true, new: true },
  );

  console.log("✔ Demo campaign ane automation banya (automation disabled che)");
}

main().catch((error) => {
  console.error("Seed fail thayu:", error.message);
  process.exit(1);
});
