import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import SuperAdminShell from "@/components/SuperAdminShell";

export const metadata = { title: "Super Admin" };

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  // Super admin sivay koi ne ahiya na aavva devu.
  if (session.role !== "superadmin") redirect("/admin");

  return (
    <SuperAdminShell user={{ name: session.name, email: session.email }}>
      {children}
    </SuperAdminShell>
  );
}
