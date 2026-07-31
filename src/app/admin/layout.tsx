import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AdminShell from "@/components/AdminShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AdminShell
      user={{ name: session.name, email: session.email, role: session.role }}
    >
      {children}
    </AdminShell>
  );
}
