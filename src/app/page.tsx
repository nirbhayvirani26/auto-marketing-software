import Link from "next/link";
import { connectDB } from "@/lib/db";
import { Plan } from "@/models/Plan";
import LandingPage, { type PublicPlan } from "@/components/LandingPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI thi social media marketing — Auto Marketing",
  description:
    "Ek jagya thi Facebook ane Instagram par AI posts banavo, schedule karo, auto publish karo, ane comment par auto DM moklo.",
};

/**
 * Public marketing home page. Plans DB mathi aave che — super admin plans
 * badle to ahiya turant dekhaay che.
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
    // DB band hoy to pan landing page dekhavu joiye.
  }

  return <LandingPage plans={plans} />;
}
