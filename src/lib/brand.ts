import { cookies } from "next/headers";
import { Brand, type BrandDoc } from "@/models/Brand";

export const BRAND_COOKIE = "am_brand";

/**
 * Atyare kayo brand active che — HAMESHA organization ni andar j jovay che,
 * jethi cookie ma biji organization no brand id hoy to pan e na chale.
 */
export async function getActiveBrand(
  organizationId: unknown,
): Promise<BrandDoc | null> {
  const store = await cookies();
  const cookieValue = store.get(BRAND_COOKIE)?.value;

  if (cookieValue) {
    const brand = await Brand.findOne({
      _id: cookieValue,
      organization: organizationId,
      active: true,
    });
    if (brand) return brand;
  }

  return Brand.findOne({ organization: organizationId, active: true }).sort({
    createdAt: 1,
  });
}

export async function setActiveBrandCookie(brandId: string) {
  const store = await cookies();
  store.set(BRAND_COOKIE, brandId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
