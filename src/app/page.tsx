import Link from "next/link";
import { connectDB } from "@/lib/db";
import { Plan } from "@/models/Plan";
import LandingPage, { type PublicPlan } from "@/components/LandingPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI thi social media marketing — Auto Marketing",
  description:
    "Write AI posts for Facebook and Instagram, schedule them, publish automatically, and reply to comments with a direct message — all from one place.",
};

/**
 * The public marketing home page. Plans come from the database, so anything
 * the super admin changes shows up here immediately.
 */
export default async function HomePage() {
  let plans: PublicPlan[] = [];
  try {
    await connectDB();
    plans = JSON.parse(
      JSON.stringify(
        await Plan.find({ active: true, visible: true })
          .sort({ sortOrder: 1 })
          .lean(),
      ),
    );
  } catch {
    // The landing page must still render even if the database is unreadable.
  }

  return <LandingPage plans={plans} />;
}
