import { auth } from "@/auth";
import { UsersPageClient } from "@/components/control/users-page-client";

export default async function UsersPage() {
  const session = await auth();
  return <UsersPageClient userRole={session?.user?.role || "VIEWER"} />;
}
