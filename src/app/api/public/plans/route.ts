import { connectDB } from "@/lib/db";
import { handle, ok } from "@/lib/api";
import { Plan } from "@/models/Plan";

export const dynamic = "force-dynamic";

/** Public — marketing/pricing page mate. Koi auth joiye nahi. */
export const GET = handle(async () => {
  await connectDB();

  const plans = await Plan.find({ active: true, visible: true })
    .select("key name description priceMonthly priceYearly currency limits modules highlights popular sortOrder")
    .sort({ sortOrder: 1 })
    .lean();

  return ok(plans);
});
