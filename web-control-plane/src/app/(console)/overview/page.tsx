import { auth } from "@/auth";
import { OverviewPageClient } from "@/components/control/overview-page-client";

export default async function OverviewPage() {
  const session = await auth();
  return <OverviewPageClient userRole={session?.user?.role || "VIEWER"} />;
}
