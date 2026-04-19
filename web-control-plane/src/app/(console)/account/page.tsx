import { auth } from "@/auth";
import { AccountPageClient } from "@/components/control/account-page-client";

export default async function AccountPage() {
  const session = await auth();
  return <AccountPageClient userRole={session?.user?.role || "VIEWER"} />;
}
